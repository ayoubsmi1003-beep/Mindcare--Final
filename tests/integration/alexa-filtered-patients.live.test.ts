import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { withCaller } from "@/server/db/withCaller";
import { fermerPool } from "@/server/db/pool";
import { faireePgPort } from "@/server/db/pgPort";
import { readPatientPage } from "@/server/alexa/patient-search";
const url = process.env["MINDCARE_TEST_DATABASE_URL"];
const owner = "00000000-0000-0000-0000-0000000000a1";
const practitioner = "00000000-0000-0000-0000-0000000000a2";
const assistant = "00000000-0000-0000-0000-0000000000a3";
const db = (actor: string) => ({ rpc: <T>(name: string, args: import("@/services/db/port").RpcArgs) => withCaller(actor, q => faireePgPort(q).rpc<T>(name,args)) });
beforeAll(async () => {
  if (!url) return;
  const parsed=new URL(url);
  if(parsed.hostname!=="127.0.0.1"||parsed.port!=="55443")throw new Error("DisposableAlexaClusterRequired");
  process.env["MINDCARE_DATABASE_URL"]=url;
  // Real business gate creates the artificial test cohort; no answer injection.
  const existing=await db(owner).rpc<{total_count:number}>("search_patients",{p_query:"FinalAcceptance",p_limit:100,p_offset:0});
  if(!existing.ok)throw new Error("FixtureSearchFailed");
  if(existing.data.length===0)for(let i=0;i<130;i++){
    const created=await db(owner).rpc("create_patient",{p_charge:JSON.stringify({first_name:"FinalAcceptance",last_name:`Case${String(i).padStart(3,"0")}`,phone:`000000${String(i).padStart(4,"0")}`,practitioner_id:i<10?practitioner:owner})});
    if(!created.ok)throw new Error("FixtureCreationFailed");
  }
},60000);
afterAll(async()=>{if(url)await fermerPool();});
describe.skipIf(!url)("audited filtered search on real isolated PostgreSQL",()=>{
  it.each([owner,practitioner,assistant])("keeps audited pagination and historical signature for role %s",async actor=>{
    const result=await db(actor).rpc<{total_count:number;patients:{id:string}[]}>("search_patients",{p_query:"FinalAcceptance",p_limit:20,p_offset:0,p_missing_field:null});
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    const page=result.data[0]!;
    expect(Number(page.total_count)).toBe(actor===practitioner?10:130);expect(page.patients).toHaveLength(actor===practitioner?10:20);
    const old=await db(actor).rpc<{id:string}>("search_patients",{p_query:"FinalAcceptance",p_limit:10,p_offset:0});
    expect(old.ok&&old.data.length).toBe(10);
  });
  it("counts beyond 100 without loading identities and pages independently",async()=>{
    const count=await readPatientPage(db(owner),"all","count",0,new AbortController().signal);
    expect(count).toMatchObject({state:"complete",patients:[]});
    if(count.state!=="complete")return;
    expect(count.total).toBeGreaterThan(100);
    const first=await readPatientPage(db(owner),"all","list",0,new AbortController().signal);
    const next=await readPatientPage(db(owner),"all","list",20,new AbortController().signal);
    expect(first.state).toBe("complete");expect(next.state).toBe("complete");
    if(first.state==="complete"&&next.state==="complete")expect(new Set([...first.patients,...next.patients].map(p=>p.id)).size).toBe(40);
  });
  it("missing required phone really returns zero; unsupported email uses no SQL",async()=>{
    expect(await readPatientPage(db(owner),"missing_phone","count",0,new AbortController().signal)).toMatchObject({state:"complete",total:0,patients:[]});
    expect(await readPatientPage({rpc:()=>{throw new Error("EmailMustNotRead");}},"missing_email","list",0,new AbortController().signal)).toEqual({state:"unsupported"});
  });
  it("assistant clinical context is unavailable and another practitioner's dossier is hidden",async()=>{
    const scope="a1000000-0000-4000-8000-000000001001";
    for(const actor of [assistant,practitioner]){
      const read=await db(actor).rpc<unknown>("get_alexa_clinical_context",{p_patient_id:scope,p_limit:1,p_before_at:null,p_before_id:null});
      expect(read.ok).toBe(true);if(read.ok)expect(read.data).toEqual([]);
    }
  });
});
