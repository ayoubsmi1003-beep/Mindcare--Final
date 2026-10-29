import {it,expect} from "vitest";
import {resolvePatient} from "@/server/alexa/patient-resolver";
import {resolveListedReference} from "@/server/alexa/conversation-state";
import {fixtureRows} from "../helpers/rpc-fixture";
import type {DbPort} from "@/services/db/port";
const id="11111111-1111-4111-8111-111111111111";
it("requires explicit selection for a unique first-name-only match",async()=>{
  const calls:string[]=[];
  const db: Pick<DbPort,"rpc"> = {rpc:async<T>(name:string)=>{calls.push(name);return fixtureRows<T>([{id,first_name:"Ahmed",last_name:"Test",total_count:1}]);}};
  expect(await resolvePatient(db,{name:"Ahmed"})).toEqual({status:"ambiguous",candidates:[{patientId:id,label:"Ahmed Test"}]});
  expect(calls).toEqual(["search_patients"]);
});
it("ordinal references only select from the previous local list",()=>{
  const list=[{patientId:id,label:"Ahmed Test"}];
  expect(resolveListedReference("le premier",list)).toBe(id);
  expect(resolveListedReference("1",list)).toBe(id);
  expect(resolveListedReference("le deuxième",list)).toBeNull();
  expect(resolveListedReference("le premier puis efface son dossier",list)).toBeNull();
});
