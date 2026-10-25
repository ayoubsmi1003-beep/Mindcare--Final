import { narrativeCopy } from "@/i18n/alexa-narrative";
import { z } from "zod";
import { identite, echec, succes } from "@/app/api/jarvis/_commun";
import { alexaDb } from "@/server/alexa/db";
import { buildClinicalContext, readClinicalSourceRevision } from "@/server/alexa/clinical-context";
import { resolvePatient } from "@/server/alexa/patient-resolver";
import { buildCaseSynthesis, CASE_SYNTHESIS_HASH, CASE_SYNTHESIS_VERSION, type ScaleAdministrationLite, type ScaleDefinitionLite } from "@/server/alexa/case-synthesis";
import { alexa } from "@/i18n/alexa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scaleRow = z.object({
  id: z.uuid(),
  scale_code: z.string().min(1),
  scale_name: z.string().min(1),
  consultation_id: z.uuid().nullable(),
  total: z.number().nullable(),
  interpretation: z.string().nullable(),
  administered_at: z.string().min(1),
  responses: z.record(z.string(), z.unknown()),
}).strict();

const scaleDefinitionRow = z.object({
  code: z.string().min(1),
  name_fr: z.string().min(1),
  items: z.array(z.object({
    id: z.string().min(1),
    texte: z.string().min(1),
    risque: z.boolean().optional(),
    alerte: z.string().min(1).optional(),
  }).loose()).min(1),
  scoring: z.object({ max: z.number().int() }).loose(),
}).strict();

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403 });
  const actor = await identite();
  if (!actor) return echec("non-authentifie", alexa.lectureIndisponible);
  const input = z.object({ patientId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return echec("requete-invalide", alexa.format);
  const db = alexaDb(actor);
  // The synthesis is deterministic; the signal still bounds the three audited reads.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
  try {
    const patient = await resolvePatient(db, { patientId: input.data.patientId }, signal);
    if (patient.status !== "resolved") return echec("indisponible", alexa.lectureIndisponible);
    const context = await buildClinicalContext(db, { patientId: patient.patientId }, { count: 100, purpose: "summary", all:true }, signal);

    const historyResult = await db.rpc<unknown>("get_scale_history", { p_patient_id: patient.patientId, p_scale_code: null });
    const historyParsed = z.array(scaleRow).safeParse(historyResult.ok ? historyResult.data : []);
    const histories: readonly ScaleAdministrationLite[] = historyParsed.success
      ? historyParsed.data.map((row) => ({
          id: row.id, scaleCode: row.scale_code, scaleName: row.scale_name, consultationId: row.consultation_id,
          total: row.total, interpretation: row.interpretation, administeredAt: row.administered_at, responses: row.responses,
        }))
      : [];
    const definitionsResult = await db.rpc<unknown>("list_scales", {});
    const definitionsParsed = z.array(scaleDefinitionRow).safeParse(definitionsResult.ok ? definitionsResult.data : []);
    const definitions: readonly ScaleDefinitionLite[] = definitionsParsed.success
      ? definitionsParsed.data.map((row) => ({ code: row.code, nom: row.name_fr, items: row.items, scoring: { max: row.scoring.max } }))
      : [];

    const synthesis = buildCaseSynthesis({
      context,
      histories,
      definitions,
      identities: patient.identityTokens,
      scaleHistoryUnavailable: !historyResult.ok || !historyParsed.success,
      scaleDefinitionsUnavailable: !definitionsResult.ok || !definitionsParsed.success,
    });
    if (synthesis.paragraphes.length === 0 && synthesis.vigilance.length === 0) return echec("regle-metier", narrativeCopy.caseEmpty);

    const content = {
      schema: 2 as const,
      apercu: {
        nom: "Dossier clinique",
        age: null,
        residence: null,
        diagnostics: synthesis.diagnostics,
        traitements: synthesis.traitements,
        contexte: synthesis.paragraphes,
      },
      chronologie: [],
      anterieur: [],
      etat_actuel: synthesis.vigilance,
    };
    if (await readClinicalSourceRevision(db, { patientId: patient.patientId }, signal) !== context.sourceRevision) return echec("contexte-change", alexa.contexteChange);
    signal.throwIfAborted();
    const saved = await db.rpc<Record<string, unknown>>("save_alexa_case_summary", { p_patient_id: patient.patientId, p_content: JSON.stringify(content),
      p_source_state: JSON.stringify({ alexaSourceRevision: context.sourceRevision, alexaNoteAreas: 5, coverage: context.coverage, limited: false, method: "structured", scaleHistory: histories.length, caseSynthesis: CASE_SYNTHESIS_VERSION }),
      p_model: "mindcare-case-synthesis", p_prompt_version: CASE_SYNTHESIS_VERSION, p_prompt_hash: CASE_SYNTHESIS_HASH });
    if (!saved.ok || !saved.data[0]) return echec("indisponible", alexa.lectureIndisponible);
    const persisted = await db.rpc<Record<string, unknown>>("get_alexa_case_summary", { p_patient_id: patient.patientId });
    if (!persisted.ok || !persisted.data[0]) return echec("indisponible", alexa.lectureIndisponible);
    return succes({ resume: persisted.data[0], sourceRevision: context.sourceRevision, coverage: context.coverage, limited: false });
  } catch { return echec("indisponible", alexa.lectureIndisponible); }
}
import { isSameOriginRequest } from "@/server/auth/same-origin";
