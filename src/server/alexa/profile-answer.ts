import {z} from 'zod';
import {alexaRecordCopy} from '@/i18n/alexa-records';
import {profileCopy} from '@/i18n/alexa-profile';
const text=z.string().nullable();
export const patientProfileSchema=z.object({id:z.uuid(),record_number:z.string(),first_name:z.string(),last_name:z.string(),birth_date:z.union([z.string(),z.date()]).nullable(),phone:text,phone_alt:text,id_document_number:text,id_document_issuer:text,sex:text,marital_status:text,address:text,emergency_contact:z.json(),notes_admin:text,is_active:z.boolean()});
type Field=keyof typeof alexaRecordCopy.fr.profile|'age';
function requestedProfileFields(question:string):Field[]|null{
 const copy=alexaRecordCopy.fr,requested=new Set<Field>(),plain=question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const emergencyRequested=/\burgence|personne a (?:contacter|prevenir)\b/u.test(plain);
 if(emergencyRequested)requested.add('emergency_contact');
 if(/\b(?:telephones?|tel|mobiles?|portables?)\b/u.test(plain)&&(!emergencyRequested||/\bet\b/u.test(plain))){
  if(/\bsecondaire|autre numero|deuxieme numero\b/u.test(plain))requested.add('phone_alt');
  if(/\btelephones\b/u.test(plain)&&! /\bsecondaires?\b/u.test(plain))requested.add('phone_alt');
  if(!requested.has('phone_alt')||/\btelephones\b/u.test(plain)&&! /\bsecondaires?\b/u.test(plain)||/\bprincipal\b/u.test(plain))requested.add('phone');
 }
 if(/\bcoordonnees?\b/u.test(plain))for(const key of ['phone','phone_alt','address'] as const)requested.add(key);
 if(/\b(?:identite|cni|cin)|carte d.identite|piece d.identite/u.test(plain))requested.add('id_document_number');
 if(/\b(?:delivr\w*|emetteur|autorite)\b/u.test(plain))requested.add('id_document_issuer');
 if(/\badresses?\b/u.test(plain))requested.add('address');
 if(/\bnaissance\b/u.test(plain))requested.add('birth_date');
 if(/\bages?\b/u.test(plain))requested.add('age');
 if(/\bsexes?\b/u.test(plain))requested.add('sex');
 if(/\bsituation familiale|\betat civil\b/u.test(plain))requested.add('marital_status');
 if(/\bnumero (?:de|du) dossier|\breference (?:de|du) dossier\b/u.test(plain))requested.add('record_number');
 if(/\bnotes? administrati\w*\b/u.test(plain))requested.add('notes_admin');
 if(/\b(?:statuts?|actifs?|actives?|archive\w*)\b/u.test(plain))requested.add('is_active');
 const broad=/\b(?:toutes? les informations|fiches?|profils?|(?:informations|donnees|renseignements) (?:administrati\w*|generales)|dossier administratif(?: complet)?)\b/u.test(plain);
 return broad?Object.keys(copy.profile) as (keyof typeof copy.profile)[]:requested.size?[...requested]:null;
}
export const profileNeedsClarification=(question:string):boolean=>requestedProfileFields(question)===null;
export function profileAnswer(p:z.infer<typeof patientProfileSchema>,question:string,asOf:string):string{
 const copy=alexaRecordCopy.fr,labels:Readonly<Record<string,string>>=copy.labels;
 const display=(value:unknown):string=>value instanceof Date?value.toISOString().slice(0,10):typeof value==='string'?labels[value.trim()]??(value.trim()||copy.missing):copy.missing;
 const emergency=z.object({name:text.nullish(),relation:text.nullish(),phone:text.nullish()}).safeParse(p.emergency_contact);
 const contact=p.emergency_contact===null?copy.missing:emergency.success?Object.values(emergency.data).filter((value):value is string=>typeof value==='string'&&!!value.trim()).join(' · ')||copy.missing:JSON.stringify(p.emergency_contact);
 const fields=requestedProfileFields(question);if(!fields)return profileCopy.askField;
 const values=fields.map(key=>{
  if(key==='emergency_contact')return copy.profile[key]+' : '+contact;
  if(key==='is_active')return copy.profile[key]+' : '+(p.is_active?labels['active']:labels['inactive']);
  if(key==='age'){
   const birth=p.birth_date instanceof Date?p.birth_date.toISOString().slice(0,10):p.birth_date?.slice(0,10);
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Algiers',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(z.iso.datetime({offset:true}).parse(asOf)));
   const years=birth?Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0):null;
   return profileCopy.ageLabel+' : '+(!birth?copy.missing:birth>today||!Number.isFinite(years)?profileCopy.invalidBirth:profileCopy.age(years!));
  }
  return copy.profile[key]+' : '+display(p[key]);
 });
 return profileCopy.one(p.first_name+' '+p.last_name,values.map(value=>value.replace(/\s+/gu,' ').trim()));
}
