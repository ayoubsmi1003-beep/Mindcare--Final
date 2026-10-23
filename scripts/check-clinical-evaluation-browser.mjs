import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('.cache/clinical-evaluation-20261022'),origin='http://127.0.0.1:3006';
const plan=JSON.parse(readFileSync(path.join(root,'cohort-plan.json'),'utf8'));
const pilot=plan.patients.filter(p=>p.count<100)[0];
const accepted=process.argv.includes('--accepted-pilot')?JSON.parse(readFileSync(path.join(root,'historical-analysis-backfill.json'),'utf8')).reports.find(r=>r.status==='PASS'&&r.value?.persistee&&r.value?.complete):null;
if(process.argv.includes('--accepted-pilot')&&!accepted)throw Error('QualifiedPilotRequired');
const visit=accepted?plan.visits.find(v=>v.id===accepted.consultationId):plan.visits.filter(v=>v.patient.id===pilot.id).sort((a,b)=>b.at.localeCompare(a.at))[0];
if(!visit)throw Error('EvaluationVisitRequired');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}});
const page=await context.newPage();
try{
 const sessionResponse=await context.request.get(`${origin}/api/auth/session`,{timeout:60000});
 const session=await sessionResponse.json();
 if(!sessionResponse.ok()||!session.ok)throw Error('EvaluationDatabaseUnavailable');
 if(!session.data?.userId){
  if(!process.env.MINDCARE_EVAL_USERNAME||!process.env.MINDCARE_EVAL_PASSWORD)throw Error('EvaluationSessionExpired');
  await page.goto(`${origin}/connexion`,{timeout:300000});
  await page.getByLabel(/nom.*utilisateur/iu).fill(process.env.MINDCARE_EVAL_USERNAME);
  await page.getByLabel(/mot de passe/iu).fill(process.env.MINDCARE_EVAL_PASSWORD);
  await page.getByRole('button',{name:/se connecter/iu}).click();
  await page.waitForURL(/\/patients(?:\?|$)/u,{timeout:120000});
  await context.storageState({path:path.join(root,'browser-state.json')});
 }
 await page.goto(`${origin}/consultation/${visit.id}`,{timeout:300000});
 await page.getByRole('button',{name:/Analyser.*séance/}).first().waitFor({timeout:300000});
 if(accepted){
  const expected=accepted.value.resume,words=expected.trim().split(/\s+/u).length;
  if(words>70)throw Error('ClinicalSummaryTooLong');
  await page.getByText(expected,{exact:true}).first().waitFor({timeout:120000});
  await page.reload({timeout:300000});
  await page.getByText(expected,{exact:true}).first().waitFor({timeout:120000});
  await page.getByText(expected,{exact:true}).first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,'short-summary-reloaded.png'),fullPage:false});
  writeFileSync(path.join(root,'short-summary-browser.json'),JSON.stringify({status:'PASS',consultationId:visit.id,words,reloaded:true,exactPersistedParagraphVisible:true},null,2));
  console.log(JSON.stringify({shortSummary:'PASS',words,reloaded:true}));
 }
 await page.screenshot({path:path.join(root,'pilot-consultation.png'),fullPage:true});
 writeFileSync(path.join(root,'pilot-fields.json'),JSON.stringify({inputs:await page.locator('input').evaluateAll(es=>es.map(e=>({type:e.type,id:e.id,value:e.value}))),textareas:await page.locator('textarea').evaluateAll(es=>es.map(e=>({id:e.id,placeholder:e.placeholder,value:e.value}))),buttons:await page.getByRole('button').allTextContents()},null,2));
 if(process.argv.includes('--analyse')){
  const start=Date.now();
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/jarvis/jarvis-analyze-session')&&r.request().method()==='POST',{timeout:1000000});
  await page.getByRole('button',{name:/Analyser.*séance/}).first().click();
  const response=await pending;
  const body=await response.json();writeFileSync(path.join(root,'pilot-analysis.json'),JSON.stringify({status:response.status(),durationMs:Date.now()-start,body},null,2));
  console.log(JSON.stringify({analysisStatus:response.status(),ok:body.ok,durationMs:Date.now()-start}));
  const analysed=body.data;
  if(!response.ok()||!body.ok||!analysed?.complete||!analysed.generated||!analysed.persistee||typeof analysed.resume!=='string')throw Error('QualifiedPersistedAnalysisRequired');
  const words=analysed.resume.trim().split(/\s+/u).length;if(words>70)throw Error('ClinicalSummaryTooLong');
  await page.reload({timeout:300000});
  const paragraph=page.getByText(analysed.resume,{exact:true}).first();await paragraph.waitFor({timeout:120000});await paragraph.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,'pilot-analysis-reloaded.png'),fullPage:false});
  writeFileSync(path.join(root,'pilot-analysis-browser.json'),JSON.stringify({status:'PASS',consultationId:visit.id,words,reloaded:true,exactPersistedParagraphVisible:true},null,2));
 }
 console.log(JSON.stringify({consultationLoaded:true,fields:await page.locator('textarea').count()}));
}catch(error){
 await page.screenshot({path:path.join(root,'browser-failure.png'),fullPage:true}).catch(()=>{});
 writeFileSync(path.join(root,'browser-failure.json'),JSON.stringify({url:page.url(),text:await page.locator('body').innerText().catch(()=>''),error:error.name},null,2));
 throw error;
}finally{await browser.close();}
