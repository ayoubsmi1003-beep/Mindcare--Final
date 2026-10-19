import { ALEXA_CONVERSATION_MODEL } from "@/server/alexa/model-policy";
import { summarizeClinicalContext, clinicalNarrativeReferences, NARRATIVE_HASH, NARRATIVE_VERSION } from "@/server/alexa/clinical-narrative";
import { narrativeCopy } from "@/i18n/alexa-narrative";
import { z } from "zod";
import { identite, echec, succes } from "@/app/api/jarvis/_commun";
import { alexaDb } from "@/server/alexa/db";
import { buildClinicalContext, readClinicalSourceRevision } from "@/server/alexa/clinical-context";
import { resolvePatient } from "@/server/alexa/patient-resolver";
import { buildCaseSummary } from "@/server/alexa/case-summary";
import { alexa } from "@/i18n/alexa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  const actor = await identite();
  if (!actor) return echec("non-authentifie", alexa.lectureIndisponible);
  const input = z.object({ patientId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return echec("requete-invalide", alexa.format);
  const db = alexaDb(actor);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(180_000)]);
  try {
    const patient = await resolvePatient(db, { patientId: input.data.patientId }, signal);
    if (patient.status !== "resolved") return echec("indisponible", alexa.lectureIndisponible);
    const context = await buildClinicalContext(db, { patientId: patient.patientId }, { count: 100, purpose: "summary" }, signal);
    const narrative = await summarizeClinicalContext(context, signal, true);
    if (!narrative.generated) return echec("analyse-indisponible", narrativeCopy.failed);
    const content = buildCaseSummary(context, patient.identityTokens);
    content.apercu.contexte = [{ texte: narrative.text + (narrative.method === "source_selection" ? " " + narrativeCopy.selected : "") + (narrative.complete ? "" : " " + narrativeCopy.limited), sources: clinicalNarrativeReferences(context,narrative.sourceIds) }];
    if (await readClinicalSourceRevision(db, { patientId: patient.patientId }, signal) !== context.sourceRevision) return echec("contexte-change", alexa.contexteChange);
    signal.throwIfAborted();
    const saved = await db.rpc<Record<string, unknown>>("save_alexa_case_summary", { p_patient_id: patient.patientId, p_content: JSON.stringify(content),
      p_source_state: JSON.stringify({ alexaSourceRevision: context.sourceRevision, alexaNoteAreas: 5, coverage: context.coverage, limited: !narrative.complete, method: narrative.method }),
      p_model: ALEXA_CONVERSATION_MODEL, p_prompt_version: NARRATIVE_VERSION, p_prompt_hash: NARRATIVE_HASH });
    if (!saved.ok || !saved.data[0]) return echec("indisponible", alexa.lectureIndisponible);
    const persisted = await db.rpc<Record<string, unknown>>("get_alexa_case_summary", { p_patient_id: patient.patientId });
    if (!persisted.ok || !persisted.data[0]) return echec("indisponible", alexa.lectureIndisponible);
    return succes({ resume: persisted.data[0], sourceRevision: context.sourceRevision, coverage: context.coverage, limited: !narrative.complete });
  } catch { return echec("indisponible", alexa.lectureIndisponible); }
}
import { isSameOriginRequest } from "@/server/auth/same-origin";
