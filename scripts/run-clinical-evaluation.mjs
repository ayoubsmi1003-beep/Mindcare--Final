// Real shared services + real local model, bound to the isolated evaluation DB.
import {loadEnvFile} from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),privateRoot=path.join(root,'.cache/clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(privateRoot,'isolation.json'),'utf8'));
if(isolation.database!=='alexa_eval_clinical_20261022'||isolation.port!==55444||!isolation.restorationVerified)throw Error('VerifiedEvaluationRequired');
loadEnvFile(path.join(root,'.env'));
const url=new URL(process.env.MINDCARE_DATABASE_URL);url.hostname='127.0.0.1';url.port='55444';url.pathname='/'+isolation.database;process.env.MINDCARE_DATABASE_URL=url.href;
process.env.MINDCARE_DATABASE_CONNECT_TIMEOUT_MS='30000';
const require=createRequire(import.meta.url),vite=createRequire(require.resolve('vitest/package.json')),{build}=createRequire(vite.resolve('vite/package.json'))('esbuild');
const entry=path.join(privateRoot,'clinical-services.mjs');
await build({stdin:{contents:"export {fermerPool} from '@/server/db/pool';export {ALEXA_CONVERSATION_MODEL} from '@/server/alexa/model-policy';export {generateSessionSummary} from '@/server/alexa/session-summary';export {alexaDb} from '@/server/alexa/db';export {releaseLocalModel} from '@/server/alexa/local-model';export {buildLocalRequest} from '@/server/alexa/local-model-protocol';export {buildClinicalContext} from '@/server/alexa/clinical-context';export {sessionAnswerSchemaFor,summarizeClinicalContext,NARRATIVE_HASH} from '@/server/alexa/clinical-narrative';",resolveDir:root,loader:'ts'},outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:path.join(root,'tsconfig.json'),banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
const api=await import(pathToFileURL(entry).href),plan=JSON.parse(readFileSync(path.join(privateRoot,'cohort-plan.json'),'utf8'));
const pilot=plan.patients.find(p=>p.count<100),visits=plan.visits.filter(v=>v.patient.id===pilot.id).sort((a,b)=>b.at.localeCompare(a.at));
const limitIndex=process.argv.indexOf('--limit'),limit=limitIndex<0?1:Number(process.argv[limitIndex+1]);
if(!Number.isInteger(limit)||limit<1)throw Error('InvalidLimit');
const all=process.argv.includes('--all');
const viaApp=process.argv.includes('--via-app');
let selected=visits;
if(all){
 const output=execFileSync('docker',['exec','-i',isolation.target,'psql','-X','-U','postgres','-d',isolation.database,'-At','-v','ON_ERROR_STOP=1'],{input:"BEGIN READ ONLY; SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'patient',jsonb_build_object('id',c.patient_id,'practitioner_id',c.practitioner_id)) ORDER BY c.patient_id,c.started_at,c.id),'[]') FROM app.consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id WHERE n.structured->'evaluation'->>'campaign'='clinical-20261022'; COMMIT;",encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 selected=JSON.parse(output.split('\n').find(line=>line.startsWith('[')));
 if(selected.length!==8142||selected.some(v=>!v.id||!v.patient?.practitioner_id))throw Error('EvaluationCohortMismatch');
}
const patientIndex=process.argv.indexOf('--patient');
if(patientIndex>=0){
 const patientId=process.argv[patientIndex+1];
 if(!all||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(patientId??''))throw Error('EvaluationPatientRequired');
 selected=selected.filter(visit=>visit.patient.id===patientId);
 if(!selected.length)throw Error('EvaluationPatientOutsideCohort');
}
const reports=[];
const reportFile=path.join(privateRoot,all?'historical-analysis-backfill.json':'shared-service-live.json');
const save=()=>writeFileSync(reportFile,JSON.stringify({bundleSha256:createHash('sha256').update(readFileSync(entry)).digest('hex'),selected:selected.length,limit,reports},null,2));
let appRequest,appActor;
if(viaApp){
 const metadata=JSON.parse(readFileSync(path.join(privateRoot,'app-process.json'),'utf8'));
 if(metadata.database!==isolation.database||metadata.port!==3006)throw Error('IsolatedApplicationRequired');
 const {request}=await import('playwright');
 appRequest=await request.newContext({baseURL:'http://127.0.0.1:3006',storageState:path.join(privateRoot,'browser-state.json'),extraHTTPHeaders:{Origin:'http://127.0.0.1:3006'},timeout:950000});
 const session=await appRequest.get('/api/auth/session'),body=await session.json();
 if(!session.ok()||!body.ok||!body.data?.userId){await appRequest.dispose();throw Error('AuthenticatedEvaluationSessionRequired');}
 appActor=body.data.userId;
}
if(process.argv.includes('--preflight'))console.log(JSON.stringify({preflight:'PASS',selected:selected.length,model:api.ALEXA_CONVERSATION_MODEL}));
try{
 for(const visit of selected.slice(0,process.argv.includes('--preflight')?0:limit)){
  const started=Date.now();
  try{
   if(all){
    const stored=await api.alexaDb(visit.patient.practitioner_id).rpc('get_consultation_analysis',{p_consultation_id:visit.id});
    const row=stored.ok?stored.data[0]:null;
    if(row?.model===api.ALEXA_CONVERSATION_MODEL&&row.prompt_hash===api.NARRATIVE_HASH&&row.content?.complete===true&&row.content?.generated===true&&['reformulated','extractive'].includes(row.content?.method)){
     reports.push({consultationId:visit.id,status:'CURRENT',ms:Date.now()-started});continue;
    }
   }
   let value;
   if(appRequest){
    if(appActor!==visit.patient.practitioner_id)throw Error('EvaluationActorMismatch');
    const response=await appRequest.post('/api/jarvis/jarvis-analyze-session',{data:{consultationId:visit.id}}),body=await response.json();
    if(!response.ok()||!body.ok)throw Error('ApplicationAnalysisUnavailable');
    value=body.data;
    const persisted=await api.alexaDb(appActor).rpc('get_consultation_analysis',{p_consultation_id:visit.id});
    if(!persisted.ok||persisted.data[0]?.prompt_hash!==api.NARRATIVE_HASH)throw Error('ApplicationNarrativePolicyMismatch');
   }else value=await api.generateSessionSummary(api.alexaDb(visit.patient.practitioner_id),visit.id,AbortSignal.timeout(900000));
   reports.push({consultationId:visit.id,patientId:visit.patient.id,status:value.persistee&&value.complete&&['reformulated','extractive'].includes(value.method)?'PASS':'PARTIAL',ms:Date.now()-started,value});
  }catch(e){reports.push({consultationId:visit.id,status:'FAIL',ms:Date.now()-started,error:e.code??e.name});}
  save();
  console.log(JSON.stringify({case:reports.length,status:reports.at(-1).status,ms:reports.at(-1).ms}));
  // Stop a bulk run at the first unqualified paragraph; never populate a cohort with rejected prose.
  if(all&&reports.at(-1).status!=='PASS')break;
 }
}finally{if(!process.argv.includes('--preflight'))save();await appRequest?.dispose();await api.releaseLocalModel();await api.fermerPool();}
process.exitCode=reports.some(r=>!['PASS','CURRENT'].includes(r.status))?1:0;
