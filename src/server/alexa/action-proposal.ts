import { z } from "zod";
import type { DbPort } from "@/services/db/port";
import type { ClientSql } from "@/server/jarvis/client-sql";
import type { AlexaProposal, TurnInput } from "@/shared/alexa/turn";
import { capaciteEcriture } from "@/services/jarvis-ecritures";
import { agendaSelection } from "@/shared/alexa/agenda-plan";
import { readAgendaDay } from "./agenda-adapter";
import { resolvePatient } from "./patient-resolver";
import { parsePatientMention } from "./patient-mention";

export type ProposalResult = {state:"ready";proposal:AlexaProposal;patientId:string}|{state:"missing";slot:"patient"|"date"|"content"|"operation"}|{state:"unavailable"};
/** Compile explicit bounded action arguments. Never executes, confirms or grants authority. */
export async function prepareActionProposal(input:TurnInput,db:Pick<DbPort,"rpc">,client:ClientSql,signal:AbortSignal):Promise<ProposalResult> {
  const text=input.text.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().trim();
  // Only literal imperatives are shortcuts. Quoted notes/help are not commands.
  let tool:string|null=/^(?:fixe|fixer|mets|mettre|change|changer|modifie|modifier)\b/u.test(text)&&/\b(?:tarif|prix)\b/u.test(text)?"set_consultation_price"
    : /^(?:encaisse|encaisser)\b/u.test(text)?"record_payment_collected"
    : /^(?:prepare|preparer|cree|creer)\b/u.test(text)&&/\bbrouillon\b/u.test(text)?"create_document_draft"
    : /^(?:planifie|planifier|cree|creer|prends|prendre)\b/u.test(text)&&/\b(?:rendez[- ]vous|rdv)\b/u.test(text)?"create_appointment"
    : /^(?:decale|decaler|deplace|deplacer|reporte|reporter)\b/u.test(text)&&/\b(?:rendez[- ]vous|rdv)\b/u.test(text)?"reschedule_appointment"
    : /^(?:annule|annuler)\b/u.test(text)&&/\b(?:rendez[- ]vous|rdv)\b/u.test(text)?"cancel_appointment"
    : /^(?:marque|marquer|signale|signaler)\b/u.test(text)&&/\barrive/u.test(text)?"mark_patient_arrived":null;
  if(!tool||!capaciteEcriture(tool))return {state:"missing",slot:"operation"};
  const mention=parsePatientMention(input.text);
  if(mention.status==="ambiguous")return {state:"missing",slot:"patient"};
  const name=input.patientName??(mention.status==="named"?mention.name:undefined);
  const patient=await resolvePatient(db,name?{name}:input.appContext.patientId?{patientId:input.appContext.patientId}:{},signal);
  if(patient.status!=="resolved")return {state:"missing",slot:"patient"};
  const args:AlexaProposal["args"]={};
  if(["set_consultation_price","record_payment_collected","create_document_draft"].includes(tool)) {
    const match=/^\/consultation\/([0-9a-f-]{36})$/iu.exec(input.appContext.page);
    if(!match||!z.uuid().safeParse(match[1]).success)return {state:"missing",slot:"content"};
    const result=await db.rpc<unknown>("get_consultation",{p_id:match[1]!});signal.throwIfAborted();
    const parsed=result.ok?z.object({id:z.uuid(),patient_id:z.uuid()}).safeParse(result.data[0]):null;
    if(!parsed?.success||parsed.data.id!==match[1]||parsed.data.patient_id!==patient.patientId)return {state:"unavailable"};
    args["consultationId"]=parsed.data.id;
    if(tool==="set_consultation_price") {
      if(/[+−-]\s*\d|\d\s*[.,]\s*\d/u.test(text))return {state:"missing",slot:"content"};
      const values=[...text.matchAll(/(?<![\p{L}\p{N}.,])\d+(?![\p{L}\p{N}.,])/gu)];
      if(values.length!==1||Number(values[0]![0])>1000000)return {state:"missing",slot:"content"};
      args["amountDzd"]=Number(values[0]![0]);
    } else if(tool==="record_payment_collected") {
      const payment=await db.rpc<unknown>("get_consultation_payment",{p_consultation_id:parsed.data.id});signal.throwIfAborted();
      const row=payment.ok?z.object({payment_id:z.uuid()}).safeParse(payment.data[0]):null;
      if(!row?.success)return {state:"unavailable"};
      args["paymentId"]=row.data.payment_id;
    } else {
      const type=/bonne sante/u.test(text)?"bonne_sante_mentale":/suivi medical/u.test(text)?"suivi_medical":/certificat medical/u.test(text)?"certificat_medical":/justification/u.test(text)?"justification":null;
      if(!type)return {state:"missing",slot:"content"};args["documentType"]=type;
    }
  } else {
    const selection=agendaSelection(input.text);
    if(!selection)return {state:"missing",slot:"date"};
    const times=[...text.matchAll(/(?<!\d)([01]\d|2[0-3])[:h]([0-5]\d)(?!\d)/gu)];
    if(tool==="create_appointment"||tool==="reschedule_appointment") {
      if(times.length!==1)return {state:"missing",slot:"date"};
      const explicitDay=/\d{4}-\d{2}-\d{2}|aujourd|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/u.test(text);
      if(!explicitDay)return {state:"missing",slot:"date"};
      const startsAt=`${selection.day}T${times[0]![1]}:${times[0]![2]}:00+01:00`;
      if(tool==="create_appointment") {args["patientId"]=patient.patientId;args["startsAt"]=startsAt;
        const durations=[...text.matchAll(/(?<![\p{L}\p{N}])([+−-]?\d[\d.,]*)\s*(?:minutes|min)\b/gu)];
        if(durations.length>1||(durations.length===1&&!/^\d{1,3}$/u.test(durations[0]![1]!))
          ||(!durations.length&&/\b(?:minutes|min)\b/u.test(text)))return {state:"missing",slot:"content"};
        args["durationMinutes"]=durations.length?Number(durations[0]![1]):45;
        if(Number(args["durationMinutes"])<5||Number(args["durationMinutes"])>240)return {state:"missing",slot:"content"};
      } else args["nouveauDebut"]=startsAt;
    }
    if(tool!=="create_appointment") {
      // A destination date cannot identify the appointment being moved.
      // Until an explicit appointment reference is carried, ask for its source.
      if(tool==="reschedule_appointment")return {state:"missing",slot:"date"};
      const day=selection.day;
      const appointments=(await readAgendaDay(client,day,false,signal)).filter(row=>row.patient_id===patient.patientId);
      if(appointments.length!==1)return {state:"missing",slot:"date"};
      args["appointmentId"]=appointments[0]!.id;
      if(tool==="cancel_appointment") {
        const reason=/(?:motif|raison)\s*:\s*(.{3,300})$/iu.exec(input.text);
        if(!reason)return {state:"missing",slot:"content"};args["motif"]=reason[1]!.trim();
      }
    }
  }
  signal.throwIfAborted();
  // Revalidate the selected dossier immediately before publishing the proposal.
  if((await resolvePatient(db,{patientId:patient.patientId},signal)).status!=="resolved")return {state:"unavailable"};
  return {state:"ready",proposal:{tool,args},patientId:patient.patientId};
}
