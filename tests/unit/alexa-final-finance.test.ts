import {it,expect} from "vitest";
import {readPatientFinance} from "@/server/alexa/patient-finance";
import {fixtureRows} from "../helpers/rpc-fixture";
import type {DbPort} from "@/services/db/port";
const id="11111111-1111-4111-8111-111111111111",event="22222222-2222-4222-8222-222222222222";
it("counts a consultation only once and preserves a real zero tariff",async()=>{
 const calls:string[]=[];
 const db: Pick<DbPort,"rpc"> = {rpc:async<T>(name:string)=>{calls.push(name);return fixtureRows<T>(name==="get_patient_workspace"?[{identite:{id},clinique:{}}]:name==="list_patient_timeline"?[{event_id:event,occurred_at:"2026-01-01",label_key:"consultation_close"},{event_id:event,occurred_at:"2026-01-01",label_key:"consultation_ouverte"}]:[{payment_id:id,amount_dzd:0,collected_at:null}]);}};
 expect(await readPatientFinance(db,id,new AbortController().signal)).toMatchObject({consultations:1,pending:0,collected:0,unavailable:0,complete:true});expect(calls.filter(c=>c==="get_consultation_payment")).toHaveLength(1);
});
it("an unavailable clinical workspace never becomes zero financial activity",async()=>{
 const db: Pick<DbPort,"rpc"> = {rpc:async<T>()=>fixtureRows<T>([{identite:{id},clinique:null}])};
 await expect(readPatientFinance(db,id,new AbortController().signal)).rejects.toThrow("PatientFinanceUnavailable");
});
