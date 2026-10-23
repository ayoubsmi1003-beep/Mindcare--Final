// Actual actor-bound pagination and authenticated browser read, without inference.
import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.cache/clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(isolation.database,'alexa_eval_clinical_20261022');assert.equal(isolation.port,55444);assert.equal(isolation.restorationVerified,true);
loadEnvFile('.env');
const url=new URL(process.env.MINDCARE_DATABASE_URL);url.hostname='127.0.0.1';url.port='55444';url.pathname='/'+isolation.database;process.env.MINDCARE_DATABASE_URL=url.href;
const plan=JSON.parse(readFileSync(path.join(root,'cohort-plan.json'),'utf8'));
const patient=plan.patients.find(p=>p.count>100);
const expected=plan.visits.filter(v=>v.patient.id===patient.id).map(v=>v.id).sort();
const api=await import(pathToFileURL(path.join(root,'clinical-services.mjs')).href);
let browser;
const report={startedAt:new Date().toISOString(),expected:expected.length,inferenceCalls:0,gate:'NOT RUN',browser:'NOT RUN'};
try{
 const context=await api.buildClinicalContext(api.alexaDb(patient.practitioner_id),{patientId:patient.id},{count:100,all:true},AbortSignal.timeout(120000));
 assert.equal(context.coverage.complete,true);assert.equal(context.coverage.hasMore,false);
 assert.deepEqual(context.consultations.map(v=>v.id).sort(),expected);
 assert.ok(context.consultations.every(v=>v.rawNotes&&v.sessionDetails&&v.notes.length));
 report.gate='PASS';report.returned=context.consultations.length;report.sourceRevision=context.sourceRevision;
 if(process.argv.includes('--browser')){
  browser=await chromium.launch({headless:true});
  const session=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}});
  const auth=await session.request.get('http://127.0.0.1:3006/api/auth/session');
  assert.ok((await auth.json()).data?.userId);
  const page=await session.newPage();
  const savedSummary=page.waitForResponse(response=>response.url().endsWith('/api/db/rpc')&&response.request().method()==='POST'&&response.request().postDataJSON()?.name==='get_alexa_case_summary',{timeout:120000});
  void savedSummary.catch(()=>{});
  await page.goto(`http://127.0.0.1:3006/patients/${patient.id}`,{timeout:300000});
  await page.getByRole('tab',{name:/Vue d’ensemble|Vue d'ensemble/iu}).waitFor({timeout:120000});
  const saved=await(await savedSummary).json();assert.equal(saved.ok,true);assert.deepEqual(saved.data,[]);
  await page.getByRole('button',{name:'Générer le résumé',exact:true}).waitFor({timeout:60000});
  assert.ok(!(await page.getByRole('main').innerText()).includes('RÉSUMÉ IA INDISPONIBLE'));
  report.absentSummaryState='PASS';
  assert.ok(!(await page.getByRole('main').innerText()).includes('Patient introuvable'));
  await page.screenshot({path:path.join(root,'long-history-patient.png'),fullPage:true});
  report.browser='CAPTURED';
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{await browser?.close();await api.fermerPool();report.finishedAt=new Date().toISOString();writeFileSync(path.join(root,'long-history-read.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
