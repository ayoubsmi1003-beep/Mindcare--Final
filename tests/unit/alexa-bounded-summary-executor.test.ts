import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';
import {ok} from '@/services/result';

const patientId='b5000000-0000-4000-8000-000000000001';
const row=(id:string,startedAt:string,subjective:string,endedAt:string|null=new Date(Date.parse(startedAt)+3600000).toISOString())=>({id,startedAt,endedAt,rawNotes:null,notes:[{id:'b6000000-0000-4000-8000-000000000001',version:'1',status:'signed',subjective,objective:null,assessment:null,plan:null,amendments:[]}]});
it('executes a bounded French consultation summary through authorized reads and excludes out-of-period chart context',async()=>{
 const visits=[
  row('b7000000-0000-4000-8000-000000000004','2026-10-01T00:00:00+01:00','Thème récurrent : « insomnie ».'),
  row('b7000000-0000-4000-8000-000000000003','2026-09-15T10:00:00+01:00','Thème récurrent : « sommeil fragmenté ».'),
  row('b7000000-0000-4000-8000-000000000002','2026-04-01T00:00:00+01:00','Thème récurrent : « sommeil fragmenté ».'),
  row('b7000000-0000-4000-8000-000000000001','2026-03-31T23:59:59+01:00','Thème récurrent : « anxiété ».'),
 ];
 const patient={id:patientId,record_number:'TEST-001',first_name:'Amel',last_name:'Bensaid',birth_date:null,phone:null,phone_alt:null,id_document_number:null,id_document_issuer:null,sex:'F',marital_status:null,address:null,emergency_contact:null,notes_admin:null,is_active:true,total_count:1};
 const clinical={patientId,consultations:visits,currentConsultation:row('b7000000-0000-4000-8000-000000000005','2026-10-20T10:00:00+01:00','CURRENT_ONLY_SECRET.',null),diagnoses:[{id:'b8000000-0000-4000-8000-000000000001',label:'DIAGNOSIS_OUTSIDE_PERIOD',code:null,primary:true,onsetDate:null,resolvedAt:null}],scales:[],treatments:{current:[{id:'b9000000-0000-4000-8000-000000000001',medication:'TREATMENT_OUTSIDE_PERIOD',status:'active',dose:'99',doseUnit:'mg',frequency:null,timing:[],instructions:null,startDate:'2026-10-01',endDate:null,version:1}],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:20,returned:4,complete:true,hasMore:false}};
 const rpc=scriptedAlexaRpc(async(name)=>ok(name==='search_patients'?[{id:patientId,total_count:1,first_name:'Amel',last_name:'Bensaid'}]:name==='get_patient'?[patient]:name==='get_alexa_clinical_context'?[clinical]:[]));
 const text='Quel est le thème récurrent des notes de Amel Bensaid d’avril à septembre 2026 ?';
 const result=await agentExecutor({text,conversationId:'bounded-summary',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()})({id:'summary',name:'get_patient_context',args:{partIds:['summary'],section:'summary',from:'2026-04-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}},'2026-10-20T12:00:00+01:00',[],new AbortController().signal);
 expect(rpc.mock.calls.filter(([name])=>name==='get_alexa_clinical_context').map(([,args])=>args)).toEqual([{p_patient_id:patientId,p_limit:20,p_before_at:null,p_before_id:null}]);
 expect(result).toMatchObject({status:'ok',complete:true,patientId});expect(result.text).toContain('sommeil fragmenté');expect(result.text).not.toContain('insomnie');expect(result.text).not.toContain('anxiété');
 const summary=(result.data as {summary:{consultations:{id:string}[];currentConsultation:unknown;diagnoses:unknown[];treatments:{current:unknown[]}}}).summary;
 expect(summary.consultations.map(visit=>visit.id)).toEqual([visits[1]!.id,visits[2]!.id]);expect(summary.currentConsultation).toBeNull();expect(summary.diagnoses).toEqual([]);expect(summary.treatments.current).toEqual([]);
 const exactCountText='Résume en un seul paragraphe l’évolution racontée dans les six consultations d’avril à septembre 2026 de Amel Bensaid.';
 const mismatch=await agentExecutor({text:exactCountText,conversationId:'bounded-summary-count-mismatch',clientTurnId:'11111111-1111-4111-8111-111111111112',appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()})({id:'summary-count',name:'get_patient_context',args:{partIds:['summary-count'],section:'summary',count:6,from:'2026-04-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'}},'2026-10-20T12:00:00+01:00',[],new AbortController().signal);
 expect(mismatch).toMatchObject({status:'partial',complete:false,error:{code:'requested-period-count-mismatch'}});expect(mismatch.text).toContain('2 consultations');expect(mismatch.text).toContain('6');expect(mismatch.text).not.toContain('sommeil fragmenté');
});
