import {z} from 'zod';

const destination=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('patient'),id:z.uuid()}).strict(),
 z.object({kind:z.literal('document'),id:z.uuid()}).strict(),
 z.object({kind:z.literal('draft'),id:z.uuid()}).strict(),
 z.object({kind:z.literal('consultation'),id:z.uuid()}).strict(),
]);
export const answerLinkSchema=z.object({start:z.number().int().nonnegative(),end:z.number().int().positive(),label:z.string().min(1).max(1000),target:destination}).strict();
export type AlexaAnswerLink=z.infer<typeof answerLinkSchema>;
export interface AlexaAnswerBlock {text:string;links?:AlexaAnswerLink[]}
export function validAnswerLinks(text:string,value:unknown):value is AlexaAnswerLink[]{
 const parsed=z.array(answerLinkSchema).max(100).safeParse(value);
 if(!parsed.success)return false;
 let end=0;
 for(const link of parsed.data){
  if(link.start<end||link.end>text.length||text.slice(link.start,link.end)!==link.label)return false;
  end=link.end;
 }
 return true;
}
export function answerLinkPath(target:AlexaAnswerLink['target']):string{
 const id=encodeURIComponent(target.id);
 return target.kind==='patient'?`/patients/${id}`:target.kind==='consultation'?`/consultation/${id}`:`/documents?${target.kind==='draft'?'draft':'document'}=${id}`;
}
/** Offsets are assembled with verified rows, never inferred by matching names in model prose. */
export function appendLinkedAnswerLine(answer:AlexaAnswerBlock,label:string,suffix:string,target?:AlexaAnswerLink['target']):void{
 const start=answer.text.length+(answer.text?'\n'.length:0);
 answer.text+=(answer.text?'\n':'')+label+suffix;
 if(target&&label.trim())(answer.links??=[]).push({start,end:start+label.length,label,target});
}
