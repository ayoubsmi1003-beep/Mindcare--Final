import type {DocumentNode} from "@/shared/documents/types";
type Attributes = NonNullable<DocumentNode["attrs"]>;
export function setDailyFrequency(attrs:Attributes,value:string):Attributes {
 const valid=/^[1-9][0-9]*$/.test(value)&&Number.isSafeInteger(Number(value));
 return {...attrs,posology:valid?`${value} fois par jour`:"",frequency:""};
}
export function dailyFrequency(attrs:Attributes):string {
 return /^([1-9][0-9]*) fois par jour$/.exec(String(attrs["posology"]??""))?.[1]??"";
}
export function setMedicationName(attrs:Attributes,value:string):Attributes {
 return {...attrs,designation:value,source:"free-text",medicationId:null};
}
