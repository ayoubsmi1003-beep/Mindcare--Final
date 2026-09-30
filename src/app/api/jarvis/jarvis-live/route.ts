import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NOM_COOKIE } from "@/server/auth/session";
import { env } from "@/server/env";
import { ouvrirGeminiLive, diagnosticLive, type SessionGeminiLive } from "@/server/egress/external-call";
import { clientSql } from "@/server/jarvis/client-sql";
import { lireOutilLive, patientFictif, type ContexteLive } from "@/server/voice/live-tools";
import { lireCorpsVoix } from "@/server/voice/corps";
import { CommandeLive, type EvenementLive } from "@/shared/jarvis/live";
import { alexaLive } from "@/i18n/alexa-live";
import { identite, echec, succes } from "../_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
interface Session {
  id: string; owner: string; context: ContexteLive; revision: number;
  control: AbortController; provider: SessionGeminiLive | null;
  dispose: () => void;
}
// One ephemeral session per authenticated cookie. No history or audio on disk.
const sessions = new Map<string, Session>();
const unavailable = () => echec("configuration", alexaLive.indisponible);

export async function GET(): Promise<Response> {
  if (await identite() === null) return unavailable();
  const e = env();
  return Response.json({ ok: true, data: { model: "gemini-3.8-live", keyConfigured: Boolean(e.GEMINI_API_KEY || e.GOOGLE_API_KEY),
    cloudSelected: e.VOICE_PROVIDER === "cloud", voiceEnabled: e.JARVIS_VOICE_ENABLED !== "false" && e.JARVIS_ENABLED !== "false" } },
  { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  const actor = await identite();
  const cookie = (await cookies()).get(NOM_COOKIE)?.value;
  if (!actor || !cookie) return echec("non-authentifie", alexaLive.indisponible);
  const v = CommandeLive.safeParse(await lireCorpsVoix(req, 64_000));
  if (!v.success) return echec("requete-invalide", alexaLive.indisponible);
  const command = v.data, owner = createHash("sha256").update(cookie).digest("hex");
  const client = clientSql(actor);
  if (command.action !== "start") {
    const session = sessions.get(command.sessionId);
    if (!session || session.owner !== owner || !session.provider) return unavailable();
    try {
      if (command.action === "stop") session.dispose();
      if (command.action === "audio") await session.provider.sendAudio(command.pcmBase64);
      if (command.action === "context") {
        if (command.currentPatientId && !await patientFictif(client, command.currentPatientId)) { session.dispose(); return unavailable(); }
        session.revision++;
        session.context = { currentPatientId: command.currentPatientId, referencedPatientId: null };
        await session.provider.updateContext(command.currentPatientId);
      }
      return succes({ accepted: true });
    } catch { session.dispose(); return unavailable(); }
  }
  diagnosticLive("activation-received");
  try {
    if (command.currentPatientId && !await patientFictif(client, command.currentPatientId)) return unavailable();
  } catch { return unavailable(); }
  for (const current of sessions.values()) if (current.owner === owner) current.dispose();
  const id = randomUUID(), control = new AbortController();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let disposed = false;
  const queued: EvenementLive[] = [];
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const session: Session = { id, owner, control, provider: null, revision: 0,
    context: { currentPatientId: command.currentPatientId, referencedPatientId: null },
    dispose: () => {
      if (disposed) return;
      disposed = true; sessions.delete(id); control.abort(); session.provider?.close();
      clearInterval(heartbeat); req.signal.removeEventListener("abort", session.dispose);
      try { controller?.close(); } catch { /* Reader already cancelled. */ }
      queued.length = 0;
    },
  };
  sessions.set(id, session);
  req.signal.addEventListener("abort", session.dispose, { once: true });
  if (req.signal.aborted) { session.dispose(); return unavailable(); }
  const emit = (event: EvenementLive) => {
    if (disposed) return;
    if (!controller) { queued.push(event); if (queued.length > 32) session.dispose(); return; }
    if ((controller.desiredSize ?? 0) < -1_000_000) { session.dispose(); return; }
    try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { session.dispose(); }
    if (event.type === "closed" || event.type === "error") session.dispose();
  };
  const opened = await ouvrirGeminiLive({ sessionToken: id, currentPatientId: command.currentPatientId,
    signal: control.signal, onEvent: emit,
    executeTool: async (name, args, signal) => {
      const revision = session.revision, context = { ...session.context };
      const result = await lireOutilLive(client, name, args, context, signal);
      if (disposed || signal.aborted || revision !== session.revision) return { status: "unavailable" };
      session.context.referencedPatientId = context.referencedPatientId;
      session.context.targetUnresolved = context.targetUnresolved === true;
      diagnosticLive("tool-executed");
      return result;
    },
  });
  if (!opened.ok || disposed) { if (opened.ok) opened.data.close(); session.dispose(); return unavailable(); }
  session.provider = opened.data;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c; emit({ type: "ready", sessionId: id });
      for (const event of queued.splice(0)) emit(event);
      if (disposed) return;
      heartbeat = setInterval(() => { try { c.enqueue(encoder.encode("\n")); } catch { session.dispose(); } }, 15_000);
    },
    cancel: () => session.dispose(),
  }, { highWaterMark: 128_000, size: (chunk) => chunk.byteLength });
  if (req.signal.aborted) session.dispose();
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no" } });
}
