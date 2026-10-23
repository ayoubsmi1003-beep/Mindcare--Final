import {z} from 'zod';
import type {AgentResult} from '@/shared/alexa/agent';
import {AgentReadError} from '@/shared/alexa/agent';
import type {AlexaSource} from '@/shared/alexa/turn';

import {noteCursorSchema,noteReadQuerySchema} from "@/shared/alexa/note-query";
import {sessionDetailsSchema} from '@/shared/alexa/session-details';
import {narrativeCopy} from '@/i18n/alexa-narrative';
const areaLabels={working:'Notes de travail',subjective:'Subjectif',objective:'Objectif',assessment:'Évaluation',plan:'Conduite à tenir',amendment:'Amendement',structured:'Données structurées'} as const;
const pageSchema=z.object({patientId:z.uuid(),total:z.number().int().nonnegative().safe(),revision:z.string().regex(/^[a-f0-9]{32}$/),complete:z.boolean(),next:noteCursorSchema.optional(),rows:z.array(z.object({consultationId:z.uuid(),startedAt:z.iso.datetime({offset:true}),consultationStatus:z.enum(['open','closed']),sourceId:z.uuid(),area:z.enum(['working','subjective','objective','assessment','plan','amendment','structured']),status:z.enum(['working','draft','signed','amendment','missing']),version:z.string().max(100),signedAt:z.iso.datetime({offset:true}).nullable(),aiDraft:z.boolean(),reason:z.string().nullable(),text:z.string().max(2400),textLength:z.number().int().nonnegative(),textOffset:z.number().int().nonnegative()}).strict()).max(5)}).strict();
/** Untrusted source text is quoted and attributed. It grants no tool or write authority. */
export function notePageResult(raw:unknown,callId:string,spec:z.infer<typeof noteReadQuerySchema>,asOf:string,requestText=''):AgentResult{
 const page=pageSchema.parse(raw);
 if(page.patientId!==spec.patientId||page.rows.length>page.total||page.complete===!!page.next||(!page.rows.length&&page.total>0))throw new AgentReadError('malformed');
 const evidence:AlexaSource[]=[{id:callId,type:'query',label:'Lecture des notes',version:page.revision,provenance:{gate:'query_alexa_note_sections',asOf,total:page.total}}];
 const lines=page.rows.map(row=>{
  if(spec.consultationId&&row.consultationId!==spec.consultationId)throw new AgentReadError('malformed');
  // SQL offsets count Unicode characters; Javascript code units cannot validate that length.
  if(row.textOffset>row.textLength)throw new AgentReadError('malformed');
  const date=new Date(row.startedAt).toLocaleDateString('fr-DZ',{timeZone:'Africa/Algiers'});
  evidence.push({id:row.consultationId,type:'consultation',label:date+' — '+areaLabels[row.area],version:row.version,provenance:{sourceId:row.sourceId,area:row.area,textOffset:row.textOffset,textLength:row.textLength,status:row.status,aiDraft:row.aiDraft?1:0,signedAt:row.signedAt}});
  const status=row.status==='signed'?'signée':row.status==='draft'?'brouillon non signé':row.status==='working'?'travail non signé':row.status==='missing'?'non renseigné':'correction ajoutée';
  let text=row.text;
  const requested=requestText.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase(),focus=/\bfocus\b/u.test(requested),measures=/\bmesures?\b/u.test(requested);
  if(row.area==='structured'&&(focus||measures)&&row.textOffset===0&&[...text].length===row.textLength){
   try{
    const parsed=z.object({sessionDetails:sessionDetailsSchema}).passthrough().safeParse(JSON.parse(text));
    if(parsed.success){
     const details=parsed.data.sessionDetails,labels=[...details.focus,details.focusLibre].filter(Boolean),scores=(Object.entries(details.mesures) as [keyof typeof details.mesures,number|null][]).flatMap(([key,value])=>value===null?[]:[`${narrativeCopy.measureLabels[key]} ${value}/10`]);
     text=[...(focus?[labels.length?narrativeCopy.focusSource(labels):narrativeCopy.focusMissing]:[]),...(measures?[scores.length?narrativeCopy.measuresSource(scores):narrativeCopy.measuresMissing]:[])].join(' ');
    }
   }catch{/* A partial or unknown structured value remains an attributed source excerpt. */}
  }
  return `${date} — ${areaLabels[row.area]} (${status}${row.aiDraft?' ; brouillon IA':''})${row.reason?'\nMotif : '+row.reason:''}\n${text?'« '+text+' »':'Non renseigné.'}`;
 });
 return {callId,status:page.complete?(page.total?'ok':'empty'):'partial',complete:page.complete,patientId:spec.patientId,conditionKeys:[],evidence,
  text:(lines.join('\n\n')||'Aucune note correspondante dans le périmètre demandé.')+(!page.complete?'\nLecture partielle : une suite reste à lire.':''),
  data:{...page,noteQuery:spec,asOf}};
}
