// Synthetic evaluation only: rapid focus/score writes must finish before the real note signature.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.cache/clinical-evaluation-20261022'),origin='http://127.0.0.1:3006';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(isolation.database,'alexa_eval_clinical_20261022');assert.equal(isolation.port,55444);assert.equal(isolation.restorationVerified,true);
const baseline=JSON.parse(readFileSync(path.join(root,'session-edit-browser-report.json'),'utf8'));
const expected={focus:'Reprendre les trajets en bus et préciser les repères du suivi',measures:{anxiete:5,sommeil:4,humeur:5}};
const report={startedAt:new Date().toISOString(),consultationId:baseline.consultationId,status:'RUNNING',detailsRequestsAfterClick:0,expected};
const save=()=>writeFileSync(path.join(root,'sign-flush-browser-report.json'),JSON.stringify(report,null,2));save();
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}}),page=await context.newPage();
 page.on('dialog',dialog=>dialog.accept());
 let transition=false,sent=false;
 page.on('request',request=>{if(request.url().endsWith('/api/db/rpc')&&request.method()==='POST'){const name=request.postDataJSON()?.name;if(transition&&name==='save_session_details'&&!sent)report.detailsRequestsAfterClick++;if(name==='sign_note')sent=true;}});
 await page.goto(`${origin}/consultation/${baseline.consultationId}`,{timeout:300000});
 const sign=page.getByRole('button',{name:'Signer la note',exact:true});await sign.waitFor({timeout:120000});
 for(const [key,value] of Object.entries(expected.measures)){const slider=page.locator(`#mesure-${key}`);await slider.press('Home');for(let i=1;i<value;i++)await slider.press('ArrowRight');}
 const focus=page.getByLabel('Autre (préciser…)',{exact:true});await focus.fill('');await focus.pressSequentially(expected.focus,{delay:1});
 const signed=page.waitForResponse(response=>response.url().endsWith('/api/db/rpc')&&response.request().method()==='POST'&&response.request().postDataJSON()?.name==='sign_note',{timeout:120000});void signed.catch(()=>{});
 transition=true;await sign.click({timeout:120000});const response=await(await signed).json();assert.equal(response.ok,true);
 const actual=await page.evaluate(async id=>{
  const rpc=async(name,args)=>(await(await fetch('/api/db/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})).json());
  return {consultation:await rpc('get_consultation',{p_id:id}),details:await rpc('get_session_details',{p_id:id})};
 },baseline.consultationId);
 assert.equal(actual.consultation.ok,true);assert.equal(actual.consultation.data[0].note_status,'signed');
 assert.equal(actual.details.ok,true);assert.equal(actual.details.data[0].focusLibre,expected.focus);assert.deepEqual(actual.details.data[0].mesures,expected.measures);
 await page.reload({timeout:300000});await page.getByLabel('Autre (préciser…)',{exact:true}).waitFor({state:'attached',timeout:60000});
 await page.screenshot({path:path.join(root,'sign-flush-reloaded.png'),fullPage:true});
 report.persisted='PASS';report.raceExercised=report.detailsRequestsAfterClick>0;report.status=report.raceExercised?'PASS':'PARTIAL';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();save();await browser.close();}
console.log(JSON.stringify({status:report.status,persisted:report.persisted,raceExercised:report.raceExercised,detailsRequestsAfterClick:report.detailsRequestsAfterClick,error:report.error}));
