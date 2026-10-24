import {createHash} from 'node:crypto';
import {semanticSignature} from './alexa-eval-readonly.mjs';

export const reviewDigest=(value,json=true)=>createHash('sha256').update(json?JSON.stringify(value):value).digest('hex');
const requireReview=(condition,code)=>{if(!condition)throw Error(code);};

/** Incorporates a separate review of an exact recorded answer, never a model self-score. */
export function applyClinicalReview(report,manifest,oracles,receipt){
 requireReview(report.run.nonMutation==='PASS','ClinicalReviewNeedsNonMutationProof');
 requireReview(receipt.method==='independent-passage-answer-review'&&receipt.reviewer?.trim(),'IndependentClinicalReviewerRequired');
 requireReview(receipt.reportSha256===reviewDigest(report)&&receipt.oracleSha256===reviewDigest(oracles)&&report.run.manifestSha256===reviewDigest(manifest),'ClinicalReviewArtifactMismatch');
 requireReview(Array.isArray(receipt.cases)&&receipt.cases.length>0,'ClinicalReviewCasesRequired');
 const reviewed=structuredClone(report),seen=new Set();
 for(const item of receipt.cases){
  const row=reviewed.rows.find(r=>r.id===item.id),spec=manifest.cases.find(c=>c.id===item.id),oracle=oracles.cases.find(c=>c.id===item.id);
  requireReview(row&&spec&&oracle&&!seen.has(item.id),'ClinicalReviewCaseMismatch');seen.add(item.id);
  requireReview(spec.oracle.kind==='knowledge','ClinicalReviewBookCaseRequired');
  requireReview(row.signature===semanticSignature(spec)&&oracle.signature===row.signature&&oracle.questionSha256===reviewDigest(spec.question,false),'ClinicalReviewQuestionMismatch');
  requireReview(row.answerHash===item.answerHash&&row.failures?.includes('clinical-assessment-required'),'ClinicalReviewAnswerMismatch');
  requireReview(['accept','reject'].includes(item.decision)&&item.wholeAnswerReviewed===true&&item.forbiddenChecked===true,'ClinicalReviewIncomplete');
  requireReview(Array.isArray(item.sourceChecks)&&item.sourceChecks.length>0&&item.sourceChecks.every(s=>oracle.evidence.some(e=>e.chunkId===s.chunkId&&e.sourceVersion===s.sourceVersion&&e.textSha256===s.textSha256)),'ClinicalReviewPassageMismatch');
  if(item.decision==='accept'){
   requireReview(oracle.required.every(required=>item.requiredChecks?.some(check=>check.id===required.id&&check.passed===true))&&item.sourceChecks.every(s=>s.assertionsSupported===true),'ClinicalReviewAssertionsIncomplete');
   row.failures=row.failures.filter(f=>f!=='clinical-assessment-required');
  }else{
   requireReview(Array.isArray(item.reasons)&&item.reasons.length>0,'ClinicalReviewRejectionReasonRequired');
   row.failures.push('independent-clinical-review-rejected');
  }
  row.verdict=row.failures.length?'FAIL':'PASS';
  row.clinicalReview={decision:item.decision,reviewer:receipt.reviewer,receiptSha256:reviewDigest(receipt)};
 }
 reviewed.tally=reviewed.rows.reduce((totals,row)=>(totals[row.verdict]=(totals[row.verdict]??0)+1,totals),{});
 reviewed.status=reviewed.tally.PASS===200&&reviewed.rows.length===200&&reviewed.run.review.accepted===200?'PASS':'PARTIAL';
 reviewed.clinicalReview={originalReportSha256:reviewDigest(report),oracleSha256:reviewDigest(oracles),receiptSha256:reviewDigest(receipt)};
 return reviewed;
}

export async function reviewRecordedCampaign(argv=process.argv.slice(2)){
 const {readFile,writeFile}=await import('node:fs/promises');
 const arg=name=>{const i=argv.indexOf(name);if(i<0||!argv[i+1])throw Error('ClinicalReviewArgumentRequired');return argv[i+1];};
 const load=async name=>JSON.parse(await readFile(arg(name),'utf8'));
 const [report,manifest,oracles,receipt]=await Promise.all(['--review-report','--manifest','--clinical-oracles','--clinical-review'].map(load));
 const result=applyClinicalReview(report,manifest,oracles,receipt);
 // Exclusive creation preserves the original run and any previous review.
 await writeFile(arg('--out'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:result.status,tally:result.tally,reviewed:receipt.cases.length,nonMutation:result.run.nonMutation}));
 if(result.status!=='PASS')process.exitCode=1;
}
