// Actual authenticated UI turns on the isolated app; answers and routes are never replaced.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
const root=path.resolve('.cache/clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
assert.equal(isolation.database,'alexa_eval_clinical_20261022');assert.equal(isolation.port,55444);assert.equal(isolation.restorationVerified,true);
const manifest=JSON.parse(readFileSync(path.join(root,'acceptance-questions.json'),'utf8'));
assert.equal(manifest.origin,'http://127.0.0.1:3006');assert.equal(manifest.cases.length,10);
const report={startedAt:new Date().toISOString(),origin:manifest.origin,database:isolation.database,answersInjected:false,semanticAccuracy:'NOT RUN',cases:[]};
const save=()=>writeFileSync(path.join(root,'questions-browser-report.json'),JSON.stringify(report,null,2));
const normalize=s=>s.replace(/\s+/gu,' ').trim();
const unavailable=/pas pu produire|pas pu générer|synthèse assez fiable|compréhension locale.*indisponible|données.*indisponibles|pouvez-vous préciser/iu;
function parseEvents(body){return body.split(/\r?\n\r?\n/u).flatMap(block=>block.split(/\r?\n/u).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))));}
// Check the observer against the protocol, without substituting any application response.
assert.deepEqual(parseEvents('data: {"type":"done"}\n\n'),[{type:'done'}]);
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({storageState:path.join(root,'browser-state.json'),viewport:{width:1600,height:1100}});
 // The UI aborts its SSE reader after done; retain a passive clone before that abort discards the browser's network body.
 await context.addInitScript(()=>{
  const fetchOriginal=window.fetch;
  window.fetch=async(...args)=>{
   const response=await fetchOriginal(...args);
   if(response.url.endsWith('/api/alexa/turn')){
    const id=JSON.parse(args[1]?.body??'{}').clientTurnId;
    void(async()=>{const reader=response.clone().body?.getReader();if(!reader)return;const decoder=new TextDecoder();let body='';try{for(;;){const {done,value}=await reader.read();body+=decoder.decode(value,{stream:!done});sessionStorage.setItem(`evaluation-observed:${id}`,body);if(done)break;}}catch{/* The actual UI may abort after its done event; retain the received prefix. */}})();
   }
   return response;
  };
 });
 const sessionResponse=await context.request.get(`${manifest.origin}/api/auth/session`,{timeout:60000}),session=await sessionResponse.json();
 assert.equal(sessionResponse.ok(),true);assert.ok(session.ok&&session.data?.userId,'AuthenticatedEvaluationSessionRequired');
 const page=await context.newPage();await page.goto(`${manifest.origin}/jarvis`,{timeout:300000});
 for(const scenario of manifest.cases){
  const result={id:scenario.id,status:'CAPTURED',semanticAccuracy:'NOT RUN',turns:[]};report.cases.push(result);save();
  try{
   for(const question of scenario.turns){
    const started=Date.now(),input=page.locator('main textarea').last();await input.waitFor({timeout:60000});
    await input.fill(question);
    const pending=page.waitForResponse(r=>r.url().endsWith('/api/alexa/turn')&&r.request().method()==='POST',{timeout:1000000});
    await page.getByRole('button',{name:'Envoyer',exact:true}).last().click();
    const response=await pending;assert.equal(response.request().postDataJSON().text,question);
    const key=`evaluation-observed:${response.request().postDataJSON().clientTurnId}`;
    await page.waitForFunction(storageKey=>{const body=sessionStorage.getItem(storageKey);return body?.split(/\r?\n\r?\n/u).some(block=>block.split(/\r?\n/u).some(line=>{if(!line.startsWith('data: '))return false;try{return ['done','error'].includes(JSON.parse(line.slice(6)).type);}catch{return false;}}));},key,{timeout:1000000});
    const events=parseEvents(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key)),sentences=events.filter(e=>e.type==='sentence'),done=events.find(e=>e.type==='done');
    const answer=sentences.map(e=>e.text).join('\n');
    result.turns.push({question,httpStatus:response.status(),durationMs:Date.now()-started,answer,events});save();
    assert.ok(response.ok(),'HTTPFailure');assert.ok(!events.some(e=>e.type==='error'),'TurnError');assert.ok(done,'MissingCompletion');assert.ok(answer,'EmptyAnswer');
    await page.waitForFunction(expected=>Array.from(document.querySelectorAll('[role="log"]')).some(log=>log.innerText.replace(/\s+/gu,' ').includes(expected)),normalize(answer),{timeout:30000});
    if(unavailable.test(answer))result.status='FAIL';
   }
   await page.screenshot({path:path.join(root,`questions-${scenario.id}.png`),fullPage:true});
  }catch(error){result.status='FAIL';result.error=error.message;await page.screenshot({path:path.join(root,`questions-${scenario.id}-failure.png`),fullPage:true}).catch(()=>{});}
  save();console.log(JSON.stringify({id:scenario.id,status:result.status,turns:result.turns.length}));
 }
 report.finishedAt=new Date().toISOString();save();
}finally{await browser.close();}
process.exitCode=report.cases.some(c=>c.status==='FAIL')?1:0;
