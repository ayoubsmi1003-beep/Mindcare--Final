import { identite } from "@/app/api/jarvis/_commun";
import { getAlexaModelPolicy, qualifyAlexaModels } from "@/server/alexa/model-gateway";
import { z } from "zod";

/** Authenticated explicit maintenance; ordinary turns never burn quota on probes. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  if (!(await identite())) return Response.json({ ok: false }, { status: 401 });
  const input: unknown = await request.json().catch(() => null);
  if (input !== null) {
    const parsed = z.object({ provider: z.enum(["openrouter", "gemini-free", "groq-free"]), freeTierConfirmed: z.boolean().optional() }).strict().safeParse(input);
    if (!parsed.success) return Response.json({ ok: false, code: "invalid" }, { status: 400 });
    try { return Response.json({ ok: true, data: await qualifyAlexaModels({ provider: parsed.data.provider,
      ...(parsed.data.freeTierConfirmed !== undefined ? { freeTierConfirmed: parsed.data.freeTierConfirmed } : {}),
      signal: request.signal, timeoutMs: 30000, maxModels: 2 }) }); }
    catch { return Response.json({ ok: false, code: "unavailable" }, { status: 503 }); }
  }
  return Response.json({ ok: true, data: getAlexaModelPolicy() });
}
import { isSameOriginRequest } from "@/server/auth/same-origin";
