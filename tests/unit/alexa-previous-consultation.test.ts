import { expect, it, vi } from 'vitest';

const clinical=vi.hoisted(()=>({buildClinicalContext:vi.fn()}));
const narrative=vi.hoisted(()=>({
 extractRecurringClinicalTheme:vi.fn(()=>null),
 summarizeClinicalConsultations:vi.fn(),
 summarizeClinicalContext:vi.fn(),
 summarizeClinicalCaseContext:vi.fn(),
 relativeClinicalDate:vi.fn(()=>''),
 requestsClinicalDate:vi.fn(()=>false),
}));
vi.mock('@/server/alexa/clinical-context',()=>clinical);
vi.mock('@/server/alexa/clinical-narrative',()=>narrative);

import { agentExecutor } from '@/server/alexa/agent-tools';
import type { ClinicalContext } from '@/shared/alexa/clinical';
import type { DbPort } from '@/services/db/port';

it('reads exactly the second-most-recent consultation when the earlier visit is requested',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',latestId='33333333-3333-4333-8333-333333333333',previousId='44444444-4444-4444-8444-444444444444';
 const latest={id:latestId,startedAt:'2026-10-20T10:00:00+01:00',endedAt:'2026-10-20T11:00:00+01:00',notes:[]},previous={id:previousId,startedAt:'2026-10-10T10:00:00+01:00',endedAt:'2026-10-10T11:00:00+01:00',notes:[]};
  const context:ClinicalContext={patientId,consultations:[latest,previous],treatments:{current:[],history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:'a'.repeat(64),coverage:{requested:2,returned:2,complete:false,hasMore:true}};
 clinical.buildClinicalContext.mockResolvedValue(context);
 narrative.summarizeClinicalCaseContext.mockImplementation(async(value:ClinicalContext)=>({text:`Résumé de ${value.consultations[0]?.id??value.currentConsultation?.id}.`,complete:true,generated:true,method:'extractive',sourceIds:[previousId]}));
  const rpc:Pick<DbPort,'rpc'>['rpc']=async <T>(name:string)=>{
   if(name!=='get_patient')return {ok:false as const,error:{code:'inattendu' as const,message:'Unexpected'}};
   const rows:unknown=[{id:patientId,first_name:'Lina',last_name:'Test'}];
   return {ok:true as const,data:rows as readonly T[]};
  };
 const input={text:'Résume l’avant-dernière consultation du patient sélectionné.',conversationId:'earlier-consultation',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:`/patients/${patientId}`}};
 const execute=agentExecutor(input,{rpc},{rpc:vi.fn()});
 const result=await execute({id:'previous',name:'get_patient_context',args:{partIds:['previous'],section:'summary'}},'2026-10-27T09:00:00+01:00',[],new AbortController().signal);
 expect(clinical.buildClinicalContext).toHaveBeenCalledWith(expect.anything(),{patientId},{count:2,all:false},expect.anything());
 expect(result.status).toBe('ok');expect(result.complete).toBe(true);expect(result.data).toMatchObject({summary:{consultations:[previous],diagnoses:[],scales:[],coverage:{requested:1,returned:1,complete:true,hasMore:false}}});
 expect(narrative.summarizeClinicalCaseContext).toHaveBeenCalledWith(expect.objectContaining({consultations:[previous]}),expect.anything());
});

it('accepts the one-visit scope for a recognized current-consultation summary',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',consultationId='33333333-3333-4333-8333-333333333333';
 const visit={id:consultationId,startedAt:'2026-10-20T10:00:00+01:00',endedAt:'2026-10-20T11:00:00+01:00',notes:[]};
 const context:ClinicalContext={patientId,consultations:[visit],treatments:{current:[],history:[],historyComplete:true},diagnoses:[],scales:[],sourceRevision:'b'.repeat(64),coverage:{requested:1,returned:1,complete:true,hasMore:false}};
 clinical.buildClinicalContext.mockResolvedValue(context);
 narrative.summarizeClinicalContext.mockResolvedValue({text:'Les notes décrivent une baisse de l’élan et un retrait des activités habituelles.',complete:true,generated:true,method:'extractive',sourceIds:[consultationId]});
 const rpc:Pick<DbPort,'rpc'>['rpc']=async <T>(name:string)=>{
  if(name!=='get_patient')return {ok:false as const,error:{code:'inattendu' as const,message:'Unexpected'}};
  const rows:unknown=[{id:patientId,first_name:'Islam',last_name:'Adjina'}];
  return {ok:true as const,data:rows as readonly T[]};
 };
 const input={text:'Quels problèmes principaux sont documentés dans la consultation actuelle du patient sélectionné ?',conversationId:'current-consultation-summary',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:`/patients/${patientId}`}};
 const execute=agentExecutor(input,{rpc},{rpc:vi.fn()});
 const result=await execute({id:'current-summary',name:'get_patient_context',args:{partIds:['current-summary'],section:'summary',count:1,patientId}},'2026-10-27T09:00:00+01:00',[],new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.complete).toBe(true);expect(result.patientId).toBe(patientId);
 expect(clinical.buildClinicalContext).toHaveBeenCalledWith(expect.anything(),{patientId},{count:1,all:false},expect.anything());
 expect(narrative.summarizeClinicalContext).toHaveBeenCalledWith(expect.objectContaining({consultations:[visit]}),expect.anything(),false,true,{includeDates:false,focus:'concerns'});
 expect(result.text).toContain('baisse de l’élan');
});
