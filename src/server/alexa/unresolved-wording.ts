/** How an unanswered part of a request is worded for the doctor (agent-loop.ts, orchestrator.ts). */
const foldWords=(value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[’‘ʼ]/gu,"'").replace(/\s+/gu," ").trim();
const words=(value:string)=>` ${foldWords(value).replace(/[^\p{L}\p{N}'-]+/gu," ").trim()} `;
/** Whether a part's goal is the doctor's own whole words ("son traitement"), not a goal the local model wrote ("list of medical records"). */
export function goalInDoctorsWords(goal:string,request:string):boolean{
  return foldWords(goal).length>0&&words(request).includes(words(goal));
}
/** The goal a part is shown with: the doctor's own words, or the doctor's whole question when the model wrote the goal. */
export function shownGoal(goal:string,request:string):string{
  return goalInDoctorsWords(goal,request)?goal:request;
}
/**
 * A part left unanswered, as the doctor reads it: the reason alone when the part IS the request (repeating the question back is
 * noise), "goal — reason" only to tell several parts apart, and only in the doctor's own words.
 */
export function unresolvedPartSentence(part:{goal:string;reason?:string},partCount:number,request:string):string{
  const reason=part.reason??"";
  return partCount>1&&goalInDoctorsWords(part.goal,request)&&foldWords(part.goal)!==foldWords(request)?`${part.goal} — ${reason}`:reason;
}
/**
 * The model may list conditions it cannot apply. Only the doctor's own words are repeated to the doctor: a token the model
 * produced itself ("email:missing" copied from its instructions, an invented identifier) is an internal code, never shown.
 */
export function withDoctorsWords(sentence:string,conditions:readonly string[],request:string):string{
  const said=foldWords(request),shown=conditions.filter(condition=>condition.trim().length>2&&said.includes(foldWords(condition)));
  return shown.length?`${sentence} ${shown.join(", ")}`:sentence;
}
