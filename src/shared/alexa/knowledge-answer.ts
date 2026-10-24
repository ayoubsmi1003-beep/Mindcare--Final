import { z } from "zod";

/** One contract for provider constraints and local validation. */
export const knowledgeAnswerSchema = z.object({
  coverage: z.enum(["supported", "partial", "insufficient"]),
  sentences: z.array(z.object({
    text: z.string().min(1).max(1600),
    evidence: z.array(z.object({
      index: z.number().int().min(1).max(5),
      quote: z.string().min(20).max(1200),
    }).strict()).min(1).max(5),
  }).strict()).max(5),
}).strict();

export const knowledgeAnswerJsonSchema = z.toJSONSchema(knowledgeAnswerSchema, { target: "draft-7" });
export interface IssuedQuoteChoices {readonly index:number;readonly quotes:readonly string[];readonly allowedQuoteIds?:readonly string[]}
/** The model chooses bounded references; the server restores the exact issued text. */
export function indexedKnowledgeAnswerSchema(choices:readonly IssuedQuoteChoices[],maxEvidence:1|5=5){
 const variants=choices.flatMap(c=>{
  if(!Number.isInteger(c.index)||c.index<1||c.index>5||c.quotes.some(q=>q.length<20||q.length>1200))throw Error('InvalidKnowledgeQuoteChoices');
  const allIds=c.quotes.map((_,index)=>'q'+(index+1));
  if(c.allowedQuoteIds?.some(id=>!allIds.includes(id)))throw Error('InvalidKnowledgeQuoteChoices');
  const ids=c.allowedQuoteIds??allIds;
  return ids.length?[z.object({index:z.literal(c.index),quoteId:z.enum(ids)}).strict()]:[];
 });
 if(!variants.length)throw Error('KnowledgeQuoteChoicesRequired');
 const evidence=variants.length===1?variants[0]!:z.union(variants);
 const sentence=knowledgeAnswerSchema.shape.sentences.element.extend({evidence:z.array(evidence).min(1).max(maxEvidence)});
 return z.union([
  knowledgeAnswerSchema.extend({coverage:z.enum(['supported','partial']),sentences:z.array(sentence).min(1).max(5)}),
  knowledgeAnswerSchema.extend({coverage:z.literal('insufficient'),sentences:z.array(sentence).max(0)}),
 ]);
}
export function resolveIndexedKnowledgeAnswer(value:unknown,choices:readonly IssuedQuoteChoices[],maxEvidence:1|5=5){
 const answer=indexedKnowledgeAnswerSchema(choices,maxEvidence).parse(value),byIndex=new Map(choices.map(row=>[row.index,row.quotes]));
 return knowledgeAnswerSchema.parse({...answer,sentences:answer.sentences.map(sentence=>({...sentence,evidence:sentence.evidence.map(reference=>({index:reference.index,quote:byIndex.get(reference.index)![Number(reference.quoteId.slice(1))-1]}))}))});
}
export type LlmOutputContract = "alexa-knowledge-v1";
