import type { DbPort } from "@/services/db/port";
import { z } from "zod";

/** All labels and identity tokens are for local use; never include this result in egress. */
export type PatientResolution =
  | { readonly status: "resolved"; readonly patientId: string; readonly identityTokens: readonly string[] }
  | { readonly status: "ambiguous"; readonly candidates: readonly { readonly patientId: string; readonly label: string }[]; readonly suggested?: true }
  | { readonly status: "unavailable" }
  | { readonly status: "absent" }
  | { readonly status: "cancelled" };

interface PatientRow { readonly id: string; readonly first_name?: string; readonly last_name?: string; readonly total_count?: number | string; readonly birth_date?: string | null; readonly record_number?: string | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalise = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const fullName = (row: PatientRow) => `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
const hasIdentity = (row: PatientRow) => typeof row.id === "string" && uuid.test(row.id)
  && typeof row.first_name === "string" && row.first_name.trim().length > 0
  && typeof row.last_name === "string" && row.last_name.trim().length > 0;
const matchesName = (row: PatientRow, name: string) => hasIdentity(row)
  && [fullName(row), `${row.last_name} ${row.first_name}`].some((value) => normalise(value) === name);
function nameDistance(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  if (!a.length || !b.length) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]! / Math.max(a.length, b.length);
}
function nameRotations(value: string): string[] {
  const words = value.split(/\s+/u);
  return words.length >= 2 && words.length <= 4
    ? words.map((_, index) => [...words.slice(index), ...words.slice(0, index)].join(" "))
    : [value];
}
function rankedCandidates(rows: readonly PatientRow[], name: string) {
  const searches = nameRotations(normalise(name));
  return rows.filter(hasIdentity).map((row) => {
    const names = [fullName(row), `${row.last_name} ${row.first_name}`, row.first_name!, row.last_name!].map(normalise);
    return { row, distance: Math.min(...searches.flatMap((search) => names.map((candidate) => nameDistance(search, candidate)))) };
  }).sort((left, right) => left.distance - right.distance
    || normalise(fullName(left.row)).localeCompare(normalise(fullName(right.row)), "fr")
    || left.row.id.localeCompare(right.row.id))
    .map(({ row }) => ({ patientId: row.id, label: fullName(row) }));
}
/**
 * A spelling key that survives speech-to-text errors on French and Maghrebi names: "Karime Ben Ali",
 * "Carim Benaly" and "Karim Benali" share "karimbenali".
 */
export function phoneticKey(value: string): string {
  return normalise(value).replace(/[^\p{L} ]/gu, "").split(" ").filter(Boolean).map(word => word
    .replace(/ph/gu, "f").replace(/qu/gu, "k").replace(/ck/gu, "k").replace(/c(?=[aou]|$)/gu, "k").replace(/q/gu, "k")
    .replace(/(?<!c)h/gu, "").replace(/y/gu, "i").replace(/eau|au/gu, "o").replace(/ou/gu, "u").replace(/[ae]i/gu, "e")
    .replace(/(\p{L})\1+/gu, "$1").replace(/(?<=..)[estx]$/u, "")).join("");
}
/** Names close enough to be offered for confirmation, best first, at most three. Nothing is read. */
export function closeNames(rows: readonly PatientRow[], name: string): { patientId: string; label: string }[] {
  const wanted = phoneticKey(name);
  if (wanted.length < 3) return [];
  const seen = new Set<string>();
  return rows.filter(hasIdentity)
    .map(row => ({ row, distance: Math.min(...[fullName(row), `${row.last_name} ${row.first_name}`].map(value => nameDistance(wanted, phoneticKey(value)))) }))
    .filter(entry => entry.distance <= 0.2)
    .sort((left, right) => left.distance - right.distance || left.row.id.localeCompare(right.row.id))
    .filter(entry => !seen.has(entry.row.id) && !!seen.add(entry.row.id))
    .slice(0, 3).map(({ row }, _index, kept) => {
      // Two people with the same name are told apart by what the screen shows: birth date or record number.
      const twin = kept.some(other => other.row.id !== row.id && normalise(fullName(other.row)) === normalise(fullName(row)));
      const detail = twin ? (row.birth_date ? ` (né·e le ${String(row.birth_date).slice(0, 10)})` : row.record_number ? ` (dossier ${row.record_number})` : "") : "";
      return { patientId: row.id, label: fullName(row) + detail };
    });
}
/** When nothing matches as written, look for sound-alike names by the first letters of each word. */
async function soundAlikeNames(db: Pick<DbPort, "rpc">, name: string, signal?: AbortSignal): Promise<{ patientId: string; label: string }[]> {
  const rows: PatientRow[] = [];
  for (const word of [...new Set(normalise(name).split(" ").filter(word => word.length >= 3))].slice(0, 2)) {
    if (signal?.aborted) return [];
    const page = await db.rpc<PatientRow>("search_patients", { p_query: word.slice(0, 3), p_limit: 30, p_offset: 0 });
    if (page.ok) rows.push(...page.data);
  }
  return closeNames(rows, name);
}

/**
 * Whether words of the request name a patient other than the one in context, through the audited search
 * gate under the caller's rights. Only rows whose names start with every word count, since the gate also
 * returns approximate rows. A failed search counts as a match: the caller is asked, nothing is read.
 */
/** The page size of the name check's lookups. Tests tell the name check's searches from other searches by it. */
export const NAME_CHECK_LIMIT = 20;

export async function namesAnotherPatient(db: Pick<DbPort, "rpc">, words: readonly string[], patientId: string, signal?: AbortSignal): Promise<boolean> {
  // Compound names are written several ways ("Ben Ali", "Benali", "Ben-Ali"), so single words, adjacent pairs
  // and words with their hyphens removed are all compared, with spaces, hyphens and apostrophes ignored.
  const joined = (value: string) => normalise(value).replace(/[\s'’-]+/gu, "");
  const pieces = words.map(word => normalise(word));
  const pairs = pieces.slice(1).map((piece, index) => `${pieces[index]} ${piece}`);
  const queries = [...new Set([...pairs, ...pieces].map(value => value.replace(/[-'’]+/gu, " ").trim()))].filter(value => joined(value).length >= 3).slice(0, 20);
  // A heard name is close, not equal: the spelling key used for suggestions decides.
  const close = (left: string, right: string) => left === right || (left.length >= 4 && right.length >= 4 && nameDistance(phoneticKey(left), phoneticKey(right)) <= 0.2);
  const namesOf = (row: PatientRow) => [...normalise(fullName(row)).split(/[\s'’-]+/u), joined(row.first_name!), joined(row.last_name!)].filter(name => name.length >= 3);
  // Each looked-up phrase is compared only with the rows its own search returned, so a word can't match
  // a patient that another word of the sentence fetched ("mourir" next to a surname shared with a Mounir).
  const found: { query: string; rows: PatientRow[] }[] = [];
  for (const query of queries) {
    if (signal?.aborted) return true;
    const search = await db.rpc<PatientRow>("search_patients", { p_query: query, p_limit: NAME_CHECK_LIMIT, p_offset: 0 });
    if (!search.ok) return true;
    found.push({ query: joined(query), rows: search.data.filter(hasIdentity) });
  }
  // The patient being read counts as named in full only on an exact match of both names. Only the phrases
  // that are exactly its names are then set aside: "Karima" next to "Karim Benali" is still compared.
  const target = found.flatMap(entry => entry.rows).find(row => row.id === patientId);
  const spoken = new Set(found.map(entry => entry.query));
  const fullyNamed = !!target && [target.first_name!, target.last_name!].every(part => spoken.has(joined(part)));
  const own = new Set(fullyNamed && target ? [joined(target.first_name!), joined(target.last_name!), joined(fullName(target))] : []);
  for (const entry of found) {
    if (own.has(entry.query)) continue;
    if (entry.rows.some(row => row.id !== patientId && namesOf(row).some(name => close(entry.query, name)))) return true;
  }
  return false;
}

function searchCount(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^[1-9]\d*$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}
function resolved(row: PatientRow): PatientResolution {
  return { status: "resolved", patientId: row.id, identityTokens: [...new Set([row.first_name, row.last_name, fullName(row), `${row.last_name ?? ""} ${row.first_name ?? ""}`.trim()].filter((value): value is string => typeof value === "string" && value.trim().length > 1))] };
}

const archivedPatientPageSchema=z.object({total:z.number().int().nonnegative().safe(),rows:z.array(z.object({id:z.uuid(),first_name:z.string().max(200),last_name:z.string().max(200)}).passthrough()).max(20),complete:z.literal(true),offset:z.number().int().min(0).max(10000),revision:z.string().regex(/^[a-f0-9]{32}$/)}).passthrough();
async function resolveArchivedName(db:Pick<DbPort,"rpc">,name:string,asOf:string,signal?:AbortSignal):Promise<PatientResolution>{
 const rows:PatientRow[]=[];let total:number|undefined,revision:string|undefined;
 try{
  for(let offset=0;offset<100;offset+=20){
   if(signal?.aborted)return {status:"cancelled"};
   const spec={mode:"list",population:"archived",query:name,limit:20,offset,...(revision?{revision}:{})};
   const page=await db.rpc<unknown>("search_patients",{p_spec:JSON.stringify(spec),p_as_of:asOf});
   if(signal?.aborted)return {status:"cancelled"};
   if(!page.ok||page.data.length!==1)return {status:"unavailable"};
   const wrapped=page.data[0],raw=typeof wrapped==="object"&&wrapped!==null&&"search_patients" in wrapped?wrapped.search_patients:wrapped;
   const parsed=archivedPatientPageSchema.safeParse(raw);
   if(!parsed.success||parsed.data.offset!==offset||parsed.data.rows.length>parsed.data.total||new Set(parsed.data.rows.map(row=>row.id)).size!==parsed.data.rows.length)return {status:"unavailable"};
   if(total===undefined){total=parsed.data.total;revision=parsed.data.revision;if(total>100)return {status:"ambiguous",candidates:rankedCandidates(parsed.data.rows,name)};}
   if(parsed.data.total!==total||parsed.data.revision!==revision)return {status:"unavailable"};
   rows.push(...parsed.data.rows);
   if(rows.length===total)break;
   if(parsed.data.rows.length!==20||offset+20>=100)return {status:"unavailable"};
  }
  if(total===undefined)return {status:"unavailable"};
  if(total===0)return {status:"absent"};
  if(rows.length!==total||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!hasIdentity(row)))return {status:"ambiguous",candidates:rankedCandidates(rows,name)};
  const exact=rows.filter(row=>matchesName(row,normalise(name)));
  return exact.length===1?resolved(exact[0]!):{status:"ambiguous",candidates:rankedCandidates(rows,name)};
 }catch{return {status:signal?.aborted?"cancelled":"unavailable"};}
}

export async function resolvePatient(db: Pick<DbPort, "rpc">, input: { readonly patientId?: string; readonly name?: string }, signal?: AbortSignal, asOf?:string): Promise<PatientResolution> {
  const result = await resolveWrittenName(db, input, signal, asOf);
  const words = input.name?.trim().split(/\s+/u) ?? [];
  // "Yanis Bellil juste avant…": an everyday word glued to a name. One word off either edge, kept only when it names one
  // patient exactly; anything less certain keeps the first answer (absent, or the close names to choose from). A list where
  // someone carries every written word is a real choice between people of that name: it is never trimmed away.
  const written = words.map((word) => normalise(word));
  const someoneHasThatName = result.status === "ambiguous" && result.candidates.some((row) => { const parts = normalise(row.label).split(/[\s,()-]+/u); return written.every((word) => parts.includes(word)); });
  if (words.length >= 3 && words.length <= 5 && (result.status === "absent" || (result.status === "ambiguous" && !someoneHasThatName))) {
    for (const trimmed of [words.slice(0, -1), words.slice(1)]) {
      const retry = await resolveWrittenName(db, { name: trimmed.join(" ") }, signal, asOf);
      if (retry.status === "resolved" || retry.status === "cancelled") return retry;
    }
  }
  return result;
}

async function resolveWrittenName(db: Pick<DbPort, "rpc">, input: { readonly patientId?: string; readonly name?: string }, signal?: AbortSignal, asOf?:string): Promise<PatientResolution> {
  if (signal?.aborted) return { status: "cancelled" };
  try {
    let target = input.patientId;
    let requestedName: string | undefined;
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 160) return { status: "unavailable" };
      // Explicit name always replaces the prior ID, including failed searches.
      let query=name;
      let search = await db.rpc<PatientRow>("search_patients", { p_query: query, p_limit: 10, p_offset: 0 });
      if (signal?.aborted) return { status: "cancelled" };
      if (!search.ok) return { status: "unavailable" };
      // The SQL search door indexes first name then surname. Try bounded word
      // rotations only after an empty page; never retry away an ambiguous page.
      const words = name.split(/\s+/u);
      if (search.data.length === 0 && words.length >= 2 && words.length <= 4) {
        for (let cut = words.length - 1; cut > 0 && search.data.length === 0; cut--) {
          query = [...words.slice(cut), ...words.slice(0, cut)].join(" ");
          if (normalise(query) === normalise(name)) continue;
          search = await db.rpc<PatientRow>("search_patients", { p_query: query, p_limit: 10, p_offset: 0 });
          if (signal?.aborted) return { status: "cancelled" };
          if (!search.ok) return { status: "unavailable" };
        }
      }
      if (search.data.length === 0) {
        const archived=await resolveArchivedName(db,name,asOf??new Date().toISOString(),signal);
        if(archived.status==="absent"){const close=await soundAlikeNames(db,name,signal);return close.length?{status:"ambiguous",candidates:close,suggested:true}:archived;}
        if(archived.status!=="resolved")return archived;
        target=archived.patientId;requestedName=normalise(name);
      } else {
      const total=searchCount(search.data[0]?.total_count);
      const rows=[...search.data];
      // Complete bounded pages before asserting uniqueness. A larger search
      // stays ambiguous; it never turns its first ten rows into an identity.
      if(total!==null&&total>rows.length&&total<=100&&rows.length===10) {
        for(let offset=10;offset<total;offset+=10){
          const page=await db.rpc<PatientRow>("search_patients",{p_query:query,p_limit:10,p_offset:offset});
          if(signal?.aborted)return {status:"cancelled"};
          if(!page.ok||page.data.length!==Math.min(10,total-offset)||page.data.some(row=>searchCount(row.total_count)!==total))return {status:"unavailable"};
          rows.push(...page.data);
        }
      }
      const candidates = rows.filter(hasIdentity);
      requestedName = normalise(name);
      const exact = candidates.filter((row) => matchesName(row, requestedName!));
      // The search door also returns fuzzy matches. A unique exact full name is
      // conclusive only when every matching row is present and valid.
      const complete = candidates.length === rows.length && candidates.length <= 100
        && candidates.every((row) => searchCount(row.total_count) === candidates.length)
        && new Set(candidates.map((row) => row.id)).size === candidates.length;
      // No row carries the name as written: offer the close ones for confirmation, or look by sound.
      // A first or last name alone keeps the list to choose from. Otherwise the search door returned only
      // approximate rows: offer the close ones as a question, never as an identity.
      if (exact.length === 0) {
        const words = normalise(name).split(" ");
        const typed = candidates.some(row => { const parts = normalise(fullName(row)).split(" "); return words.every(word => parts.some(part => part.startsWith(word))); });
        const close = typed ? [] : closeNames(candidates, name);
        if (close.length) return { status: "ambiguous", candidates: close, suggested: true };
      }
      if (!complete || exact.length !== 1) {
        return { status: "ambiguous", candidates: rankedCandidates(candidates, name) };
      }
      target = exact[0]?.id;
      }
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
