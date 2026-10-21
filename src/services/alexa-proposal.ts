import {z} from "zod";
import type {DbPort} from "./db/port";
import type {AlexaProposal} from "@/shared/alexa/turn";
const patient=z.object({id:z.uuid(),first_name:z.string().min(1),last_name:z.string().min(1)});
const target=z.object({id:z.uuid(),patient_id:z.uuid(),started_at:z.string().optional(),starts_at:z.string().optional()});
/** Local audited presentation only. UUID arguments and SQL authority stay intact. */
export async function alexaProposalLabels(proposal:AlexaProposal,patientId:string|null,port:Pick<DbPort,"rpc">):Promise<ReadonlyMap<string,string>> {
 if(!patientId||!z.uuid().safeParse(patientId).success)throw new Error("ProposalIdentityUnavailable");
 const r=await port.rpc<unknown>("get_patient",{p_id:patientId});const p=r.ok?patient.safeParse(r.data[0]):null;
 if(!r.ok||!p?.success||r.data.length!==1||p.data.id!==patientId)throw new Error("ProposalIdentityUnavailable");
 const label=`${p.data.first_name} ${p.data.last_name}`,labels=new Map<string,string>([[patientId,label]]);
 for(const [key,gate] of [["consultationId","get_consultation"],["appointmentId","get_appointment"]] as const){
  const id=proposal.args[key];if(id===undefined)continue;if(typeof id!=="string"||!z.uuid().safeParse(id).success)throw new Error("ProposalIdentityUnavailable");
  const result=await port.rpc<unknown>(gate,{p_id:id});const item=result.ok?target.safeParse(result.data[0]):null;
  if(!result.ok||!item?.success||result.data.length!==1||item.data.id!==id||item.data.patient_id!==patientId)throw new Error("ProposalIdentityUnavailable");
  const date=item.data.started_at??item.data.starts_at;if(!date||!Number.isFinite(Date.parse(date)))throw new Error("ProposalIdentityUnavailable");
  labels.set(id,`${label} · ${new Intl.DateTimeFormat("fr-DZ",{timeZone:"Africa/Algiers",dateStyle:"short",timeStyle:"short"}).format(new Date(date))}`);
 }
 if(proposal.args["patientId"]!==undefined&&proposal.args["patientId"]!==patientId)throw new Error("ProposalIdentityUnavailable");
 return labels;
}
