import {isDeepStrictEqual} from 'node:util';

function subset(actual,expected){if(expected&&typeof expected==="object"){if(!actual||typeof actual!=="object")return false;return Object.entries(expected).every(([key,value])=>subset(actual[key],value));}return actual===expected;}
function readArgs(args){return Object.fromEntries(Object.entries(args??{}).map(([key,value])=>{if(key!=="p_spec"||typeof value!=="string")return [key,value];try{return [key,JSON.parse(value)];}catch{return [key,null];}}));}
function rpcValue(query,required){
 if(query.response?.ok!==true||!Array.isArray(query.response.data)||!Array.isArray(required.path)||!Object.hasOwn(required,'equals'))return {found:false};
 let value=query.response.data;
 if(value.length===1){value=value[0];if(value&&typeof value==='object'&&Object.hasOwn(value,query.name))value=value[query.name];}
 for(const key of required.path){if(typeof key!=='string'||value===null||typeof value!=='object'||!Object.hasOwn(value,key))return {found:false};value=value[key];}
 if(required.pluck!==undefined){
  if(typeof required.pluck!=='string'||!Array.isArray(value)||!value.every(row=>row!==null&&typeof row==='object'&&Object.hasOwn(row,required.pluck)))return {found:false};
  value=value.map(row=>row[required.pluck]);
 }
 return {found:true,value};
}
const sourceMatches=(source,required)=>!!required&&typeof required.type==='string'&&source?.type===required.type&&(required.id===undefined||source.id===required.id)&&(required.provenance===undefined||subset(source.provenance,required.provenance));
const escapeRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function fieldMatches(sentence,required){
 if(sentence.kind!=='fact'||typeof required.label!=='string'||!required.label.trim()||!['string','number','boolean'].includes(typeof required.value))return false;
 const sources=sentence.sources??[],source=required.source;
 if(!sources.some(actual=>sourceMatches(actual,source)))return false;
 // Une attribution multiple ne permet pas de relier le champ à un patient précis.
 if(source.id!==undefined&&sources.some(actual=>actual.type===source.type&&actual.id!==source.id))return false;
 const value=String(required.value);if(!value)return false;
 const labels=new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(required.label)}(?![\\p{L}\\p{N}_])[\\t \\u00a0]*(?::|=|–|—|-)?[\\t \\u00a0]*`,'giu');
 for(const match of sentence.text.matchAll(labels)){
  const after=sentence.text.slice(match.index+match[0].length);
  if(after.startsWith(value)&&!/^([\p{L}\p{N}_]|[.,]\d)/u.test(after.slice(value.length)))return true;
 }
 return false;
}
const key=c=>`${c.field}:${c.op}:${JSON.stringify(c.value)}`;
const metricPatterns={active:/actif|active|نشط|النشط/iu,missing_identity_card:/identit|identity|card|هوية|الهوي|وثيقة/iu,children:/enfant|child|mineur|minor|أطفال|طفل|قاصر/iu,unknown_age:/inconnu|unknown|renseign|غير معروف|غير مسجل/iu,not_seen_6m:/six|6|month|mois|ستة|أشهر|اشهر/iu};
const outputPatterns={tomorrow_agenda:/(?:rendez|agenda|appointment|موعد|مواعيد)/iu,administrative_gaps:/(?:administrati|إداري|إدارية|اداري)/iu,missing_fields:/(?:champ|missing.field|حقول|الناقص)/iu,review_corrections:/(?:revue|review|correction|تصحيح|مراجع)/iu,consultations:/(?:consult|استشار)/iu,finance:/(?:encaiss|financ|revenu|مالي|تحصيل|مداخيل|إيراد|ايراد|مدفوع)/iu};
const matchCondition=(p,k)=>k==='missing_identity_card'?p.conditions?.some(c=>c.field==='identity_card'&&c.op==='missing'):k==='children'?p.conditions?.some(c=>c.field==='age'&&c.op==='lt'&&c.value===18):k==='not_seen_6m'?p.conditions?.some(c=>c.field==='no_completed_months'&&c.value===6):false;
export function evaluateAlexaCase(spec,record){
 const done=record.events.findLast(e=>e.type==='done'),parts=done?.parts??[],sentences=record.events.filter(e=>e.type==='sentence'),text=sentences.map(e=>e.text).join('\n');
 const calls=record.calls.filter(c=>c.name!=='declare_request'),permitted=new Set(spec.permittedToolSequence.flat());
 const failures=[],outcomes=[];const check=(condition,label)=>{if(!condition)failures.push(label);};
 check(!!done,'terminal event');check(record.ms<=spec.timing.deadlineMs+2000,'request deadline');
 const validCalls=record.calls.filter(c=>c.valid).length,allowedCalls=record.calls.filter(c=>permitted.has(c.name)).length;
 check(allowedCalls===record.calls.length,'tool selection');check(validCalls===record.calls.length,'first-attempt argument validity');
 const expected=spec.expected;
 const qualification={sourceSets:'NOT RUN',proposal:'NOT RUN',authoritativeResults:'NOT RUN',sourceRefs:'NOT RUN',responseFields:'NOT RUN',privacy:'NOT RUN',voice:'NOT RUN',manual:'NOT RUN'};
 const strictCheck=(requirements,key,label,matches)=>{
  let correct=0;for(const required of requirements??[]){const valid=matches(required);if(valid)correct++;check(valid,label(required));}
  qualification[key]=requirements?.length?(correct===requirements.length?'PASS':'FAIL'):'NOT RUN';
 };
 strictCheck(expected.rpcResults,'authoritativeResults',required=>`authoritative RPC result: ${required.name} ${(required.path??[]).join('.')}`,required=>record.queries.some(query=>{
  if(query.name!==required.name||!subset(readArgs(query.args),required.args??{}))return false;
  const actual=rpcValue(query,required);return actual.found&&isDeepStrictEqual(actual.value,required.equals);
 }));
 strictCheck(expected.sourceRefs,'sourceRefs',required=>`emitted source: ${required.type} ${required.id??''}`,required=>sentences.some(sentence=>(sentence.sources??[]).some(source=>sourceMatches(source,required))));
 strictCheck(expected.responseFields,'responseFields',required=>`sourced response field: ${required.label}`,required=>sentences.some(sentence=>fieldMatches(sentence,required)));
 strictCheck(expected.sourceSets,'sourceSets',required=>'exact emitted record set: '+required.type,required=>{const ids=[...new Set(sentences.flatMap(sentence=>sentence.sources??[]).filter(source=>source.type===required.type).map(source=>source.id))];return Array.isArray(required.ids)&&isDeepStrictEqual(ids,required.ids);});
 if(expected.proposal){const proposals=record.events.filter(event=>event.type==='proposal');const exact=proposals.length===1&&subset(proposals[0],expected.proposal);check(exact,'exact action proposal');qualification.proposal=exact?'PASS':'FAIL';}
 for(const required of expected.rpcReads??[])check(record.queries.some(q=>q.name===required.name&&subset(readArgs(q.args),required.args??{})),"required authoritative read: "+required.name);
 for(const required of expected.toolArguments??[])check(record.calls.some(c=>c.name===required.name&&subset(c.args,required.args??{})),"requested tool arguments: "+required.name);
 if(expected.generalAnswer){check(sentences.some(s=>s.sources?.some(source=>source.type==="query"&&source.provenance?.gate==="local_model")),"admitted local general answer provenance");check(record.queries.length===0,"general answer does not query cabinet data");}
 if(expected.requiresEvidence)check(sentences.some(s=>s.sources?.some(source=>source.type==="knowledge")),"approved medical reference evidence");
 if(expected.status)check(done?.status===expected.status,'terminal state');
 if(expected.permissionErrorRequired)check(parts.some(p=>p.status==='failed')&&/permission|صلاحيات/iu.test(text),'permission failure explicit');
 if(expected.noInventedCount)check(!/\b32\b/u.test(text)&&done?.status!=='completed','no invented model-failure answer');
 const normalized=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
 for(const [index,alternatives] of (expected.responseConcepts??[]).entries())check(alternatives.some(value=>normalized(text).includes(normalized(value))),'expected explanatory concept '+(index+1));
 const number=n=>new RegExp(`(?<![0-9])${n}(?![0-9])`,'u').test(text);
 if(expected.count!==undefined)check(number(expected.count),'exact count visible');
 for(const n of expected.counts??[])check(number(n),`verified answer ${n}`);
 for(const [metric,n] of Object.entries(expected.metrics??{})){
  const lines=text.split('\n');check(lines.some(line=>metricPatterns[metric]?.test(line)&&new RegExp(`(?<![0-9])${n}(?![0-9])`,'u').test(line)),`metric ${metric}=${n}`);
 }
 for(const value of expected.textIncludes??[])check(text.includes(value),`recorded value ${value}`);
 const patientIds=[...new Set(sentences.flatMap(e=>e.sources??[]).filter(s=>s.type==='patient').map(s=>s.id))];
 if(expected.patientNumbers&&spec.scenario===22)check(JSON.stringify(patientIds)===JSON.stringify(expected.patientNumbers.map(n=>'ed000000-0000-4000-8000-'+String(n).padStart(12,'0'))),'exact patient set and order');
 let preserved=0;const executedPatientSpecs=record.queries.filter(q=>q.name==='search_patients'&&q.args?.p_spec).map(q=>readArgs(q.args).p_spec).filter(value=>value&&typeof value==='object');
 if(expected.patientModes)check(executedPatientSpecs.length>0&&executedPatientSpecs.every(q=>expected.patientModes.includes(q.mode)),'requested patient operation');
 if(expected.exactParts!==undefined)check(parts.length===expected.exactParts,'exact requested output count');
 if(expected.noPatientRecords)check(patientIds.length===0,'count-only response omits patient records');
 for(const predicate of spec.expectedManifest.filters){const found=executedPatientSpecs.some(q=>q.filters?.some(c=>key(c)===key(predicate)));if(found)preserved++;else failures.push('missing material filter '+key(predicate));}
 if(spec.expectedManifest.filters.length)check(executedPatientSpecs.some(q=>spec.expectedManifest.filters.every(predicate=>q.filters?.some(c=>key(c)===key(predicate)))),'all compound predicates in one query');
 if(expected.sort)check(executedPatientSpecs.some(q=>q.sort===expected.sort),'requested sort');
 if(expected.noBusinessWrite||expected.maxBusinessEffects!==undefined)check(!record.queries.some(q=>/^(?:execute_jarvis_action|create_editable_document_draft|issue_document|record_payment_collected)$/.test(q.name)),'no unconfirmed business effect');
 const expectedParts=spec.expectedManifest.requiredParts;
 const used=new Set();for(const name of expectedParts){
  const part=parts.find(p=>!used.has(p.id)&&(metricPatterns[name]?(matchCondition(p,name)||metricPatterns[name].test(p.goal)):name==='unsupported_email'?/mail|électron|الكترون|إلكترون/iu.test(p.goal+' '+(p.reason??'')):outputPatterns[name]?.test(p.goal)??false));
  if(part){used.add(part.id);outcomes.push({name,id:part.id,status:part.status,accounted:part.status!=='pending'&&(part.resultRefs?.length>0||!!part.reason||part.status==='cancelled')});}
  else if(![21,23,24,25].includes(spec.scenario)&&parts.length>=expectedParts.length){const next=parts.find(p=>!used.has(p.id));if(next){used.add(next.id);outcomes.push({name,id:next.id,status:next.status,accounted:next.status!=='pending'&&(next.resultRefs?.length>0||!!next.reason||next.status==='cancelled')});}}
 }
 const identified=outcomes.length,accounted=outcomes.filter(o=>o.accounted).length;
 const expectedConditions=Object.entries(spec.expectedManifest.partConditions??{});let preservedPartConditions=0;
 for(const [name,conditions] of expectedConditions){
  const part=parts.find(p=>p.id===outcomes.find(o=>o.name===name)?.id);
  const actual=(part?.conditions??[]).map(key).sort(),wanted=conditions.map(key).sort();
  const correct=!!part&&JSON.stringify(actual)===JSON.stringify(wanted);
  if(correct)preservedPartConditions++;check(correct,'requested conditions preserved: '+name);
 }
 if([21,23,24,25].includes(spec.scenario)||expected.completenessGate){check(identified===expectedParts.length,'independently expected parts identified');check(accounted===expectedParts.length,'every requested part has an outcome');}
 if(expected.verifiedAnswers)check(parts.filter(p=>p.status==='answered').length===expected.verifiedAnswers,'successful independent answers survive');
 if(expected.unsupportedParts?.length)check(expected.unsupportedParts.every(name=>outcomes.some(o=>o.name===name&&(o.status==='unsupported'||o.status==='needs_input'))),'unsupported outcome explicit');
 const unsupportedSuccess=done?.status==='completed'&&(parts.some(p=>p.status!=='answered')||expected.permissionErrorRequired||expected.noInventedCount);
 check(!unsupportedSuccess,'no unsupported success claim');
 if(expected.reviewOnly){
  check(done?.status==='completed'&&outcomes.length===expectedParts.length&&outcomes.every(o=>o.status==='answered'),'supported administrative workflow completed');
  const ids=[...(expected.agendaPatientIds??(expected.patientNumbers??[]).map(n=>'ed000000-0000-4000-8000-'+String(n).padStart(12,'0')))].sort();
  const findings=[...(expected.findingPatientIds??ids)].sort();
  check(executedPatientSpecs.some(q=>q.mode==='review'&&JSON.stringify([...(q.patientIds??[])].sort())===JSON.stringify(ids)),'administrative review scoped to agenda patients');
  check(JSON.stringify([...patientIds].sort())===JSON.stringify(findings),'administrative findings linked to expected patients');
  check(new Set(sentences.flatMap(e=>e.sources??[]).filter(s=>s.type==='appointment').map(s=>s.id)).size===expected.agendaCount,'authoritative agenda records returned');
  check(/aucune correction n.a été enregistrée/iu.test(text),'review distinguishes proposed corrections from saved changes');
 }
 if(expected.fault?.tool&&['database','timeout'].includes(expected.fault.kind))check((record.faults??[]).some(f=>f.tool===expected.fault.tool&&f.kind===expected.fault.kind&&f.code===(f.kind==='timeout'?'57014':'22012')),'expected database fault actually exercised');
 const correctnessFailures=failures.filter(label=>label!=='request deadline');
 const requestBudgetMs=Number.isFinite(record.requestBudgetMs)&&record.requestBudgetMs>0?record.requestBudgetMs:spec.timing.deadlineMs;
 const correctness={status:correctnessFailures.length?'FAIL':'PASS',failures:correctnessFailures};
 const timing={legacyTargetMs:spec.timing.deadlineMs,requestBudgetMs,ms:record.ms,legacyTargetStatus:record.ms<=spec.timing.deadlineMs+2000?'PASS':'FAIL',requestBudgetStatus:record.ms<=requestBudgetMs+2000?'PASS':'FAIL'};
 return {correctness,timing,qualification,id:spec.id,scenario:spec.scenario,language:spec.language,status:failures.length?'FAIL':'PASS',failures,metrics:{toolSelection:{correct:allowedCalls,total:record.calls.length},argumentValidity:{correct:validCalls,total:record.calls.length},partIdentification:{correct:identified,total:expectedParts.length},partAccounting:{correct:accounted,total:expectedParts.length},filterPreservation:{correct:preserved+preservedPartConditions,total:spec.expectedManifest.filters.length+expectedConditions.length},unsupportedSuccessClaims:unsupportedSuccess?1:0},outcomes,ms:record.ms};
}
