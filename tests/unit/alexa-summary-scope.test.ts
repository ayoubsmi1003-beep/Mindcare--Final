import {expect,it,vi} from 'vitest';
import {frenchReadArgumentBindings,frenchRequestAdmission} from '@/shared/alexa/request-contract';
import {alexaNavigationPath} from '@/shared/alexa/turn';
import {agentSchemas} from '@/shared/alexa/agent';
vi.mock('@/server/alexa/local-model',()=>({inferLocalText:vi.fn()}));
import {inferLocalText} from '@/server/alexa/local-model';
import {summarizeClinicalContext,clinicalNarrativeReferences} from '@/server/alexa/clinical-narrative';
import type {ClinicalContext} from '@/shared/alexa/clinical';

it.each([['Résume les trois dernières consultations de Ayoub Salmi.',3],['Résume ses 2 dernières séances.',2],['Synthèse des vingt dernières consultations du patient sélectionné.',20],['Résume la dernière consultation.',1]])('binds the requested clinical subset: %s',(text,count)=>{
 const admission=frenchRequestAdmission(text,false);
 expect(frenchReadArgumentBindings(admission,'get_patient_context')).toMatchObject({section:'summary',count});
});
it('does not reinterpret first consultations as latest consultations',()=>{
 expect(frenchReadArgumentBindings(frenchRequestAdmission('Résume les trois premières consultations de Ayoub Salmi.',false),'get_patient_context')).not.toHaveProperty('count');
});
it('does not invent a subset for a whole-case summary',()=>{
 expect(frenchReadArgumentBindings(frenchRequestAdmission('Résume le cas du patient sélectionné.',false),'get_patient_context')).not.toHaveProperty('count');
});
it('cites only the consultation fields actually used in the paragraph',()=>{
 const c={id:'a4000000-0000-4000-8000-000000000001',startedAt:'2026-10-01T08:00:00Z',endedAt:'2026-10-01T09:00:00Z',rawNotes:'Le sommeil reste perturbé.',notes:[]};
 const context:ClinicalContext={patientId:'a3000000-0000-4000-8000-000000000001',consultations:[c,{...c,id:'a4000000-0000-4000-8000-000000000002'}],diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:2,returned:2,complete:true,hasMore:false}};
 expect(clinicalNarrativeReferences(context,[c.id+':0',c.id+':0'])).toEqual([{t:'consultation',id:c.id}]);
 expect(()=>clinicalNarrativeReferences(context,['foreign'])).toThrow();
});
it('links a cited treatment-history event to its actual treatment record',()=>{
 const event='a6000000-0000-4000-8000-000000000001',treatment='a7000000-0000-4000-8000-000000000001';
 const context:ClinicalContext={patientId:'a3000000-0000-4000-8000-000000000001',consultations:[],diagnoses:[],scales:[],treatments:{current:[],history:[{id:event,treatmentId:treatment,version:2,action:'update',occurredAt:'2026-10-01T08:00:00Z',previous:null,next:null,reason:null,notes:null}],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:0,complete:true,hasMore:false}};
 expect(clinicalNarrativeReferences(context,[event])).toEqual([{t:'treatment',id:treatment}]);
});
it('reports an unread history page when summarizing the whole case',async()=>{
 const context:ClinicalContext={patientId:'a3000000-0000-4000-8000-000000000001',consultations:[{id:'a4000000-0000-4000-8000-000000000001',startedAt:'2026-10-01T08:00:00Z',endedAt:'2026-10-01T09:00:00Z',rawNotes:'Le sommeil reste perturbé.',notes:[]}],diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:1,returned:1,complete:true,hasMore:true,next:{id:'a4000000-0000-4000-8000-000000000001',startedAt:'2026-10-01T08:00:00Z'}}};
 vi.mocked(inferLocalText).mockImplementation(async messages=>{const s=JSON.parse(String(messages[1]!.content)).sources[0];return JSON.stringify({sentences:[{text:s.text,evidence:[{id:s.id,quote:s.text}]}]});});
 expect((await summarizeClinicalContext(context,new AbortController().signal)).complete).toBe(false);
 expect((await summarizeClinicalContext(context,new AbortController().signal,false)).complete).toBe(true);
});
it('includes the current consultation inside the requested last-N visits rather than adding it as an extra visit',async()=>{
 const visit=(suffix:string,startedAt:string,rawNotes:string)=>({id:'a4000000-0000-4000-8000-'+suffix.padStart(12,'0'),startedAt,endedAt:startedAt,rawNotes,notes:[]});
 const current={...visit('3','2026-10-15T08:00:00Z','Observation actuelle consignée.'),endedAt:null};
 const last=visit('2','2026-10-01T08:00:00Z','Observation récente consignée.');
 const old=visit('1','2026-09-01T08:00:00Z','Ancienne observation hors sélection.');
 const context:ClinicalContext={patientId:'a3000000-0000-4000-8000-000000000001',currentConsultation:current,consultations:[last,old],diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:2,returned:2,complete:true,hasMore:false}};
 vi.mocked(inferLocalText).mockImplementation(async messages=>{
  const body=JSON.parse(String(messages[1]!.content));
  expect(body.sources.map((s:{id:string})=>s.id)).toEqual(['s1','s2']);
  expect(JSON.stringify(body)).not.toContain(old.rawNotes);
  return JSON.stringify({sentences:[{text:'Observation actuelle consignée. Observation récente consignée.',evidence:body.sources.map((s:{id:string},i:number)=>({id:s.id,quote:i===0?current.rawNotes:last.rawNotes}))}]});
 });
 const r=await summarizeClinicalContext(context,new AbortController().signal,false);
 expect(r.generated).toBe(true);expect(r.text).not.toContain(old.rawNotes);
});
it.each(['documents','finances','parametres','jarvis'])('supports navigation to the delivered %s page',target=>{
 expect(agentSchemas.navigate.safeParse({partIds:['n'],target}).success).toBe(true);
 expect(alexaNavigationPath({target})).toBe('/'+target);
});
it.each([['Ouvre les documents.','documents'],['Va aux finances.','finances'],['Ouvre les paramètres du cabinet.','parametres'],['Ouvre Alexa.','jarvis']])('distinguishes opening a page from reading its records: %s',(text,target)=>{
 const a=frenchRequestAdmission(text,false);expect(a.tools).toEqual(['navigate']);expect(frenchReadArgumentBindings(a,'navigate')).toMatchObject({target});
});
it('does not replace a patient-specific document request with global navigation',()=>{
 expect(frenchRequestAdmission('Ouvre les documents du patient Ayoub Salmi.',false).tools).not.toEqual(['navigate']);
});
it.each(['agents','statistiques','journal','https://example.invalid','../secret'])('rejects unbuilt or arbitrary navigation %s',target=>{
 expect(agentSchemas.navigate.safeParse({partIds:['n'],target}).success).toBe(false);
 expect(alexaNavigationPath({target})).toBeNull();
});
