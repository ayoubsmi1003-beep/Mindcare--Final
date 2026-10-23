import { z } from "zod";
import { identite, echec, succes } from "../_commun";
import { alexaDb } from "@/server/alexa/db";
import { isSameOriginRequest } from "@/server/auth/same-origin";
import { generateSessionSummary, SessionSummaryError } from "@/server/alexa/session-summary";
import { narrativeCopy as copy } from "@/i18n/alexa-narrative";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  const actor = await identite();
  if (!actor) return echec("non-authentifie", copy.failed);
  const input = z.object({ consultationId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return echec("requete-invalide", copy.failed);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(900000)]);
  try { return succes(await generateSessionSummary(alexaDb(actor), input.data.consultationId, signal)); }
  catch (error) {
    if(process.env.ALEXA_DEBUG_NARRATIVE==='1')console.warn('[session-summary] terminal',error instanceof SessionSummaryError?error.code:error instanceof Error?error.name:'unknown');
    return error instanceof SessionSummaryError && error.code === "empty" ? echec("regle-metier", copy.noNotes) : error instanceof SessionSummaryError && error.code === "changed" ? echec("contexte-change", copy.changed) : echec("analyse-indisponible", copy.failed);
  }
}
