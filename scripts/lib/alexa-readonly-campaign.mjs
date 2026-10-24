import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {readOnlyPort,reviewManifest,semanticSignature} from './alexa-eval-readonly.mjs';
import {verifyCampaignState} from './alexa-eval-finalize.mjs';
import {calendarOracle,calendarDataMatches,calendarPresentationMatches} from './alexa-eval-calendar-oracle.mjs';
import {recordReadMatches,recordMembershipMatches,financialRowsMatch,financialPresentationMatches,financialTotalsMatch,firstAppointmentPresented} from './alexa-eval-record-meaning.mjs';
import {effectiveOracle,missingBehaviorPrerequisite,missingDataPrerequisite,assessBehavior} from './alexa-eval-behavior.mjs';
import {sourceInventory,campaignActors,patientBindings,businessSnapshot,auditMark,auditChanges,patientOracle,recordOracle,knowledgeOracle,applicationOracle,inspectSql,literal,evidenceHash} from './alexa-eval-oracle.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rpcValue=value=>Array.isArray(value)?value.length===1?value[0]:value:value;
const toDates=q=>({...q,...(q.from_?{from:q.from_}:{}),from_:undefined});
function queryMeaning(q){const norm=c=>JSON.stringify(c);return {population:q.population??'active',mode:q.mode,query:q.query??null,sort:q.sort??'name',patientIds:q.patientIds??null,metrics:q.metrics??null,offset:q.offset??0,limit:q.limit??20,groups:(q.filterGroups??[q.filters??[]]).map(g=>g.map(norm).sort()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),consultationPeriod:q.consultationPeriod??null,createdPeriod:q.createdPeriod??null};}

export async function runReadOnlyCampaign(argv=process.argv.slice(2)){
 const arg=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
 const root=process.cwd(),out=resolve(arg('--out','.eval-out/alexa-agent/fr200/current.json'));
 const manifestPath=resolve(arg('--manifest','tests/eval/alexa-fr-200-cases.json'));
 const semanticReviewPath=arg('--semantic-review',null),semanticReview=semanticReviewPath?JSON.parse(await readFile(resolve(semanticReviewPath),'utf8')):undefined;
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')),review=reviewManifest(manifest,semanticReview);
 const source=sourceInventory(),actors=campaignActors(),bindings=patientBindings();
 if(!actors.owner||!bindings.primary||source.patients!==1558||source.generated!==8142)throw Error('EvaluationCopyDriftRequiresReview');
 const supplied=process.env.MINDCARE_ALEXA_EVAL_DATABASE_URL;
 if(!supplied)throw Error('ExplicitEvaluationApplicationUrlRequired');
 const target=new URL(supplied);
 if(!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='55444'||target.pathname!=='/alexa_eval_clinical_20261022')throw Error('EvaluationTargetMismatch');
 process.env.MINDCARE_DATABASE_URL=supplied;process.env.ALEXA_DEBUG_NARRATIVE='0';process.env.VOICE_PROVIDER='off';
 const baseline=argv.includes('--baseline'),dir=join(root,'.eval-out/alexa-agent/fr200'),entry=join(dir,baseline?'baseline/entry.mjs':'current-entry.mjs');
 await mkdir(resolve(out,'..'),{recursive:true});
 if(!baseline){const require=createRequire(import.meta.url),vite=createRequire(require.resolve('vitest/package.json')),{build}=createRequire(vite.resolve('vite/package.json'))('esbuild');await build({stdin:{contents:"export {runAlexa} from '@/server/alexa/orchestrator';export {alexaDb} from '@/server/alexa/db';export {clientSql} from '@/server/jarvis/client-sql';export {inferLocalCompletion,releaseLocalModel} from '@/server/alexa/local-model';export {fermerPool} from '@/server/db/pool';export {ALEXA_NATIVE_DEADLINE_MS} from '@/shared/alexa/agent';",resolveDir:root,loader:'ts'},outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:join(root,'tsconfig.json'),logLevel:'silent'});}
 const api=await import(pathToFileURL(entry).href),before=businessSnapshot(),mark=before.$auditPrefix.through;
 const harnessFiles=['scripts/eval-alexa-agent.mjs','scripts/lib/alexa-readonly-campaign.mjs','scripts/lib/alexa-eval-readonly.mjs','scripts/lib/alexa-eval-oracle.mjs','scripts/lib/alexa-eval-finalize.mjs','scripts/lib/alexa-eval-inspection-rows.mjs','scripts/lib/alexa-eval-record-meaning.mjs','scripts/lib/alexa-eval-calendar-oracle.mjs','scripts/lib/alexa-eval-behavior.mjs'];
 const harness=Object.fromEntries(await Promise.all(harnessFiles.map(async path=>[path,createHash('sha256').update(await readFile(join(root,path))).digest('hex')])));
 const run={phase:baseline?'baseline':'after',startedAt:new Date().toISOString(),asOf:manifest.fixtureAsOf,manifestSha256:hash(manifest),bundleSha256:createHash('sha256').update(await readFile(entry)).digest('hex'),harnessSha256:hash(harness),harness,environmentSha256:hash({source,actors,bindings}),source,review,positiveAnswersInjected:false,readOnly:true};
 await writeFile(out.replace(/\.json$/u,'')+'.before.private.json',JSON.stringify({before,mark}));
 const requested=new Set(arg('--cases','all').split(',')),rows=[],privateRecords=[];
 const persist=async(final=false)=>{const tally=rows.reduce((a,r)=>(a[r.verdict]=(a[r.verdict]??0)+1,a),{});await writeFile(out,JSON.stringify({version:3,run,status:final?(tally.PASS===200&&review.accepted===200&&run.nonMutation==='PASS'?'PASS':'PARTIAL'):'RUNNING',tally,rows},null,2));};
 try{
  for(const candidate of manifest.cases){
   const spec={...candidate,oracle:effectiveOracle(candidate.oracle)};
   if(!requested.has('all')&&!requested.has(spec.id))continue;
   const started=performance.now(),queries=[],calls=[],events=[],inferences=[];
   const actor=actors[spec.actor??'owner'];if(!actor){rows.push({id:spec.id,verdict:'NOT RUN',failure:'actor-unavailable'});continue;}
   let expected,oracleBlocked=missingBehaviorPrerequisite(spec.oracle);
   try{
    const oracle=spec.oracle;
    if(oracle.kind==='patients')expected=patientOracle(oracle.query,run.asOf,actor);
    else if(oracle.kind==='application')expected=applicationOracle(oracle,run.asOf,actor);
    else if(oracle.kind==='records')expected=recordOracle(oracle.domain,oracle.query,bindings,actor);
    else if(oracle.kind==='finance_calendar')expected=calendarOracle(oracle.query,actor);
    else if(oracle.kind==='knowledge'||oracle.kind==='mixed'){expected=knowledgeOracle(oracle.book,oracle.terms);if(!expected.sources.length)oracleBlocked='supporting-passage-not-found';}
    else if(oracle.kind==='patient_detail'){
     const id=bindings[oracle.patientRef];if(!id)oracleBlocked='patient-binding-unavailable';
     else expected=inspectSql(`SELECT json_build_object('consultations',(SELECT count(*) FROM app.consultations WHERE patient_id=${literal(id)}::uuid),'closed',(SELECT count(*) FROM app.consultations WHERE patient_id=${literal(id)}::uuid AND status='closed'),'notes',(SELECT count(*) FROM app.clinical_notes WHERE patient_id=${literal(id)}::uuid));`)[0];
    }
    oracleBlocked??=missingDataPrerequisite(oracle,expected);
   }catch(error){oracleBlocked=error?.code??'oracle-unavailable';}
   if(oracleBlocked){rows.push({id:spec.id,category:spec.category,verdict:'NOT RUN',failure:oracleBlocked,signature:semanticSignature(spec)});await persist();continue;}
   const currentPatient=spec.contextPatient===true||['patient_detail','mixed'].includes(spec.oracle.kind)||!!spec.oracle.query?.patientRef?bindings[spec.oracle.patientRef??spec.oracle.query?.patientRef??'primary']:null;
   const port=api.alexaDb(actor);
   let faultUsed=false;
   const underlying={rpc:async(name,args)=>{
    if(!faultUsed&&['database_failure','timeout','malformed_result'].includes(spec.fault)){faultUsed=true;return spec.fault==='malformed_result'?{ok:true,data:[{unexpected:true}]}:{ok:false,error:{code:'indisponible',message:'Lecture indisponible.',technical:spec.fault==='timeout'?'57014':'XX000'}};}
    return port.rpc(name,args);
   }};
   const caseAbort=new AbortController(),forbidden=()=>caseAbort.abort(new Error('EvaluationWriteForbidden'));
   const db=readOnlyPort(underlying,q=>queries.push(q),forbidden);
   const sql=readOnlyPort(api.clientSql(actor),q=>queries.push(q),forbidden);
   try{
    await api.runAlexa({text:spec.question,conversationId:randomUUID(),clientTurnId:randomUUID(),appContext:{patientId:currentPatient,page:currentPatient?'/patients/'+currentPatient:'/jarvis'}},{actor,db,knowledge:sql,native:true,agentAsOf:run.asOf,agentObserve:call=>calls.push(call),agentInfer:async(messages,options)=>{
     if(['model_unavailable','model_timeout'].includes(spec.fault)){faultUsed=true;throw new Error(spec.fault==='model_timeout'?'LocalModelTimeout':'LocalModelUnavailable');}
     const t=performance.now();try{const value=await api.inferLocalCompletion(messages,options);inferences.push({ms:performance.now()-t,tokensIn:value.tokensIn,tokensOut:value.tokensOut});return value;}catch(e){inferences.push({ms:performance.now()-t,code:e?.message?.startsWith('LocalModel')?e.message:e.name});throw e;}
    }},e=>events.push(e),AbortSignal.any([caseAbort.signal,AbortSignal.timeout(api.ALEXA_NATIVE_DEADLINE_MS)]));
    const done=events.findLast(e=>e.type==='done'),sentences=events.filter(e=>e.type==='sentence'),answer=sentences.map(e=>e.text).join(' '),failures=[];
    if(!done)failures.push('terminal-missing');
    if(queries.some(q=>q.forbidden))failures.push('write-blocked');
    if(spec.fault&&!faultUsed)failures.push('fault-not-exercised');
    if(expected?.total!==undefined&&['patients','records'].includes(spec.oracle.kind)){
     const reads=queries.filter(q=>q.name===(spec.oracle.kind==='patients'?'search_patients':'query_alexa_records'));
     const matching=reads.find(q=>{let s;try{s=JSON.parse(q.args.p_spec);}catch{return false;}
      if(spec.oracle.kind==='patients')return JSON.stringify(queryMeaning(s))===JSON.stringify(queryMeaning(spec.oracle.query));
      return recordReadMatches(q,spec.oracle,bindings);});
     if(!matching)failures.push('constraint-preservation');
     const data=rpcValue(matching?.response?.data);if(data?.total!==expected.total)failures.push('independent-count');
     if(expected.pendingDzd!==undefined&&(data?.totals?.pendingDzd!==expected.pendingDzd||data?.totals?.collectedDzd!==expected.collectedDzd))failures.push('independent-amounts');
     if(expected.unpriced!==undefined&&data?.totals?.unpriced!==expected.unpriced)failures.push('independent-unpriced-count');
     if(spec.oracle.kind==='records'&&!recordMembershipMatches(data,expected,spec.oracle.query))failures.push('independent-membership');
     if(spec.oracle.kind==='patients'&&spec.oracle.query.mode==='list'&&Array.isArray(data?.rows)){const expectedIds=expected.ids.slice(0,20);if(hash(data.rows.map(r=>r.id))!==hash(expectedIds))failures.push('independent-membership');}
     if(spec.oracle.kind==='records'&&spec.oracle.domain==='finance'&&spec.oracle.query.mode==='list'){
      const page=expected.payments?.slice(0,20);
      if(!financialRowsMatch(data?.rows,page))failures.push('independent-payment-associations');
      if(!financialPresentationMatches(answer,page,{...expected,dateAxis:spec.oracle.query.state==='collected'?'collected_at':'created_at'}))failures.push('payment-members-not-presented');
      const presented=sentences.flatMap(e=>e.sources??[]).filter(s=>s.provenance?.paymentId).map(s=>[s.provenance.paymentId,s.id]);
      if(!page||hash(presented)!==hash(page.map(p=>[p.id,p.patientId])))failures.push('payment-evidence-association');
      if(expected.total>20&&!new RegExp('(?:^|\\D)1\\s*[–-]\\s*20\\s*/\\s*'+expected.total+'(?:\\D|$)').test(answer))failures.push('payment-page-not-disclosed');
     }
     if(spec.oracle.query.mode==='first'&&!firstAppointmentPresented(sentences.map(e=>e.text).join('\n'),sentences.flatMap(e=>e.sources??[]),expected,run.asOf))failures.push('independent-first-appointment');
     if(!['totals','first'].includes(spec.oracle.query.mode)&&!answer.match(new RegExp('(?:^|\\D)'+expected.total+'(?:\\D|$)'))&&!(expected.total===0&&/aucun|aucune|0\b/iu.test(answer)))failures.push('verified-count-in-answer');
     if(spec.oracle.query.mode==='totals'&&expected.amount!==undefined&&!financialTotalsMatch(answer,{...expected,dateAxis:spec.oracle.query.state==='collected'?'collected_at':'created_at'}))failures.push('verified-amount-in-answer');
    }
    if(spec.oracle.kind==='finance_calendar'&&expected){
     const read=queries.find(q=>q.name==='get_finance_overview'&&q.args.p_period_start===expected.du&&q.args.p_period_end===expected.au);
     if(!read||!calls.some(c=>c.name==='query_finance'&&c.args.mode==='calendar'))failures.push('calendar-read-not-grounded');
     if(!calendarDataMatches(rpcValue(read?.response?.data),expected))failures.push('independent-daily-calendar');
     if(!calendarPresentationMatches(sentences.map(e=>e.text).join('\n'),expected))failures.push('daily-calendar-not-presented');
    }
    if(spec.oracle.kind==='application'&&expected){
     const read=queries.find(q=>q.name===expected.gate&&(expected.gate==='reception_board'?q.args.p_day===expected.day:q.args.p_query===expected.query&&q.args.p_limit===20));
     if(!read)failures.push('application-read-not-grounded');
     const raw=rpcValue(read?.response?.data);
     const allRows=expected.gate==='reception_board'?(expected.queue==='waiting'?raw?.journee?.filter(r=>r.status==='arrived'):raw?.demandes):Array.isArray(read?.response?.data)?read.response.data:[];
     if(expected.gate==='search_medications'){
      if(!Array.isArray(allRows)||allRows.length!==expected.pageSize||new Set(allRows.map(r=>r.id)).size!==allRows.length||allRows.some(r=>!expected.ids.includes(r.id)||r.raw_name!==expected.names[expected.ids.indexOf(r.id)]))failures.push('independent-application-membership');
      if(Array.isArray(allRows)&&allRows.some(r=>!answer.includes(r.raw_name)))failures.push('catalogue-name-not-presented');
     }else if(!Array.isArray(allRows)||hash(allRows.map(r=>r.id).sort())!==hash([...expected.ids].sort()))failures.push('independent-application-membership');
     if(expected.gate==='reception_board'&&!new RegExp('(?:^|\\D)'+expected.total+'(?:\\D|$)').test(answer))failures.push('verified-count-in-answer');
    }
    if(['knowledge','mixed'].includes(spec.oracle.kind)){
     const sources=sentences.flatMap(e=>e.sources??[]).filter(s=>s.type==='knowledge');
     if(!sources.length)failures.push('medical-evidence-missing');
     if(sources.some(s=>/stahl/iu.test(s.label)))failures.push('unfinished-source');
     if(!sentences.some(e=>e.kind==='inference'))failures.push('medical-synthesis-missing');
     if(spec.oracle.kind==='mixed'&&!calls.some(c=>c.name==='get_patient_context'||c.name==='query_consultations'))failures.push('patient-source-missing');
     // Mechanical provenance checks are not a clinical correctness assessment.
     failures.push('clinical-assessment-required');
    }
    if(spec.oracle.kind==='behavior'){
     failures.push(...assessBehavior(spec.oracle,events,queries,!!spec.fault));
    }
    if(spec.oracle.kind==='patient_detail'&&!queries.some(q=>q.name==='get_patient'))failures.push('audited-patient-read-missing');
    if(!answer.trim())failures.push('empty-answer');
    const fullyAssessed=['patients','records','behavior'].includes(spec.oracle.kind)||['application','finance_calendar'].includes(spec.oracle.kind)&&!!expected;
    if(!fullyAssessed&&!failures.includes('clinical-assessment-required'))failures.push('independent-assessment-required');
    const row={id:spec.id,category:spec.category,signature:semanticSignature(spec),verdict:failures.length?'FAIL':'PASS',failures,terminal:done?.status,oracleHash:expected?evidenceHash(expected):null,actualTools:calls.map(c=>c.name),actualGates:queries.map(q=>q.name),answerHash:hash(answer),answerCharacters:answer.length,ms:performance.now()-started,inferences,simulatedFailure:!!spec.fault,readOnly:true};
    rows.push(row);privateRecords.push({id:spec.id,expected,queries,calls,events});
    console.log(JSON.stringify({id:row.id,verdict:row.verdict,failures:row.failures,ms:Math.round(row.ms)}));
   }catch(error){rows.push({id:spec.id,category:spec.category,verdict:'FAIL',failure:error?.message?.startsWith('EvaluationWriteForbidden')?'write-blocked':error?.code??error?.name??'runtime',ms:performance.now()-started});}
   await writeFile(out.replace(/\.json$/u,'')+'.private.json',JSON.stringify(privateRecords));await persist();
  }
 }finally{
  try{await api.releaseLocalModel();}catch{rows.push({id:'model-cleanup',verdict:'FAIL',failure:'model-cleanup-unavailable'});}
  try{await api.fermerPool();}catch{rows.push({id:'database-cleanup',verdict:'FAIL',failure:'database-cleanup-unavailable'});}
  const verified=verifyCampaignState(before,()=>businessSnapshot({auditThrough:mark}),()=>auditChanges(mark));
  run.finishedAt=new Date().toISOString();run.audit=verified.audit;run.beforeHash=hash(before);if(verified.after)run.afterHash=hash(verified.after);run.nonMutation=verified.nonMutation;
  if(verified.failure)rows.push({id:'non-mutation',verdict:verified.nonMutation==='FAIL'?'FAIL':'NOT RUN',failure:verified.failure});
 await persist(true);
 if(rows.filter(r=>r.verdict==='PASS').length!==200||review.accepted!==200||run.nonMutation!=='PASS')process.exitCode=1;
 }
}
