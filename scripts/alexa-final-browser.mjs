/** Real UI acceptance against the disposable local database. No routes mocked. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';import pg from 'pg';
const origin='http://localhost:3000',root='.cache/alexa';
const manifest=JSON.parse(readFileSync('tests/eval/alexa-final-browser-cases.json','utf8'));
const fixture=JSON.parse(readFileSync(`${root}/browser-patients.json`,'utf8'));
const account=JSON.parse(readFileSync(`${root}/browser-account.json`,'utf8'));
const books=existsSync(`${root}/final-book-snapshot.json`)?JSON.parse(readFileSync(`${root}/final-book-snapshot.json`,'utf8')).state==='PASS':false;
const db=new pg.Client({connectionString:'postgresql://postgres@127.0.0.1:55443/postgres'});await db.connect();
const report={origin,database:'127.0.0.1:55443',positiveResultsInjected:false,transportFaultsSimulated:false,acoustic:'NOT RUN',clinicalAcceptance:'NOT RUN',medicalAnswerAccuracy:'NOT RUN',cases:[]};
const save=()=>writeFileSync(`${root}/final-browser-report.json`,JSON.stringify({...report,counts:report.cases.reduce((a,c)=>{a[c.status]=(a[c.status]??0)+1;return a;},{})},null,2));
const boundary=async()=>Number((await db.query('SELECT count(*) FROM audit.boundary_crossings')).rows[0].count);
const noFallback=/compréhension locale.*indisponible|فهم هذا الطلب.*غير متاح|Quel point souhaitez|ما هي المعلومة|générale.*indisponible|Je n.ai pas pu|données.*indisponibles/iu;
const normalized=s=>s.replace(/\s+/gu,' ').trim();
let browser;
try {
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1365,height:900}});
 const auth=await context.newPage();await auth.goto(`${origin}/connexion`);await auth.getByLabel(/E-mail/iu).fill(account.email);await auth.getByLabel(/Mot de passe/iu).fill(account.password);
 await auth.getByRole('button',{name:/Se connecter/iu}).click();await auth.waitForURL(/\/patients(?:\?|$)/u,{timeout:30000});await auth.close();
 for(const scenario of manifest.cases){
  if(scenario.requires==='approved_books'&&!books){report.cases.push({id:scenario.id,category:scenario.category,status:'NOT RUN',reason:'approved-source-snapshot-unavailable'});save();continue;}
  const t0=Date.now(),page=await context.newPage(),events=[],calls=[];let boundaryBefore=await boundary();
  // Observe actual responses without replacing routes, answers or client behavior.
  await page.addInitScript(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(response.url.endsWith('/api/alexa/turn')){const input=JSON.parse(args[1]?.body??'{}');void response.clone().text().then(body=>sessionStorage.setItem(`alexa-acceptance:${input.clientTurnId}`,body));}return response;};});
  page.on('request',request=>{if(request.url().endsWith('/api/db/rpc')){try{calls.push(request.postDataJSON()?.name);}catch{}}});
  let failure=null;
  try {
   await page.goto(`${origin}/jarvis`);const input=page.locator('main textarea').last();
   for(const text of scenario.turns){
    await input.fill(text);const stream=page.waitForResponse(r=>r.url().endsWith('/api/alexa/turn')&&r.request().method()==='POST',{timeout:95000});
    await page.getByRole('button',{name:'Envoyer',exact:true}).last().click();const response=await stream;
    const sent=response.request().postDataJSON();if(sent.text!==text)throw new Error('submitted-text-differs-from-scenario');
    await page.waitForFunction(key=>sessionStorage.getItem(key)!==null,`alexa-acceptance:${sent.clientTurnId}`,{timeout:95000});
    const body=await page.evaluate(key=>sessionStorage.getItem(key),`alexa-acceptance:${sent.clientTurnId}`);
    const turnEvents=body.split('\n\n').filter(s=>s.startsWith('data: ')).map(s=>JSON.parse(s.slice(6)));events.push(turnEvents);
    if(!response.ok()||turnEvents.some(e=>e.type==='error'))throw new Error('turn-transport-or-source-error');
    if(!turnEvents.some(e=>e.type==='done'))throw new Error('missing-completion');
    const sentences=turnEvents.filter(e=>e.type==='sentence');if(!sentences.length)throw new Error('empty-answer');
    const navigation=turnEvents.find(e=>e.type==='done')?.navigation;
    if(navigation){const path=navigation.target==='patient'?`/patients/${navigation.patientId}`:navigation.target==='dashboard'?'/tableauDeBord':`/${navigation.target}`;await page.waitForURL(url=>url.pathname===path,{timeout:15000});}
    else {const rendered=normalized(sentences.map(s=>s.text).join('\n'));await page.waitForFunction(expected=>Array.from(document.querySelectorAll('[role="log"]')).some(log=>log.innerText.replace(/\s+/gu,' ').includes(expected)),rendered,{timeout:15000});}
   }
   const last=events.at(-1),answer=last.filter(e=>e.type==='sentence').map(e=>e.text).join('\n'),sources=last.filter(e=>e.type==='sentence').flatMap(e=>e.sources),done=last.find(e=>e.type==='done');
   if(/Pouvez-vous préciser : résumé, consultations, traitement ou préparation/u.test(answer))throw new Error('generic-menu');
   if(calls.includes('execute_jarvis_action'))throw new Error('execution-without-confirmation');
   const expect=scenario.expect;
   const named=fixture.patients.filter(p=>scenario.turns.at(-1).toLowerCase().includes(p.label.toLowerCase()));
   if(done.patientId&&named.length===1&&done.patientId!==named[0].id)throw new Error('wrong-patient');
   if(scenario.turns.at(-1).includes('Inconnu')&&done.patientId!==null)throw new Error('stale-patient-reused');
   const wanted=expect==='count_all'?fixture.counts.all:expect==='count_phone'||expect==='empty_phone'?fixture.counts.phone:expect==='count_identity_card'?fixture.counts.identity_card:null;
   if(wanted!==null&&!new RegExp(`(^|\\D)${wanted}(?!\\d)`,'u').test(answer))throw new Error('incorrect-database-count');
   if(expect==='email'&&!/email patient.*n.est pas enregistré|البريد الإلكتروني.*غير مسجل/iu.test(answer))throw new Error('invented-email-field');
   if(expect==='clock'&&!/\d{1,2}[:٫:]\d{2}|[٠-٩]{1,2}:[٠-٩]{2}/u.test(answer))throw new Error('missing-local-clock');
   if(expect==='patient_list'&&sources.filter(s=>s.type==='patient').length!==20)throw new Error('incorrect-page-size');
   if(expect==='different_page'){
    const a=events[0].filter(e=>e.type==='sentence').flatMap(e=>e.sources).map(s=>s.id),b=sources.map(s=>s.id);
    if(b.length!==20||b.some(id=>a.includes(id)))throw new Error('repeated-or-missing-page');
   }
   if(['patient_fact','profile','scope_change'].includes(expect)) {
    if(!done.patientId||noFallback.test(answer))throw new Error('missing-patient-fact');
    if(expect==='profile') {
     const previous=events[0].filter(e=>e.type==='sentence').flatMap(e=>e.sources).filter(s=>s.type==='patient');
     const ordinal=/premier/iu.test(scenario.turns.at(-1))?0:/deuxième/iu.test(scenario.turns.at(-1))?1:2;
     if(done.patientId!==previous[ordinal]?.id||!sources.some(s=>s.type==='patient'&&s.id===done.patientId))throw new Error('wrong-ordinal-profile');
    } else {
     // Empty data are a valid answer only after an actual actor-scoped SQL read.
     await db.query('BEGIN');let clinical;
     try {await db.query('SET LOCAL ROLE authenticated');await db.query("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true)");clinical=(await db.query('SELECT * FROM app.get_alexa_clinical_context($1,20,NULL,NULL)',[done.patientId])).rows[0];await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}
     const real=clinical?.get_alexa_clinical_context??clinical;
     if(!real||real.patientId!==done.patientId)throw new Error('patient-data-unverifiable');
     const lastText=scenario.turns.at(-1),treatment=/traitement|العلاج/iu.test(lastText),diagnosis=/diagnostic/iu.test(lastText),scale=/échelles/iu.test(lastText);
     const wanted=treatment?real.treatments.current:diagnosis?real.diagnoses:scale?real.scales:real.consultations;
     const relevant=sources.filter(s=>s.type===(treatment?'treatment':diagnosis?'diagnostic':scale?'scale':'consultation'));
     if(wanted.length&&!relevant.length)throw new Error('requested-operation-evidence-missing');
     if(!wanted.length&&(relevant.length||!/(?:aucun|0 traitement|aucune|pas de|ما كاين|لا يوجد|غير متوفر)/iu.test(answer)))throw new Error('empty-data-not-reported');
     if(relevant.some(s=>!wanted.some(item=>item.id===s.id)))throw new Error('source-does-not-match-requested-patient-data');
     if(/consultations|consultation|séance|جلسة/iu.test(lastText)&&!treatment&&!diagnosis&&!scale){
      const requested=/20/iu.test(lastText)?20:/cinq/iu.test(lastText)?5:1;
      if(done.coverage?.requested!==requested||done.coverage?.returned!==Math.min(requested,wanted.length)
        ||new Set(relevant.map(s=>s.id)).size!==Math.min(requested,wanted.length))throw new Error('requested-consultation-quantity-not-fulfilled');
     }
    }
   }
   if(expect==='scope_change'&&events[0].find(e=>e.type==='done').patientId===done.patientId)throw new Error('patient-scope-not-replaced');
   if(expect.startsWith('navigate_')&&new URL(page.url()).pathname!==({navigate_patients:'/patients',navigate_agenda:'/agenda',navigate_dashboard:'/tableauDeBord'}[expect]))throw new Error('navigation-not-rendered');
   if(expect.startsWith('help')&&(noFallback.test(answer)||last.some(e=>e.type==='proposal')))throw new Error('help-unanswered-or-action');
   if(expect==='general'&&!last.some(e=>e.type==='sentence'&&e.kind==='inference'))throw new Error('public-answer-unavailable');
   if(expect==='knowledge'&&!sources.some(s=>s.type==='knowledge'))throw new Error('knowledge-evidence-missing');
   if(expect==='hybrid'&&(!done.patientId||!sources.some(s=>s.type==='knowledge')||!sources.some(s=>s.type!=='knowledge')))throw new Error('hybrid-sources-missing');
   if(['private_no_cloud','no_execution','safe_ambiguity'].includes(expect)&&(await boundary())!==boundaryBefore)throw new Error('private-boundary-crossing');
   if(expect==='safe_ambiguity'){
    if(['ambiguity-01','ambiguity-02','ambiguity-03','ambiguity-06','ambiguity-08','ambiguity-09','ambiguity-10'].includes(scenario.id)&&done.patientId!==null)throw new Error('unbound-or-ambiguous-patient-selected');
    if(scenario.id==='ambiguity-01'&&!/Plusieurs dossiers|عدة ملفات/iu.test(answer))throw new Error('homonym-choice-not-offered');
    if(['ambiguity-04','ambiguity-05'].includes(scenario.id)&&(!done.patientId||noFallback.test(answer)))throw new Error('ambiguity-choice-not-resolved');
    if(scenario.id==='ambiguity-07'&&done.patientId!==fixture.patients.find(p=>p.label==='FinalPatient Beta')?.id)throw new Error('named-scope-not-replaced');
   }
  }catch(e){failure=e.message;}
  report.cases.push({id:scenario.id,category:scenario.category,status:failure?'FAIL':'PASS',reason:failure,durationMs:Date.now()-t0,turns:events.map(turn=>({events:turn.map(e=>({type:e.type,...(e.type==='done'?{patientId:e.patientId,limited:e.limited,coverage:e.coverage,sourceRevision:e.sourceRevision}:{}),...(e.type==='sentence'?{kind:e.kind,sources:e.sources.map(s=>({type:s.type,id:s.id,version:s.version}))}:{})})),answer:turn.filter(e=>e.type==='sentence').map(e=>e.text).join('\n').slice(0,1200)}))});
  await page.close();save();console.log(JSON.stringify({id:scenario.id,status:failure?'FAIL':'PASS',reason:failure}));
 }
}catch(error){report.infrastructure='FAIL: browser-authentication-or-launch';report.infrastructureDetail=String(error?.message??error).replace(account.password,'[redacted]').slice(0,1500);for(const s of manifest.cases)if(!report.cases.some(r=>r.id===s.id))report.cases.push({id:s.id,category:s.category,status:'NOT RUN',reason:'browser-infrastructure-failed'});save();}
finally{await browser?.close();await db.end();}
