import type { DbPort } from "@/services/db/port";

/**
 * A doctor often names a patient by one word ("des nouvelles de Kouider"). Only the audited patient search can say who that is:
 * one patient is a match, several are a question for the doctor, none means the word was not a name. Nothing is guessed from a
 * resemblance: a word counts only when it IS a whole word of the first or last name.
 */
export interface FirstNameMatch { readonly patientId: string; readonly first: string; readonly last: string }
const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘ʼ]/gu, "'").trim();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function firstNameMatches(db: Pick<DbPort, "rpc">, word: string, signal?: AbortSignal): Promise<{ matches: readonly FirstNameMatch[]; truncated: boolean } | null> {
  const wanted = fold(word);
  if (wanted.length < 2 || signal?.aborted) return null;
  try {
    const found = await db.rpc<{ id?: unknown; first_name?: unknown; last_name?: unknown; total_count?: unknown }>("search_patients", { p_query: word, p_limit: 10, p_offset: 0 });
    if (signal?.aborted || !found.ok) return null;
    const matches = found.data.flatMap((row): FirstNameMatch[] => {
      if (typeof row.id !== "string" || !uuid.test(row.id) || typeof row.first_name !== "string" || typeof row.last_name !== "string") return [];
      const words = [...fold(row.first_name).split(/\s+/u), ...fold(row.last_name).split(/\s+/u)];
      return words.includes(wanted) ? [{ patientId: row.id, first: row.first_name, last: row.last_name }] : [];
    });
    const total = Number(found.data[0]?.total_count ?? found.data.length);
    return { matches, truncated: Number.isFinite(total) && total > found.data.length };
  } catch {
    return null;
  }
}
