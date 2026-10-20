import {it,expect} from "vitest";
import {readPatientRecords} from "@/server/alexa/patient-records";
import {fixtureRows} from "../helpers/rpc-fixture";
import type {DbPort} from "@/services/db/port";
it("reads native PostgreSQL date values without shifting the birth calendar day",async()=>{
 const id="11111111-1111-4111-8111-111111111111";
 const port: Pick<DbPort,"rpc"> = {rpc:async<T>()=>fixtureRows<T>([{id,first_name:"Synthetic",last_name:"Patient",record_number:"T-1",phone:"0000000000",birth_date:new Date(2000,0,13),age:26}])};
 expect((await readPatientRecords(port,id,"profile","fr",new AbortController().signal))[0]?.text).toContain("2000-01-13");
});
