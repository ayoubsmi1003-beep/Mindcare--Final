import { z } from "zod";
import type { DbPort } from "@/services/db/port";
import type { AlexaEvent } from "@/shared/alexa/turn";
import { financeCopy } from "@/i18n/alexa-semantic";

const date=z.preprocess(value=>value instanceof Date?value.toISOString():value,z.string().min(10));
const timeline=z.array(z.object({event_id:z.uuid(),occurred_at:date,label_key:z.string()})).max(50);
const payment=z.object({payment_id:z.uuid(),amount_dzd:z.number().int().nonnegative().safe(),collected_at:date.nullable()});
export interface PatientFinance {collected:number;pending:number;unavailable:number;consultations:number;complete:boolean;ids:string[]}
/** Same audited workspace/timeline/payment doors as the existing finance capability. */
export async function readPatientFinance(db:Pick<DbPort,"rpc">,patientId:string,signal:AbortSignal):Promise<PatientFinance> {
  signal.throwIfAborted();
  const workspace=await db.rpc<unknown>("get_patient_workspace",{p_id:patientId});signal.throwIfAborted();
  const parsed=workspace.ok?z.object({identite:z.object({id:z.uuid()}),clinique:z.record(z.string(),z.unknown()).nullable()}).safeParse(workspace.data[0]):null;
  if(!parsed?.success||parsed.data.identite.id!==patientId||parsed.data.clinique===null)throw new Error("PatientFinanceUnavailable");
  const result=await db.rpc<unknown>("list_patient_timeline",{p_id:patientId,p_before_at:null,p_before_id:null,p_limit:50});signal.throwIfAborted();
  const rows=result.ok?timeline.parse(result.data):null;if(!rows)throw new Error("PatientFinanceUnavailable");
  // Opening and closing events can identify the same consultation: count it once.
  const ids=[...new Set(rows.filter(r=>r.label_key==="consultation_close"||r.label_key==="consultation_ouverte").map(r=>r.event_id))];
  const selected=ids.slice(0,10),summary:PatientFinance={collected:0,pending:0,unavailable:0,consultations:selected.length,complete:rows.length<50&&ids.length<=10,ids:selected};
  for(const id of selected){const r=await db.rpc<unknown>("get_consultation_payment",{p_consultation_id:id});signal.throwIfAborted();
    if(!r.ok||r.data.length>1)throw new Error("PatientFinanceUnavailable");
    if(!r.data.length){summary.unavailable++;continue;}
    const p=payment.parse(r.data[0]);if(p.collected_at===null)summary.pending+=p.amount_dzd;else summary.collected+=p.amount_dzd;
    if(!Number.isSafeInteger(summary.pending)||!Number.isSafeInteger(summary.collected))throw new Error("PatientFinanceUnavailable");
  }
  return summary;
}
export function patientFinanceSentence(summary:PatientFinance,language:"fr"|"ar"|"mixed"):Extract<AlexaEvent,{type:"sentence"}> {
  return {type:"sentence",kind:"fact",text:financeCopy[language==="fr"?"fr":"ar"](summary),sources:summary.ids.map(id=>({id,type:"consultation",label:id}))};
}
