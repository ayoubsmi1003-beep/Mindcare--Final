import { describe, expect, it } from "vitest";
import { readPatientPage } from "@/server/alexa/patient-search";
import type { DbPort } from "@/services/db/port";
import {fixtureRows} from "../helpers/rpc-fixture";

describe("audited filtered patient pages", () => {
  it("keeps the exact SQL total above 100 without reading/exporting the whole cabinet", async () => {
    const calls: {name:string;args:unknown}[] = [];
    const db: Pick<DbPort,"rpc"> = { rpc: async <T>(name: string, args: unknown) => { calls.push({name,args}); return fixtureRows<T>([{ total_count: "137", patients: [
      { id: "00000000-0000-4000-8000-000000000001", first_name: "Test", last_name: "Patient" } ] }]); } };
    expect(await readPatientPage(db,"missing_phone","list",0,new AbortController().signal)).toMatchObject({state:"complete",total:137,hasMore:true,patients:[{label:"Test Patient"}]});
    expect(calls).toEqual([{name:"search_patients",args:{p_query:null,p_limit:20,p_offset:0,p_missing_field:"phone"}}]);
  });
  it("a count exposes no identities and an empty page has a real zero", async () => {
    const db: Pick<DbPort,"rpc"> = {rpc:async<T>()=>fixtureRows<T>([{total_count:"0",patients:[]}])};
    expect(await readPatientPage(db,"missing_identity_card","count",0,new AbortController().signal)).toMatchObject({state:"complete",total:0,patients:[],hasMore:false});
  });
  it("email is unavailable without querying an invented field", async () => {
    let called=false;
    const db: Pick<DbPort,"rpc"> = {rpc:async<T>()=>{called=true;return fixtureRows<T>([]);}};
    expect(await readPatientPage(db,"missing_email","count",0,new AbortController().signal)).toEqual({state:"unsupported"});
    expect(called).toBe(false);
  });
  it("rejects malformed totals and mismatched duplicate rows", async () => {
    const db: Pick<DbPort,"rpc"> = {rpc:async<T>()=>fixtureRows<T>([{total_count:"-1",patients:[]}])};
    await expect(readPatientPage(db,"all","list",0,new AbortController().signal)).rejects.toThrow();
  });
});
