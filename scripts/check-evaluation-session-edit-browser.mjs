// Evaluation-only clinical inputs entered through the real UI; no generated answer is supplied.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.cache/clinical-evaluation-20261022'),origin='http://127.0.0.1:3006';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(isolation.database,'alexa_eval_clinical_20261022');assert.equal(isolation.port,55444);assert.equal(isolation.restorationVerified,true);
const reportPath=path.join(root,'session-edit-browser-report.json');
const existing=existsSync(reportPath)?JSON.parse(readFileSync(reportPath,'utf8')):null;
const appointment=JSON.parse(readFileSync(path.join(root,'ui-flow-appointments.json'),'utf8'))[0];
assert.ok(appointment?.patientId&&appointment.id,'ExistingEvaluationAppointmentRequired');
const expected={raw:'La séance reprend les repères consignés dans le suivi. La personne souhaite préciser une prochaine étape concrète.',subjective:'La personne souhaite reprendre l’objectif consigné lors de la dernière séance.',objective:'L’entretien reprend les notes disponibles et permet de préciser une prochaine étape.',assessment:'Les difficultés et l’évolution sont à préciser pendant l’entretien.',plan:'Reprendre les repères consignés et préciser le prochain rendez-vous.',focus:'Reprendre les repères du suivi',measures:{anxiete:4,sommeil:3,humeur:4}};
const report=existing??{startedAt:new Date().toISOString(),database:isolation.database,appointmentId:appointment.id,patientId:appointment.patientId,status:'RUNNING',answersInjected:false,expected};
assert.equal(report.patientId,appointment.patientId);assert.equal(report.appointmentId,appointment.id);
report.status='RUNNING';delete report.error;delete report.controls;delete report.rendered;
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({headless:true});
let page;
try{
 const context=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}});page=await context.newPage();
 const auth=await context.request.get(`${origin}/api/auth/session`),session=await auth.json();assert.ok(auth.ok()&&session.ok&&session.data?.userId,'AuthenticatedEvaluationSessionRequired');
 if(!report.consultationId){
  await page.goto(`${origin}/patients/${appointment.patientId}`,{timeout:300000});
  await page.getByRole('button',{name:'Démarrer la séance',exact:true}).click({timeout:60000});
  await page.waitForURL(/\/consultation\/[a-f0-9-]+$/u,{timeout:60000});
  report.consultationId=new URL(page.url()).pathname.split('/').at(-1);save();
 }else await page.goto(`${origin}/consultation/${report.consultationId}`,{timeout:300000});
 await page.getByRole('button',{name:/Analyser.*séance/iu}).first().waitFor({timeout:60000});
 const raw=page.getByLabel('Notes de séance',{exact:true});
 if(!await raw.isVisible())await page.getByRole('button',{name:/Brouillon de séance/iu}).click();
 await raw.fill(expected.raw);
 for(const [field,label] of [['subjective','Subjectif'],['objective','Objectif'],['assessment','Évaluation'],['plan','Conduite à tenir']]){
  await page.getByRole('tab',{name:new RegExp(label,'u')}).click();await page.getByLabel(label,{exact:true}).fill(expected[field]);
 }
 await page.getByLabel('Autre (préciser…)',{exact:true}).fill(expected.focus);
 for(const [key,value] of Object.entries(expected.measures)){
  const slider=page.locator(`#mesure-${key}`);await slider.press('Home');for(let n=1;n<value;n++)await slider.press('ArrowRight');
  assert.equal(await slider.inputValue(),String(value));
 }
 await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
 await page.getByText('Modifications enregistrées.',{exact:true}).waitFor({timeout:120000});
 // Read through the same authenticated gate until the autosave queues have committed all five areas.
 await page.waitForFunction(async({id,wanted})=>{
  const response=await fetch('/api/db/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'get_consultation',args:{p_id:id}})});
  const body=await response.json(),row=body.data?.[0];
  const detailResponse=await fetch('/api/db/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'get_session_details',args:{p_id:id}})}),details=await detailResponse.json(),value=details.data?.[0];
  return body.ok&&row?.raw_notes===wanted.raw&&['subjective','objective','assessment','plan'].every(key=>row[key]===wanted[key])&&details.ok&&value?.focusLibre===wanted.focus&&Object.entries(wanted.measures).every(([key,score])=>value.mesures?.[key]===score);
 },{id:report.consultationId,wanted:expected},{timeout:60000});
 await page.reload({timeout:300000});await raw.waitFor({state:'attached',timeout:60000});
 assert.equal(await raw.inputValue(),expected.raw);
 for(const [field,label] of [['subjective','Subjectif'],['objective','Objectif'],['assessment','Évaluation'],['plan','Conduite à tenir']]){
  await page.getByRole('tab',{name:new RegExp(label,'u')}).click();assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),expected[field]);
 }
 assert.equal(await page.getByLabel('Autre (préciser…)',{exact:true}).inputValue(),expected.focus);
 await page.waitForFunction(wanted=>Object.entries(wanted).every(([key,value])=>document.querySelector(`#mesure-${key}`)?.value===String(value)),expected.measures,{timeout:60000});
 for(const [key,value] of Object.entries(expected.measures))assert.equal(await page.locator(`#mesure-${key}`).inputValue(),String(value));
 report.persistence='PASS';save();
 await page.locator('#mesure-anxiete').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(root,'session-edit-reloaded-top.png'),fullPage:true});
 await page.getByRole('tab',{name:/Conduite à tenir/u}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(root,'session-edit-reloaded-notes.png'),fullPage:true});
 if(process.argv.includes('--analyse')){
  const started=Date.now(),pending=page.waitForResponse(r=>r.url().endsWith('/api/jarvis/jarvis-analyze-session')&&r.request().method()==='POST',{timeout:1000000});
  await page.getByRole('button',{name:/Analyser.*séance/iu}).first().click();
  const response=await pending;report.analysis={httpStatus:response.status(),durationMs:Date.now()-started,body:await response.json()};save();
  await page.reload({timeout:300000});await page.getByRole('button',{name:/Analyser.*séance/iu}).first().waitFor({timeout:60000});
  await page.screenshot({path:path.join(root,'session-edit-analysis-reloaded.png'),fullPage:true});
  const analysis=report.analysis.body?.data;
  report.analysis.status=report.analysis.body?.ok&&analysis?.persistee&&analysis?.complete&&analysis?.method==='reformulated'?'PASS':'FAIL';
 }
 report.status=report.persistence==='PASS'&&(!process.argv.includes('--analyse')||report.analysis?.status==='PASS')?'PASS':'FAIL';report.finishedAt=new Date().toISOString();save();
 console.log(JSON.stringify({status:report.status,persistence:report.persistence,analysisOk:report.analysis?.body?.ok}));
}catch(error){report.status='FAIL';report.error=error.message;if(page){await page.screenshot({path:path.join(root,'session-edit-failure.png'),fullPage:true}).catch(()=>{});report.controls=await page.locator('input[type="range"]').evaluateAll(nodes=>nodes.map(n=>({id:n.id,value:n.value,label:n.getAttribute('aria-valuetext')}))).catch(()=>[]);report.rendered=await page.locator('body').innerText().catch(()=>'');}save();throw error;}finally{await browser.close();}
