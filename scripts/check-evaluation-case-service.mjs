// Real shared case-summary service, isolated synthetic data, no prepared answer.
import {loadEnvFile} from 'node:process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root=process.cwd(),privateRoot=path.join(root,'.cache','clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(privateRoot,'isolation.json'),'utf8'));
if(!isolation.restorationVerified||isolation.database!=='alexa_eval_clinical_20261022'||isolation.port!==55444)throw Error('VerifiedEvaluationRequired');
loadEnvFile(path.join(root,'.env'));
const url=new URL(process.env.MINDCARE_DATABASE_URL);url.hostname='127.0.0.1';url.port='55444';url.pathname='/'+isolation.database;
process.env.MINDCARE_DATABASE_URL=url.href;process.env.MINDCARE_DATABASE_CONNECT_TIMEOUT_MS='30000';process.env.ALEXA_DEBUG_NARRATIVE='1';
process.env.ALEXA_LOCAL_MODEL_ROOT=JSON.parse(readFileSync(path.join(privateRoot,'ssd-model-cache.json'),'utf8')).root;
const require=createRequire(import.meta.url),vite=createRequire(require.resolve('vitest/package.json')),{build}=createRequire(vite.resolve('vite/package.json'))('esbuild');
const entry=path.join(privateRoot,'case-service-current.mjs');
await build({stdin:{contents:"export {alexaDb} from '@/server/alexa/db';export {fermerPool} from '@/server/db/pool';export {buildClinicalContext} from '@/server/alexa/clinical-context';export {summarizeClinicalCaseContext,clinicalNarrativeReferences} from '@/server/alexa/clinical-narrative';export {releaseLocalModel} from '@/server/alexa/local-model';",resolveDir:root,loader:'ts'},outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:path.join(root,'tsconfig.json'),banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},logLevel:'silent'});
const api=await import(pathToFileURL(entry).href),long=process.argv.includes('--long');
const truth=JSON.parse(readFileSync(path.join(privateRoot,'acceptance-source-truth.json'),'utf8')),patient=long?truth.longPatient:truth.primary;
const plan=JSON.parse(readFileSync(path.join(privateRoot,'cohort-plan.json'),'utf8')),actor=plan.visits.find(visit=>visit.patient.id===patient.id)?.patient.practitioner_id;
if(!actor)throw Error('EvaluationActorRequired');
const report={startedAt:new Date().toISOString(),expectedVisits:long?patient.expectedVisits:patient.clinical.consultations.length,bundleSha256:createHash('sha256').update(readFileSync(entry)).digest('hex'),answersInjected:false,status:'RUNNING'};
const reportFile=path.join(privateRoot,long?'long-case-service-report.json':'case-service-report.json');
writeFileSync(reportFile,JSON.stringify(report,null,2));
try{
 const signal=AbortSignal.timeout(3600000),context=await api.buildClinicalContext(api.alexaDb(actor),{patientId:patient.id},{count:100,purpose:'summary',all:true},signal);
 report.coverage=context.coverage;report.value=await api.summarizeClinicalCaseContext(context,signal);
 report.words=report.value.text.trim().split(/\s+/u).length;
 report.citedVisits=api.clinicalNarrativeReferences(context,report.value.sourceIds).filter(reference=>reference.t==='consultation').length;
 const references=api.clinicalNarrativeReferences(context,report.value.sourceIds),visitIds=new Set(context.consultations.map(visit=>visit.id));
 report.referencesValid=references.length>0&&references.every(reference=>reference.t!=='consultation'||visitIds.has(reference.id));
 report.status=report.value.generated&&report.value.complete&&report.words<=70&&context.coverage.complete&&context.coverage.returned===report.expectedVisits&&report.referencesValid?'PASS':'FAIL';
}catch(error){report.status='FAIL';report.error=error.name;}
finally{await api.releaseLocalModel();await api.fermerPool();report.finishedAt=new Date().toISOString();writeFileSync(reportFile,JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,expectedVisits:report.expectedVisits,citedVisits:report.citedVisits,words:report.words}));
process.exitCode=report.status==='PASS'?0:1;
