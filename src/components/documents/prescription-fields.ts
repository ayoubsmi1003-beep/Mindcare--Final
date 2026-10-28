import type {DocumentNode} from "@/shared/documents/types";
import {documentsEditor as t} from "@/i18n/documents-editor";
type Attributes = NonNullable<DocumentNode["attrs"]>;
const prescribedDosePrefix=`${t.prescribedDose} : `;
export function setDailyFrequency(attrs:Attributes,value:string):Attributes {
 const valid=/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value));
 return {...attrs,posology:valid?`${value} fois par jour`:"",frequency:""};
}
export function dailyFrequency(attrs:Attributes):string {
 return /^([1-9][0-9]*) fois par jour$/.exec(String(attrs["posology"]??""))?.[1]??"";
}
export function setMedicationName(attrs:Attributes,value:string):Attributes {
 return {...attrs,designation:value,source:"free-text",medicationId:null,strength:"",posology:"",quantity:"",frequency:"",duration:"",administration:"",instructions:""};
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
