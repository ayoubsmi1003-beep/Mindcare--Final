import type { DbPort } from "@/services/db/port";

/** All labels and identity tokens are for local use; never include this result in egress. */
export type PatientResolution =
  | { readonly status: "resolved"; readonly patientId: string; readonly identityTokens: readonly string[] }
  | { readonly status: "ambiguous"; readonly candidates: readonly { readonly patientId: string; readonly label: string }[] }
  | { readonly status: "unavailable" }
  | { readonly status: "cancelled" };

interface PatientRow { readonly id: string; readonly first_name?: string; readonly last_name?: string; readonly total_count?: number | string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalise = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const fullName = (row: PatientRow) => `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
const hasIdentity = (row: PatientRow) => typeof row.id === "string" && uuid.test(row.id)
  && typeof row.first_name === "string" && row.first_name.trim().length > 0
  && typeof row.last_name === "string" && row.last_name.trim().length > 0;
const matchesName = (row: PatientRow, name: string) => hasIdentity(row)
  && [fullName(row), `${row.last_name} ${row.first_name}`].some((value) => normalise(value) === name);
function searchCount(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^[1-9]\d*$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}
function resolved(row: PatientRow): PatientResolution {
  return { status: "resolved", patientId: row.id, identityTokens: [...new Set([row.first_name, row.last_name, fullName(row), `${row.last_name ?? ""} ${row.first_name ?? ""}`.trim()].filter((value): value is string => typeof value === "string" && value.trim().length > 1))] };
}

export async function resolvePatient(db: Pick<DbPort, "rpc">, input: { readonly patientId?: string; readonly name?: string }, signal?: AbortSignal): Promise<PatientResolution> {
  if (signal?.aborted) return { status: "cancelled" };
  try {
    let target = input.patientId;
    let requestedName: string | undefined;
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 160) return { status: "unavailable" };
      // Explicit name always replaces the prior ID, including failed searches.
      let search = await db.rpc<PatientRow>("search_patients", { p_query: name, p_limit: 10, p_offset: 0 });
      if (signal?.aborted) return { status: "cancelled" };
      if (!search.ok) return { status: "unavailable" };
      // The SQL search door indexes first name then surname. Try bounded word
      // rotations only after an empty page; never retry away an ambiguous page.
      const words = name.split(/\s+/u);
      if (search.data.length === 0 && words.length >= 2 && words.length <= 4) {
        for (let cut = words.length - 1; cut > 0 && search.data.length === 0; cut--) {
          const query = [...words.slice(cut), ...words.slice(0, cut)].join(" ");
          if (normalise(query) === normalise(name)) continue;
          search = await db.rpc<PatientRow>("search_patients", { p_query: query, p_limit: 10, p_offset: 0 });
          if (signal?.aborted) return { status: "cancelled" };
          if (!search.ok) return { status: "unavailable" };
        }
      }
      if (search.data.length === 0) return { status: "unavailable" };
      const candidates = search.data.filter(hasIdentity);
      requestedName = normalise(name);
      const exact = candidates.filter((row) => matchesName(row, requestedName!));
      // The search door also returns fuzzy matches. A unique exact full name is
      // conclusive only when every matching row is present and valid.
      const complete = candidates.length === search.data.length && candidates.length <= 10
        && candidates.every((row) => searchCount(row.total_count) === candidates.length)
        && new Set(candidates.map((row) => row.id)).size === candidates.length;
      if (!complete || exact.length !== 1) {
        return { status: "ambiguous", candidates: candidates.map((row) => ({ patientId: row.id, label: fullName(row) })) };
      }
      target = exact[0]?.id;
    }
    if (target === undefined || !uuid.test(target)) return { status: "unavailable" };
    const patient = await db.rpc<PatientRow>("get_patient", { p_id: target });
    if (signal?.aborted) return { status: "cancelled" };
    if (!patient.ok || patient.data.length !== 1 || patient.data[0]?.id !== target) return { status: "unavailable" };
    if (requestedName !== undefined && !matchesName(patient.data[0], requestedName)) return { status: "unavailable" };
    return resolved(patient.data[0]);
  } catch {
    return { status: signal?.aborted ? "cancelled" : "unavailable" };
  }
}
