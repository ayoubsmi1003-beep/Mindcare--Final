// Actual synthetic note edit -> stale analysis hidden -> real Analyse -> fresh reload.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.cache/clinical-evaluation-20261022'),origin='http://127.0.0.1:3006';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(isolation.database,'alexa_eval_clinical_20261022');assert.equal(isolation.port,55444);assert.equal(isolation.restorationVerified,true);
const baseline=JSON.parse(readFileSync(path.join(root,'session-edit-browser-report.json'),'utf8'));
assert.equal(baseline.persistence,'PASS');assert.equal(baseline.analysis.freshBrowserRead,'PASS');
const previous=baseline.analysis.body.data;
const report={startedAt:new Date().toISOString(),consultationId:baseline.consultationId,answersInjected:false,previousVersion:previous.version,status:'RUNNING'};
const save=()=>writeFileSync(path.join(root,'note-regeneration-browser-report.json'),JSON.stringify(report,null,2));save();
// Authored evaluation input, never an expected model answer.
const rawText='La personne rapporte avoir repris un trajet en bus cette semaine. Cette démarche est discutée pendant la séance.';
const subjective='La personne rapporte avoir repris un trajet en bus cette semaine.';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}});
 const session=await context.request.get(origin+'/api/auth/session');assert.ok((await session.json()).data?.userId);
 const page=await context.newPage();await page.goto(`${origin}/consultation/${baseline.consultationId}`,{timeout:300000});
 await page.getByRole('button',{name:/Analyser.*séance/iu}).first().waitFor({timeout:60000});
 const raw=page.getByLabel('Notes de séance',{exact:true});
 if(!await raw.isVisible())await page.getByRole('button',{name:/Brouillon de séance/iu}).click();
 await raw.fill(rawText);
 await page.getByRole('tab',{name:/Subjectif/u}).click();await page.getByLabel('Subjectif',{exact:true}).fill(subjective);
 await page.getByLabel('Autre (préciser…)',{exact:true}).fill('Reprendre les trajets en bus');
 await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
 await page.getByText('Modifications enregistrées.',{exact:true}).waitFor({timeout:120000});
 const readback=page.waitForResponse(response=>response.url().endsWith('/api/db/rpc')&&response.request().postDataJSON()?.name==='get_consultation_analysis',{timeout:120000});
 await page.reload({timeout:300000});
 const hidden=await(await readback).json();assert.equal(hidden.ok,true);assert.deepEqual(hidden.data,[]);
 await raw.waitFor({state:'attached',timeout:60000});assert.equal(await raw.inputValue(),rawText);
 report.invalidated='PASS';report.editedNotesReadback='PASS';save();
 const started=Date.now(),pending=page.waitForResponse(response=>response.url().endsWith('/api/jarvis/jarvis-analyze-session')&&response.request().method()==='POST',{timeout:1000000});
 await page.getByRole('button',{name:/Analyser.*séance/iu}).first().click();
 const response=await pending;report.analysis={durationMs:Date.now()-started,httpStatus:response.status(),body:await response.json()};save();
 const value=report.analysis.body.data;
 assert.ok(report.analysis.body.ok&&value?.persistee&&value.complete&&value.method==='reformulated','QualifiedRegeneratedParagraphRequired');
 assert.ok(value.version>previous.version);assert.notEqual(value.notesDigest,previous.notesDigest);assert.match(value.resume,/\bbus\b/iu);
 await page.reload({timeout:300000});
 const paragraph=page.getByText(value.resume,{exact:true});await paragraph.waitFor({timeout:120000});await paragraph.scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(root,'note-regeneration-reloaded.png'),fullPage:true});
 report.freshRead='PASS';report.newFact='PASS';report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();await browser.close();}
console.log(JSON.stringify({status:report.status,invalidated:report.invalidated,newFact:report.newFact,freshRead:report.freshRead}));
