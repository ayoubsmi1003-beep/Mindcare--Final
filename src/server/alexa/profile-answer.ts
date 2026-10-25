import {z} from 'zod';
import {alexaRecordCopy} from '@/i18n/alexa-records';
import {profileCopy} from '@/i18n/alexa-profile';
const text=z.string().nullable();
export const patientProfileSchema=z.object({id:z.uuid(),record_number:z.string(),first_name:z.string(),last_name:z.string(),birth_date:z.union([z.string(),z.date()]).nullable(),phone:text,phone_alt:text,id_document_number:text,id_document_issuer:text,sex:text,marital_status:text,address:text,emergency_contact:z.json(),notes_admin:text,is_active:z.boolean()});
type Field=keyof typeof alexaRecordCopy.fr.profile|'age'|'name';
function requestedProfileFields(question:string):Field[]|null{
 const copy=alexaRecordCopy.fr,requested=new Set<Field>(),plain=question.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 const emergencyRequested=/\burgence|personne a (?:contacter|prevenir)\b/u.test(plain);
 if(/\b(?:nom|prenom|nom complet|identite complete)\b/u.test(plain)&&/\b(?:patient\s+(?:selectionne\w*|courant)|(?:ce|cette)\s+patient(?:e)?|dossier\s+(?:ouvert|courant|actif)|son dossier)\b/u.test(plain))requested.add('name');
 if(emergencyRequested)requested.add('emergency_contact');
 if(/\b(?:telephones?|tel|mobiles?|portables?)\b/u.test(plain)&&(!emergencyRequested||/\bet\b/u.test(plain))){
  if(/\bsecondaire|autre numero|deuxieme numero\b/u.test(plain))requested.add('phone_alt');
  if(/\btelephones\b/u.test(plain)&&! /\bsecondaires?\b/u.test(plain))requested.add('phone_alt');
  if(!requested.has('phone_alt')||/\btelephones\b/u.test(plain)&&! /\bsecondaires?\b/u.test(plain)||/\bprincipal\b/u.test(plain))requested.add('phone');
 }
 if(/\bcoordonnees?\b/u.test(plain))for(const key of ['phone','phone_alt','address'] as const)requested.add(key);
 if(/\b(?:identite|identification nationale|cni|cin|carte d.identite|carte nationale|piece d.identite|numero national)\b/u.test(plain))requested.add('id_document_number');
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
 const valueFor=(key:Field):string=>{
  if(key==='name')return [p.first_name,p.last_name].map(value=>value.trim()).filter(Boolean).join(' ')||copy.missing;
  if(key==='emergency_contact')return contact;
  if(key==='is_active')return labels[p.is_active?'active':'inactive']!;
  if(key==='age'){
   const birth=p.birth_date instanceof Date?p.birth_date.toISOString().slice(0,10):p.birth_date?.slice(0,10);
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Algiers',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(z.iso.datetime({offset:true}).parse(asOf)));
   const years=birth?Number(today.slice(0,4))-Number(birth.slice(0,4))-(today.slice(5)<birth.slice(5)?1:0):null;
   return !birth?copy.missing:birth>today||!Number.isFinite(years)?profileCopy.invalidBirth:profileCopy.age(years!);
  }
  return display(p[key]);
 };
 const name=p.first_name+' '+p.last_name;
 const labelFor=(field:Field)=>field==='age'?profileCopy.ageLabel:field==='name'?profileCopy.nameLabel:copy.profile[field];
 if(fields.length===1){const field=fields[0]!;return field==='name'?profileCopy.name(valueFor(field),copy.missing):profileCopy.singleField(name,field,labelFor(field),valueFor(field),copy.missing);}
 const values=fields.map(key=>`${labelFor(key)} : ${valueFor(key)}`);
 return profileCopy.one(name,values.map(value=>value.replace(/\s+/gu,' ').trim()));
}
