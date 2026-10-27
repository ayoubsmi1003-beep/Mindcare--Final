import { identite } from "@/app/api/jarvis/_commun";
import { clientSql } from "@/server/jarvis/client-sql";
import { alexaDb } from "@/server/alexa/db";
import { runAlexa } from "@/server/alexa/orchestrator";
import { turnInput } from "@/shared/alexa/turn";
import { alexa } from "@/i18n/alexa";
import { isSameOriginRequest } from "@/server/auth/same-origin";




export async function legacyAlexaTurn(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  const actor = await identite();
  if (!actor) return Response.json({ ok: false }, { status: 401 });
  const parsed = turnInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: { code: "invalid", message: alexa.format } }, { status: 400 });
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("Timeout")), 90_000);
  const persistence = clientSql(actor);
  // Existing idempotent gates, local only; an arbitrary conversation ID grants no write access.
  const appended = await persistence.rpc("append_jarvis_turn", { p_conversation_id: parsed.data.conversationId, p_client_turn_id: parsed.data.clientTurnId, p_demande: parsed.data.text });
  let answer = "";
  const events:import("@/shared/alexa/turn").AlexaEvent[]=[];
  let persistencePending: Promise<void> = Promise.resolve();
  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => { if (!controller.signal.aborted) sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); };
      const emit = (event: import("@/shared/alexa/turn").AlexaEvent) => {
        if (event.type === "sentence") answer += `${answer ? "\n" : ""}${event.text}`;
        if(event.type!=="stage"&&event.type!=="done")events.push(event);
        if (event.type === "done") persistencePending = (async () => {
          // A completed legacy turn is speakable; a partial/limited turn is not.
          const speechAllowed = !event.limited;
          const done={...event,status:event.limited?"partial" as const:"completed" as const,parts:[],speechAllowed};
          const saved = await persistence.rpc("complete_jarvis_turn", { p_conversation_id: parsed.data.conversationId, p_client_turn_id: parsed.data.clientTurnId, p_chemin: "patient", p_contenu: answer, p_statut: event.limited?"interrompu":"complet",p_outil:{version:1,events:[...events,done]} });
          send({ ...done, persiste: appended.error === null && appended.data === true && saved.error === null && saved.data === true });
        })();
        else send(event);
      };
      void runAlexa(parsed.data, { actor, db: alexaDb(actor), knowledge: persistence }, emit, controller.signal).then(() => persistencePending).finally(() => {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
        try { sink.close(); } catch { /* Client cancellation already closed the stream. */ }
      });
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
