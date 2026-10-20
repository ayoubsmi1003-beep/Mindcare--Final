import type { DbPort } from "@/services/db/port";
import { z } from "zod";

/** All labels and identity tokens are for local use; never include this result in egress. */
export type PatientResolution =
  | { readonly status: "resolved"; readonly patientId: string; readonly identityTokens: readonly string[] }
  | { readonly status: "ambiguous"; readonly candidates: readonly { readonly patientId: string; readonly label: string }[] }
  | { readonly status: "unavailable" }
  | { readonly status: "absent" }
  | { readonly status: "cancelled" };

interface PatientRow { readonly id: string; readonly first_name?: string; readonly last_name?: string; readonly total_count?: number | string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalise = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
const fullName = (row: PatientRow) => `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
const hasIdentity = (row: PatientRow) => typeof row.id === "string" && uuid.test(row.id)
  && typeof row.first_name === "string" && row.first_name.trim().length > 0
  && typeof row.last_name === "string" && row.last_name.trim().length > 0;
const matchesName = (row: PatientRow, name: string) => hasIdentity(row)
  && [fullName(row), `${row.last_name} ${row.first_name}`, row.first_name!, row.last_name!].some((value) => normalise(value) === name);
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
   if(total===undefined){total=parsed.data.total;revision=parsed.data.revision;if(total>100)return {status:"ambiguous",candidates:parsed.data.rows.map(row=>({patientId:row.id,label:fullName(row)}))};}
   if(parsed.data.total!==total||parsed.data.revision!==revision)return {status:"unavailable"};
   rows.push(...parsed.data.rows);
   if(rows.length===total)break;
   if(parsed.data.rows.length!==20||offset+20>=100)return {status:"unavailable"};
  }
  if(total===undefined)return {status:"unavailable"};
  if(total===0)return {status:"absent"};
  if(rows.length!==total||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>!hasIdentity(row)))return {status:"ambiguous",candidates:rows.filter(hasIdentity).map(row=>({patientId:row.id,label:fullName(row)}))};
  const exact=rows.filter(row=>matchesName(row,normalise(name)));
  return exact.length===1?resolved(exact[0]!):{status:"ambiguous",candidates:rows.map(row=>({patientId:row.id,label:fullName(row)}))};
 }catch{return {status:signal?.aborted?"cancelled":"unavailable"};}
}

export async function resolvePatient(db: Pick<DbPort, "rpc">, input: { readonly patientId?: string; readonly name?: string }, signal?: AbortSignal, asOf?:string): Promise<PatientResolution> {
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
        if(name.trim().split(/\s+/u).length<2)return {status:"absent"};
        const archived=await resolveArchivedName(db,name,asOf??new Date().toISOString(),signal);
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
      if (!complete || exact.length !== 1) {
        return { status: "ambiguous", candidates: candidates.map((row) => ({ patientId: row.id, label: fullName(row) })) };
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
