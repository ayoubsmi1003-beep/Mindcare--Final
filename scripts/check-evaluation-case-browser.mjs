// Real case-summary button, actual model response, source coverage and fresh browser read.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.cache/clinical-evaluation-20261022'),origin='http://127.0.0.1:3006';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(isolation.database,'alexa_eval_clinical_20261022');assert.equal(isolation.port,55444);assert.equal(isolation.restorationVerified,true);
const truth=JSON.parse(readFileSync(path.join(root,'acceptance-source-truth.json'),'utf8'));
const long=process.argv.includes('--long'),patient=long?truth.longPatient:truth.primary;
const verifySaved=process.argv.includes('--verify-saved');
const reportPath=path.join(root,long?'long-case-browser-report.json':'case-browser-report.json');
const prior=verifySaved?JSON.parse(readFileSync(reportPath,'utf8')):null;
const report={startedAt:new Date().toISOString(),patientId:patient.id,expectedVisits:long?patient.expectedVisits:patient.clinical.consultations.length,answersInjected:false,status:'RUNNING'};
if(prior){assert.equal(prior.patientId,patient.id);assert.ok(prior.response?.body?.ok);report.response=prior.response;report.originalGenerationStartedAt=prior.startedAt;report.verificationOnly=true;}
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));save();
const browser=await chromium.launch({headless:true});let page;
try{
 const context=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}});
 const auth=await context.request.get(origin+'/api/auth/session');
 page=await context.newPage();
 if(!(await auth.json()).data?.userId){
  assert.ok(process.env.MINDCARE_EVAL_USERNAME&&process.env.MINDCARE_EVAL_PASSWORD,'EvaluationSessionExpired');
  await page.goto(`${origin}/connexion`,{timeout:300000});
  await page.getByLabel(/nom.*utilisateur/iu).fill(process.env.MINDCARE_EVAL_USERNAME);
  await page.getByLabel(/mot de passe/iu).fill(process.env.MINDCARE_EVAL_PASSWORD);
  await page.getByRole('button',{name:/se connecter/iu}).click();
  await page.waitForURL(/\/patients(?:\?|$)/u,{timeout:120000});
  await context.storageState({path:path.join(root,'browser-state.json')});
 }
 await page.goto(`${origin}/patients/${patient.id}`,{timeout:300000});
 const card=page.locator('section').filter({has:page.getByRole('heading',{name:'Résumé du cas',exact:true})});
 if(!verifySaved){
 const button=card.getByRole('button',{name:/Générer le résumé|Regénérer le résumé|Régénérer le résumé|Réessayer|Actualiser/iu}).first();
 await button.waitFor({timeout:120000});
 const started=Date.now(),pending=page.waitForResponse(response=>/\/api\/(?:alexa\/summary|jarvis\/jarvis-resume-cas)$/u.test(new URL(response.url()).pathname)&&response.request().method()==='POST',{timeout:14500000});
 void pending.catch(()=>{});
 await button.click({timeout:180000});const response=await pending;
 assert.equal(response.request().postDataJSON().patientId,patient.id);
 report.response={httpStatus:response.status(),durationMs:Date.now()-started,body:await response.json()};save();
 }
 const body=report.response.body,value=body.data;
 assert.ok(body.ok&&value?.coverage?.complete&&value.coverage.returned===report.expectedVisits&&!value.limited,'QualifiedWholeCaseRequired');
 const paragraph=value.resume.content.apercu.contexte[0];assert.ok(paragraph?.texte);
 report.words=paragraph.texte.trim().split(/\s+/u).length;assert.ok(report.words<=70,'CaseSummaryTooLong');
 assert.ok(paragraph.sources.length>0,'CaseEvidenceRequired');
 if(!long){const visits=new Set(patient.clinical.consultations.map(visit=>visit.id));for(const source of paragraph.sources.filter(source=>source.t==='consultation'))assert.ok(visits.has(source.id),'CaseEvidenceOutsidePatient');}
 report.readCoverageVerified=true;report.selectedReferences=paragraph.sources.length;
 await page.reload({timeout:300000});const text=card.locator('p').filter({hasText:paragraph.texte}).first();await text.waitFor({timeout:120000});
 assert.equal(await text.evaluate(element=>Array.from(element.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim()),paragraph.texte,'PersistedParagraphChanged');
 await text.scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(root,long?'long-case-reloaded.png':'case-reloaded.png'),fullPage:false});
 report.freshRead='PASS';report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;await page?.screenshot({path:path.join(root,long?'long-case-failure.png':'case-failure.png'),fullPage:false}).catch(()=>{});process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();await browser.close();}
console.log(JSON.stringify({status:report.status,expectedVisits:report.expectedVisits,freshRead:report.freshRead,error:report.error}));
