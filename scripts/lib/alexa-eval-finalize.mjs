import {assertUnchanged} from './alexa-eval-readonly.mjs';

/** A failed final inspection must close the report without claiming non-mutation. */
export function verifyCampaignState(before,inspectAfter,inspectAudit){
 try{
  const after=inspectAfter(),audit=inspectAudit();
  assertUnchanged(before,after);
  if(audit.unexpected) return {nonMutation:'FAIL',audit,failure:'unexpected-audit-mutation'};
  return {nonMutation:'PASS',after,audit};
 }catch(error){
  return {nonMutation:error?.message==='EvaluationStateChanged'?'FAIL':'NOT VERIFIED',failure:error?.message==='EvaluationStateChanged'?'business-state-changed':'final-inspection-unavailable'};
 }
}
