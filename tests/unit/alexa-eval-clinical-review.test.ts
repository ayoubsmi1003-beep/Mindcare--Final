import {expect,it} from 'vitest';
import {applyClinicalReview,reviewDigest} from '../../scripts/lib/alexa-eval-clinical-review.mjs';
import {semanticSignature} from '../../scripts/lib/alexa-eval-readonly.mjs';
const spec={id:'synthetic-book',question:'Question synthétique',oracle:{kind:'knowledge'},semantics:{intent:'explain'}};
const manifest={cases:[spec]},signature=semanticSignature(spec);
const source={chunkId:'synthetic-chunk',sourceVersion:'v1',textSha256:'synthetic-hash'};
const oracle={id:spec.id,questionSha256:reviewDigest(spec.question,false),signature,evidence:[source],required:[{id:'meaning'}]};
const oracles={cases:[oracle]};
const report={status:'PARTIAL',run:{nonMutation:'PASS',manifestSha256:reviewDigest(manifest),review:{accepted:0}},rows:[{id:spec.id,signature,answerHash:'exact-answer',failures:['clinical-assessment-required'],verdict:'FAIL'}]};
const receipt=()=>({method:'independent-passage-answer-review',reviewer:'Independent synthetic reviewer',reportSha256:reviewDigest(report),oracleSha256:reviewDigest(oracles),cases:[{id:spec.id,answerHash:'exact-answer',decision:'accept',wholeAnswerReviewed:true,forbiddenChecked:true,requiredChecks:[{id:'meaning',passed:true}],sourceChecks:[{...source,assertionsSupported:true}]}]});
it('records an independent answer review without turning a partial campaign into qualification',()=>{
 const reviewed=applyClinicalReview(report,manifest,oracles,receipt());
 expect(reviewed.rows[0]).toMatchObject({verdict:'PASS',failures:[]});
 expect(reviewed.status).toBe('PARTIAL');expect(report.rows[0]!.verdict).toBe('FAIL');
});
it('refuses stale answers, changed passages and an incomplete assertion review',()=>{
 for(const change of [
  (r:ReturnType<typeof receipt>)=>{r.cases[0]!.answerHash='stale';},
  (r:ReturnType<typeof receipt>)=>{r.cases[0]!.sourceChecks[0]!.textSha256='changed';},
  (r:ReturnType<typeof receipt>)=>{r.cases[0]!.requiredChecks=[];},
  (r:ReturnType<typeof receipt>)=>{r.cases[0]!.wholeAnswerReviewed=false;},
 ]){const r=receipt();change(r);expect(()=>applyClinicalReview(report,manifest,oracles,r)).toThrow();}
});
it('preserves unrelated failures and refuses absent non-mutation evidence',()=>{
 const failed=structuredClone(report);failed.rows[0]!.failures.push('quantity');
 const r=receipt();r.reportSha256=reviewDigest(failed);
 expect(applyClinicalReview(failed,manifest,oracles,r).rows[0]).toMatchObject({verdict:'FAIL',failures:['quantity']});
 failed.run.nonMutation='NOT VERIFIED';r.reportSha256=reviewDigest(failed);
 expect(()=>applyClinicalReview(failed,manifest,oracles,r)).toThrow('ClinicalReviewNeedsNonMutationProof');
});
it('does not use a book review to qualify patient facts in a mixed question',()=>{
 const mixed=structuredClone(manifest);mixed.cases[0]!.oracle.kind='mixed';
 const changed=structuredClone(report);changed.run.manifestSha256=reviewDigest(mixed);
 const r=receipt();r.reportSha256=reviewDigest(changed);
 expect(()=>applyClinicalReview(changed,mixed,oracles,r)).toThrow('ClinicalReviewBookCaseRequired');
});
