import type {DocumentNode} from "@/shared/documents/types";
import {documentsEditor as t} from "@/i18n/documents-editor";
import {hasSpecialSchedule,parseExplicitDailyFrequency} from "@/shared/documents/autofill";
type Attributes = NonNullable<DocumentNode["attrs"]>;
const prescribedDosePrefix=`${t.prescribedDose} : `;
export function setDailyFrequency(attrs:Attributes,value:string):Attributes {
 const valid=/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value));
 const previous=[...new Set([String(attrs["frequency"]??"").trim(),String(attrs["posology"]??"").trim()])];
 const instructions=String(attrs["instructions"]??"");
 const next=valid?`${value} fois par jour`:"";
 const preserved=[instructions,...previous.filter(value=>value && parseExplicitDailyFrequency(value)===null && !instructions.includes(value))].filter(Boolean).join("\n");
 return {...attrs,posology:hasSpecialSchedule(preserved)?"":next,frequency:hasSpecialSchedule(preserved)?next:"",instructions:preserved};
}
export function setMedicationInstructions(attrs:Attributes,instructions:string):Attributes {
 const review=hasSpecialSchedule(instructions);
 return {...attrs,instructions,posology:review?"":attrs["posology"]??"",frequency:review?attrs["frequency"]||attrs["posology"]||"":attrs["frequency"]??""};
}
export function dailyFrequency(attrs:Attributes):string {
 return /^([1-9][0-9]*) fois par jour$/.exec(String(attrs["posology"]??""))?.[1]??"";
}
export function confirmSpecialSchedule(attrs:Attributes,confirmed:boolean):Attributes {
 const original=String(attrs["frequency"]||attrs["posology"]||"").trim();
 return {...attrs,posology:confirmed?original:"",frequency:confirmed?"":original};
}
export function setMedicationName(attrs:Attributes,value:string):Attributes {
 return {...attrs,designation:value,source:"free-text",medicationId:null,strength:""};
}
export function prescribedDose(attrs:Attributes):string {
 const line=String(attrs["instructions"]??"").split("\n").find(value=>value.startsWith(prescribedDosePrefix));
 return line?.slice(prescribedDosePrefix.length)??"";
}
export function setPrescribedDose(attrs:Attributes,value:string):Attributes {
 const lines=String(attrs["instructions"]??"").split("\n").filter(line=>line!==""&&!line.startsWith(prescribedDosePrefix));
 const dose=value.trim();
 return {...attrs,instructions:[...(dose?[prescribedDosePrefix+dose]:[]),...lines].join("\n")};
}
