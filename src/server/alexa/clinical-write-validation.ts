import {z} from "zod";
import type {ClinicalTreatment} from "@/shared/alexa/clinical";
import type {Variables} from "@/shared/documents/types";

type TreatmentFieldChanges=Readonly<{
 dose?:string|undefined;doseUnit?:string|undefined;frequency?:string|undefined;timing?:readonly string[]|undefined;instructions?:string|undefined;startDate?:string|undefined;endDate?:string|null|undefined;
}>;

function normaliser(value:string):string{
 const chiffres:Readonly<Record<string,string>>={un:"1",une:"1",deux:"2",trois:"3",quatre:"4",cinq:"5",six:"6",sept:"7",huit:"8",neuf:"9",dix:"10"};
 return value.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("fr-FR")
  .replace(/(\d)([a-zµ]+)/gu,"$1 $2").replace(/[’']/gu," ").replace(/[^\p{L}\p{N}µ]+/gu," ").trim()
  .split(/\s+/u).map(token=>chiffres[token]??token).join(" ");
}

function contient(haystack:string,needle:string):boolean{
 const text=` ${normaliser(haystack)} `,value=normaliser(needle);
 return !!value&&text.includes(` ${value} `);
}

export type TreatmentTargetResolution=
 |{readonly state:"resolved";readonly treatment:ClinicalTreatment}
 |{readonly state:"missing"}
 |{readonly state:"ambiguous"};

const treatmentChangesSchema=z.object({
 dose:z.string().trim().min(1).max(300).optional(),doseUnit:z.string().trim().min(1).max(80).optional(),
 frequency:z.string().trim().min(1).max(300).optional(),timing:z.array(z.string().trim().min(1).max(80)).max(8).optional(),
 instructions:z.string().trim().min(1).max(1000).optional(),startDate:z.iso.date().optional(),endDate:z.iso.date().nullable().optional(),
}).strict();

/** Resolve only from the current patient snapshot and explicit request language. */
export function resolveTreatmentTarget(
 current:readonly ClinicalTreatment[],
 proposedName:string|undefined,
 requestText:string,
):TreatmentTargetResolution{
 const eligible=current.filter(treatment=>treatment.status==="active"||treatment.status==="paused");
 const mentioned=eligible.filter(treatment=>contient(requestText,treatment.medication));
 if(mentioned.length===1)return {state:"resolved",treatment:mentioned[0]!};
 if(mentioned.length>1)return {state:"ambiguous"};

 const genericTarget=/\b(?:traitement|medicament|ordonnance)\b/u.test(normaliser(requestText));
 if(genericTarget&&eligible.length===1)return {state:"resolved",treatment:eligible[0]!};
 if(genericTarget&&eligible.length>1)return {state:"ambiguous"};

 // A model-proposed name is useful only when it is present in the user's words;
 // it cannot choose between otherwise unmentioned current treatments.
 if(proposedName&&contient(requestText,proposedName)){
  const proposed=eligible.filter(treatment=>contient(treatment.medication,proposedName)||contient(proposedName,treatment.medication));
  if(proposed.length===1)return {state:"resolved",treatment:proposed[0]!};
  if(proposed.length>1)return {state:"ambiguous"};
 }
 return {state:"missing"};
}

function isDoseValueGrounded(dose:string,doseUnit:string|undefined,requestText:string):boolean{
 if(!contient(requestText,dose))return false;
 const units="mg|g|mcg|µg|microgrammes?|ml|l|comprim(?:e|es)|gouttes?|capsules?|%";
 const requestedAmounts=[...normaliser(requestText).matchAll(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s*(?:(${units}))\\b`,"gu"))];
 if(requestedAmounts.length===0)return true;
 const selected=normaliser(dose).match(/\d+(?:[.,]\d+)?/u)?.[0];
 const last=requestedAmounts.at(-1)?.[1];
 if(!selected||!last||selected!==last)return false;
 if(doseUnit&&/[a-zµ%]/u.test(normaliser(doseUnit))){
  const selectedUnit=normaliser(doseUnit).split(" ")[0];
  const lastUnit=requestedAmounts.at(-1)?.[2];
  if(selectedUnit&&lastUnit&&selectedUnit!==lastUnit)return false;
 }
 return true;
}

function isDateGrounded(value:string,requestText:string):boolean{
 if(contient(requestText,value))return true;
 const match=/^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
 if(!match)return false;
 const [,year,month,day]=match;
 return contient(requestText,`${day}/${month}/${year}`)||contient(requestText,`${day}-${month}-${year}`);
}

/** Refuse invented values and emits only keys understood by app.update_treatment. */
export function groundTreatmentChanges(rawChanges:unknown,requestText:string):Readonly<Record<string,unknown>>{
 const changes:TreatmentFieldChanges=treatmentChangesSchema.parse(rawChanges);
 const output:Record<string,unknown>={};
 if(changes.dose!==undefined){if(!isDoseValueGrounded(changes.dose,changes.doseUnit,requestText))throw new Error("UnrequestedTreatmentDose");output.dose=changes.dose;}
 if(changes.doseUnit!==undefined){if(!contient(requestText,changes.doseUnit))throw new Error("UnrequestedTreatmentDoseUnit");output.dose_unit=changes.doseUnit;}
 if(changes.frequency!==undefined){if(!contient(requestText,changes.frequency))throw new Error("UnrequestedTreatmentFrequency");output.frequency=changes.frequency;}
 if(changes.timing!==undefined){if(!changes.timing.length||changes.timing.some(value=>!contient(requestText,value)))throw new Error("UnrequestedTreatmentTiming");output.timing=changes.timing;}
 if(changes.instructions!==undefined){if(!contient(requestText,changes.instructions))throw new Error("UnrequestedTreatmentInstructions");output.instructions=changes.instructions;}
 if(changes.startDate!==undefined){if(!isDateGrounded(changes.startDate,requestText))throw new Error("UnrequestedTreatmentStartDate");output.start_date=changes.startDate;}
 if(changes.endDate!==undefined){
  if(changes.endDate===null){if(!/\bsans date de fin\b/u.test(normaliser(requestText)))throw new Error("UnrequestedTreatmentEndDate");}
  else if(!isDateGrounded(changes.endDate,requestText))throw new Error("UnrequestedTreatmentEndDate");
  output.end_date=changes.endDate;
 }
 if(Object.keys(output).length===0)throw new Error("TreatmentChangeRequired");
 return output;
}

export type StopTreatmentReason="inefficacite"|"effets_indesirables"|"amelioration"|"decision_clinique"|"autre";
const stopReasonEvidence:Readonly<Record<StopTreatmentReason,readonly string[]>>={
 inefficacite:["inefficace","inefficacite","ne fonctionne pas","ne marche pas"],
 effets_indesirables:["effets indesirables","effets secondaires","effet indesirable"],
 amelioration:["amelioration","va mieux","se sent mieux","symptomes resolus"],
 decision_clinique:["decision clinique","ma decision clinique"],
 autre:["autre raison","pour une autre raison"],
};
export function groundStopReason(reason:StopTreatmentReason|undefined,requestText:string):StopTreatmentReason|null{
 if(!reason)return null;
 if(!stopReasonEvidence[reason].some(phrase=>contient(requestText,phrase)))throw new Error("UnrequestedTreatmentStopReason");
 return reason;
}

/** Existing variables are the field allowlist; changed values must be spoken by the doctor. */
export function groundDraftFieldChanges(
 changes:Readonly<Record<string,string>>,
 variables:Variables,
 requestText:string,
):Readonly<Record<string,string>>{
 const keys=Object.keys(changes);
 if(keys.length===0)throw new Error("DraftFieldsRequired");
 for(const key of keys){
  const value=changes[key];
  if(!Object.hasOwn(variables,key))throw new Error("UnknownDraftField");
  if(typeof value!=="string"||!value.trim()||!contient(requestText,value))throw new Error("UnrequestedDraftValue");
 }
 return changes;
}
