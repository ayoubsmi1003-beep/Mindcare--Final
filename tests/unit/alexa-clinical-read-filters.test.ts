import {expect,it,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {agentSchemas} from '@/shared/alexa/agent';
import {frenchRequestAdmission,frenchReadArgumentBindings} from '@/shared/alexa/request-contract';
const patientId='22222222-2222-4222-8222-222222222222';
const id=(n:number)=>'33333333-3333-4333-8333-'+String(n).padStart(12,'0');
it.each(['Quel numéro de CNI est enregistré pour Yacine Amrani ?','Quel numéro de CIN est enregistré pour Yacine Amrani ?'])('routes an identity-card abbreviation to the named patient profile: %s',text=>{
 expect(frenchRequestAdmission(text,false)).toMatchObject({tools:['get_patient_context'],patientSection:'profile',profileOnly:true});
});
function payload(){return {patientId,consultations:[],treatments:{current:['active','paused','stopped'].map((status,i)=>({id:id(10+i),medication:'FICTIF '+status,status,dose:null,doseUnit:null,frequency:null,timing:[],instructions:'Consigne fictive '+status,startDate:'2026-01-01',endDate:status==='stopped'?'2026-02-01':null,version:1})),history:[],historyComplete:true},diagnoses:[{id:id(1),label:'FICTIF primaire actif',code:null,primary:true,onsetDate:null,resolvedAt:null},{id:id(2),label:'FICTIF secondaire actif',code:null,primary:false,onsetDate:null,resolvedAt:null},{id:id(3),label:'FICTIF résolu',code:null,primary:false,onsetDate:null,resolvedAt:'2026-02-01'}],scales:[],sourceRevision:'a'.repeat(64),coverage:{requested:5,returned:0,complete:true,hasMore:false}};}
async function execute(args:Record<string,unknown>){const value=payload(),rpc=vi.fn().mockImplementation(async(name:string)=>({ok:true,data:name==='get_patient'?[{id:patientId}]:[value]}));const run=agentExecutor({text:'Lis le dossier courant.',conversationId:'filters',clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{rpc},{rpc:vi.fn()});return {result:await run({id:'read',name:'get_patient_context',args:{partIds:['read'],...args}},'2026-10-15T12:00:00Z',[],new AbortController().signal),rpc,value};}
it.each([
 ['Lis les diagnostics actifs du dossier courant.',{section:'diagnoses',diagnosisState:'active'}],
 ['Montre les diagnostics résolus du dossier courant.',{section:'diagnoses',diagnosisState:'resolved'}],
 ['Montre le diagnostic principal du dossier courant.',{section:'diagnoses',diagnosisRole:'primary'}],
 ['Montre les traitements arrêtés du dossier courant.',{section:'treatments',treatmentState:'stopped'}],
 ['Lis les traitements en pause du dossier courant.',{section:'treatments',treatmentState:'paused'}],
 ['Montre les traitements actifs du dossier courant.',{section:'treatments',treatmentState:'active'}],
])('preserves the explicit clinical filter: %s',(text,expected)=>expect(frenchReadArgumentBindings(frenchRequestAdmission(text,false),'get_patient_context')).toMatchObject(expected));
it('binds a quoted consultation reference as a note-content search filter',()=>{
 const text='Cherche la référence « REPERE-001-S06 » dans les notes de Amel Bensaid.';
 const scope=frenchRequestAdmission(text,false);
 expect(scope).toMatchObject({tools:['get_patient_context'],patientSection:'notes',noteQuery:'REPERE-001-S06'});
 expect(frenchReadArgumentBindings(scope,'get_patient_context')).toMatchObject({section:'notes',area:'all',query:'REPERE-001-S06'});
});
it.each(['terminées','clôturées','achevées','fermées','closes'])('retains a requested %s consultation restriction when searching notes',status=>{
 const text=`Cherche le mot « sommeil » dans les notes des consultations ${status} de Ayoub Salmi.`;
 expect(frenchReadArgumentBindings(frenchRequestAdmission(text,false),'get_patient_context')).toMatchObject({section:'notes',area:'all',query:'sommeil',status:'closed'});
});
it('does not interpret a quoted search term as a requested consultation status',()=>{
 const text='Cherche le mot « terminées » dans les notes de Ayoub Salmi.';
 expect(frenchReadArgumentBindings(frenchRequestAdmission(text,false),'get_patient_context')).not.toHaveProperty('status');
});
it('returns only active primary diagnoses with matching sources, preserving the original authorized context',async()=>{const {result,value,rpc}=await execute({section:'diagnoses',diagnosisState:'active',diagnosisRole:'primary'});expect(result.status).toBe('ok');expect(result.data).toMatchObject({diagnoses:[value.diagnoses[0]]});expect(result.evidence.filter(s=>s.type==='diagnostic').map(s=>s.id)).toEqual([id(1)]);expect(result.text).not.toContain('secondaire');expect(result.text).not.toContain('FICTIF résolu');expect(value.diagnoses).toHaveLength(3);expect(rpc.mock.calls.every(c=>['get_patient','get_alexa_clinical_context'].includes(c[0]))).toBe(true);});
it('returns resolved diagnoses and an honest empty result for a primary-resolved intersection',async()=>{const resolved=await execute({section:'diagnoses',diagnosisState:'resolved'});expect(resolved.result.data).toMatchObject({diagnoses:[resolved.value.diagnoses[2]]});const empty=await execute({section:'diagnoses',diagnosisState:'resolved',diagnosisRole:'primary'});expect(empty.result.data).toMatchObject({diagnoses:[]});expect(empty.result.text).not.toContain('primaire actif');});
it.each(['active','paused','stopped'])('preserves %s treatment state, exact instructions and dates',async status=>{const {result,value}=await execute({section:'treatments',treatmentState:status});expect(result.data).toMatchObject({treatments:{current:value.treatments.current.filter(t=>t.status===status)}});expect(result.evidence.filter(s=>s.type==='treatment')).toHaveLength(1);expect(result.text).toContain('Consigne fictive '+status);expect(result.text).toContain('2026-01-01');if(status==='stopped')expect(result.text).toContain('2026-02-01');});
it('rejects a state filter on an unrelated clinical section rather than silently ignoring it',()=>{for(const args of [{section:'scales',diagnosisState:'active'},{section:'diagnoses',treatmentState:'stopped'},{section:'history',diagnosisRole:'primary'}])expect(agentSchemas.get_patient_context.safeParse({partIds:['x'],...args}).success).toBe(false);});
