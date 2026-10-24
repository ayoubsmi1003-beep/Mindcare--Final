import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

// This is a campaign guard, not an authorization boundary. SQL/RLS still authorize each read.
export const READ_GATES=new Set(['search_patients','get_patient','get_patient_workspace','get_appointment','get_consultation_analysis','get_alexa_clinical_context','get_alexa_case_summary','get_consultation','get_consultation_payment','get_session_details','get_session_analysis','list_amendments','list_patient_timeline','query_alexa_note_sections','query_alexa_records','get_finance_overview','get_charges_list','get_document','get_editable_document_draft','get_my_cabinet','get_my_profile','get_alexa_office_status','search_knowledge_lexical','search_medications','reception_board','list_day_payments','day_revenue']);
/** @param {(record:unknown)=>void} [observe] */
export function readOnlyPort(port,observe=()=>{},onForbidden=()=>{}){
 return {rpc:async(name,args)=>{
  if(!READ_GATES.has(name)){observe({name,args,forbidden:true});onForbidden();throw Error('EvaluationWriteForbidden:'+name);}
  const start=performance.now();
  try{const response=await port.rpc(name,args);observe({name,args,response,ms:performance.now()-start});return response;}
  catch(error){observe({name,args,error:error?.code??error?.name??'Error',ms:performance.now()-start});throw error;}
 }};
}
function canonical(value,key=''){
 if(Array.isArray(value)){const items=value.map(v=>canonical(v,key==='filterGroups'?'filters':''));return ['filters','filterGroups','sources','conditions'].includes(key)?items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):items;}
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!['question','input','id','patientId','patientRef','expected','answer'].includes(k)).map(k=>[k,canonical(value[k],k)]));
 return value;
}
export const semanticSignature=spec=>createHash('sha256').update(JSON.stringify(canonical(spec.semantics??spec))).digest('hex');
export function assertUnchanged(before,after){if(!isDeepStrictEqual(before,after))throw Error('EvaluationStateChanged');}
export function reviewManifest(manifest,semanticReview){
 if(manifest.cases?.length!==200)throw Error('Exactly200CasesRequired');
 const ids=new Set(),signatures=new Set(),categories={};
 for(const spec of manifest.cases){
  if(!spec.id||ids.has(spec.id)||!spec.question||spec.language!=='fr'||!spec.oracle||!spec.semantics)throw Error('InvalidEvaluationCase');
  ids.add(spec.id);const signature=semanticSignature(spec);if(signatures.has(signature))throw Error('SemanticDuplicate:'+spec.id);signatures.add(signature);
  categories[spec.category]=(categories[spec.category]??0)+1;
 }
 let accepted=0;
 if(semanticReview!==undefined){
  const expectedHash=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  if(semanticReview.manifestSha256!==expectedHash||semanticReview.method!=='independent-semantic-review'||!semanticReview.reviewer?.trim()||semanticReview.cases?.length!==200)throw Error('SemanticReviewDoesNotMatchManifest');
  const seen=new Set();
  for(const row of semanticReview.cases){const spec=manifest.cases.find(c=>c.id===row.id);if(!spec||seen.has(row.id)||row.signature!==semanticSignature(spec)||row.decision!=='accept'||!row.distinction?.trim())throw Error('SemanticReviewCaseIncomplete');seen.add(row.id);}
  accepted=seen.size;
 }
 // Different hashes alone never establish different coverage.
 return {candidates:manifest.cases.length,mechanicallyUnique:signatures.size,semanticReview:accepted===200?'ACCEPTED':'PENDING',accepted,categories};
}
