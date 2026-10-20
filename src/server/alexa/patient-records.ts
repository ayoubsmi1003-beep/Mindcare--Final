import { z } from "zod";
import type { DbPort } from "@/services/db/port";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { recordCopy } from "@/i18n/alexa-semantic";

type Sentence = Extract<AlexaEvent, { type: "sentence" }>;
const profile = z.object({ id: z.uuid(), first_name: z.string().min(1), last_name: z.string().min(1),
  record_number: z.string(), phone: z.string(), birth_date: z.preprocess(value=>value instanceof Date&&Number.isFinite(value.getTime())
    ?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`:value,z.string().nullable()), age: z.number().int().nullable().optional() });
const document = z.object({ document_id: z.uuid(), doc_type: z.enum(["bonne_sante_mentale", "suivi_medical", "certificat_medical", "justification"]),
  issued_at: z.preprocess(value=>value instanceof Date?value.toISOString():value,z.iso.datetime({ offset: true })), printed_count: z.number().int().nonnegative(), status: z.enum(["issued", "voided"]).optional() });

/** Existing audited doors, actor-bound DbPort. Never inspect HTML or execute document text. */
export async function readPatientRecords(db: Pick<DbPort, "rpc">, patientId: string, kind: "profile" | "documents", language: "fr" | "ar" | "mixed", signal: AbortSignal): Promise<Sentence[]> {
  signal.throwIfAborted();
  const copy = recordCopy[language === "fr" ? "fr" : "ar"];
  const result = await db.rpc<unknown>(kind === "profile" ? "get_patient" : "list_patient_documents", kind === "profile" ? { p_id: patientId } : { p_patient_id: patientId });
  signal.throwIfAborted();
  if (!result.ok) throw new Error("PatientRecordsUnavailable");
  if (kind === "profile") {
    const parsed = profile.safeParse(result.data[0]);
    if (result.data.length !== 1 || !parsed.success || parsed.data.id !== patientId) throw new Error("PatientRecordsUnavailable");
    const row = parsed.data;
    return [{ type: "sentence", text: copy.profile(`${row.first_name} ${row.last_name}`, row.record_number, row.phone, row.birth_date, row.age ?? null), kind: "fact", sources: [{ id: patientId, type: "patient", label: row.record_number }] }];
  }
  const parsed = z.array(document).max(500).safeParse(result.data);
  if (!parsed.success || new Set(parsed.data.map(d => d.document_id)).size !== parsed.data.length) throw new Error("PatientRecordsUnavailable");
  if (!parsed.data.length) return [{ type: "sentence", text: copy.noDocuments, kind: "fact", sources: [] }];
  return parsed.data.slice(0, 20).map(row => ({ type: "sentence", text: copy.document(row.doc_type, row.issued_at, row.printed_count, row.status === "voided"), kind: "fact",
    sources: [{ id: row.document_id, type: "document", label: row.doc_type }] }));
}
