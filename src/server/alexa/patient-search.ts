import { z } from "zod";
import type { DbPort } from "@/services/db/port";

const patientSchema = z.object({ id: z.uuid(), first_name: z.string().max(200).nullable(), last_name: z.string().max(200).nullable(),
  id_document_number: z.string().nullable() });
const searchSchema = z.array(z.object({ id: z.uuid(), total_count: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)]) })).max(100);
export type ListedPatient = { readonly id: string; readonly label: string };
export type PatientSearchResult = { readonly state: "complete"; readonly patients: readonly ListedPatient[] }
  | { readonly state: "limited" | "changed" };

export type PatientFilter = "all" | "missing_phone" | "missing_identity_card" | "missing_email";
const filteredPageSchema = z.object({ total_count: z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/u)]),
  patients: z.array(z.object({ id: z.uuid(), first_name: z.string().max(200), last_name: z.string().max(200) }).strict()).max(20) }).strict();
export type PatientPageResult = { state: "complete"; total: number; patients: readonly ListedPatient[]; hasMore: boolean; offset: number }
  | { state: "unsupported" | "changed" };

/** Filter and count are atomic in the audited SQL door; never scan/export a cabinet in JS. */
export async function readPatientPage(db: Pick<DbPort, "rpc">, filter: PatientFilter, output: "count" | "list", offset: number,
  signal: AbortSignal): Promise<PatientPageResult> {
  signal.throwIfAborted();
  if (filter === "missing_email") return { state: "unsupported" };
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error("InvalidPatientPage");
  const result = await db.rpc<unknown>("search_patients", { p_query: null, p_limit: output === "count" ? 0 : 20, p_offset: offset,
    p_missing_field: filter === "missing_phone" ? "phone" : filter === "missing_identity_card" ? "identity_card" : null });
  signal.throwIfAborted();
  if (!result.ok || result.data.length !== 1) throw new Error("PatientSearchUnavailable");
  const raw = result.data[0];
  const parsed = filteredPageSchema.parse(typeof raw === "object" && raw !== null && "search_patients" in raw ? raw.search_patients : raw);
  const total = Number(parsed.total_count);
  if (!Number.isSafeInteger(total) || total < parsed.patients.length || new Set(parsed.patients.map(p=>p.id)).size !== parsed.patients.length
    || (output === "count" && parsed.patients.length !== 0)) throw new Error("InvalidPatientPage");
  return { state: "complete", total, patients: parsed.patients.map(p=>({ id:p.id, label:`${p.first_name} ${p.last_name}`.trim() })),
    hasMore: output === "list" && offset + parsed.patients.length < total, offset };
}

/** Audited search/get doors only; identities and numbers never enter a model prompt. */
export async function readPatientList(db: Pick<DbPort, "rpc">, filter: "all" | "missing_identity_card", signal: AbortSignal): Promise<PatientSearchResult> {
  signal.throwIfAborted();
  const search = await db.rpc<unknown>("search_patients", { p_query: null, p_limit: 100, p_offset: 0 });
  signal.throwIfAborted();
  if (!search.ok) throw new Error("PatientSearchUnavailable");
  const rows = searchSchema.parse(search.data);
  if (rows.some(row => Number(row.total_count) > 100)) return { state: "limited" };
  if (new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => Number(row.total_count) !== rows.length)) return { state: "changed" };
  const patients: ListedPatient[] = [];
  // Four independent authorized reads at a time; no direct patients SELECT.
  for (let offset = 0; offset < rows.length; offset += 4) {
    signal.throwIfAborted();
    const results = await Promise.all(rows.slice(offset, offset + 4).map(async row => {
      const result = await db.rpc<unknown>("get_patient", { p_id: row.id });
      signal.throwIfAborted();
      if (!result.ok || result.data.length !== 1) return null;
      const value = patientSchema.safeParse(result.data[0]);
      return value.success && value.data.id === row.id ? value.data : null;
    }));
    if (results.some(result => result === null)) return { state: "changed" };
    for (const patient of results) {
      if (patient && (filter === "all" || !patient.id_document_number?.trim())) {
        patients.push({ id: patient.id, label: `${patient.first_name ?? ""} ${patient.last_name ?? ""}`.trim() });
      }
    }
  }
  return { state: "complete", patients };
}
