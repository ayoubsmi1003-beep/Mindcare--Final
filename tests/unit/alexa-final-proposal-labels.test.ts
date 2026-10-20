import {it,expect} from "vitest";
import {alexaProposalLabels} from "@/services/alexa-proposal";
import {ok} from "@/services/result";
import type {DbPort} from "@/services/db/port";
const patientId="11111111-1111-4111-8111-111111111111",consultationId="22222222-2222-4222-8222-222222222222";
const proposal={tool:"set_consultation_price",args:{consultationId,amountDzd:3000}};
function port(owner=patientId):Pick<DbPort,"rpc">{return {rpc:async<T>(name:string)=>ok([name==="get_patient"?{id:patientId,first_name:"Synthetic",last_name:"Patient"}:{id:consultationId,patient_id:owner,started_at:"2026-10-05T09:00:00Z"}] as T[]) };}
it("shows the audited patient and consultation date while retaining canonical UUID arguments",async()=>{
 const labels=await alexaProposalLabels(proposal,patientId,port());
 expect(labels.get(consultationId)).toContain("Synthetic Patient");
 expect(labels.get(consultationId)).toContain("10:00");
 expect(proposal.args.consultationId).toBe(consultationId);
});
it("refuses a target belonging to another patient",async()=>{
 await expect(alexaProposalLabels(proposal,patientId,port("33333333-3333-4333-8333-333333333333"))).rejects.toThrow("ProposalIdentityUnavailable");
});
it("refuses an absent identity and conflicting direct patient argument",async()=>{
 await expect(alexaProposalLabels(proposal,null,port())).rejects.toThrow("ProposalIdentityUnavailable");
 await expect(alexaProposalLabels({tool:"create_appointment",args:{patientId:consultationId}},patientId,port())).rejects.toThrow("ProposalIdentityUnavailable");
});
