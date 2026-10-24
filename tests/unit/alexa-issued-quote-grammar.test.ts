import {expect,it} from 'vitest';
import {indexedKnowledgeAnswerSchema,resolveIndexedKnowledgeAnswer} from '@/shared/alexa/knowledge-answer';
import {issuedQuoteChoices} from '@/server/alexa/knowledge-evidence-content';
it('uses the same single-evidence bound for a simple medication claim in generation and validation',()=>{
 const choices=[{index:1,quotes:['Une première preuve synthétique complète.','Une autre preuve synthétique complète.']}];
 const answer={coverage:'partial',sentences:[{text:'Une affirmation fictive.',evidence:[{index:1,quoteId:'q1'},{index:1,quoteId:'q2'}]}]};
 expect(indexedKnowledgeAnswerSchema(choices,1).safeParse(answer).success).toBe(false);
 expect(()=>resolveIndexedKnowledgeAnswer(answer,choices,1)).toThrow();
 expect(indexedKnowledgeAnswerSchema(choices).safeParse(answer).success).toBe(true);
});
it('binds short quote references to exact issued text and its own evidence index',()=>{
 const first='Premier passage synthétique complet.',second='Second passage synthétique complet.';
 const choices=[{index:1,quotes:[first]},{index:2,quotes:[second,first]}],schema=indexedKnowledgeAnswerSchema(choices);
 const answer=(index:number,quoteId:string)=>({coverage:'supported',sentences:[{text:'Synthèse fictive.',evidence:[{index,quoteId}]}]});
 expect(schema.safeParse(answer(1,'q1')).success).toBe(true);
 expect(schema.safeParse(answer(1,'q2')).success).toBe(false);
 expect(schema.safeParse(answer(1,'citation inventée')).success).toBe(false);
 expect(resolveIndexedKnowledgeAnswer(answer(2,'q1'),choices).sentences[0]?.evidence[0]).toEqual({index:2,quote:second});
 expect(()=>resolveIndexedKnowledgeAnswer(answer(1,'q2'),choices)).toThrow();
 expect(()=>indexedKnowledgeAnswerSchema([])).toThrow('KnowledgeQuoteChoicesRequired');
});
it('offers complete sentences once and declines an overlong indivisible sentence',()=>{
 const first='Une première phrase documentaire complète.',second='Une seconde phrase documentaire complète.';
 expect(issuedQuoteChoices(first+'\n'+second,'fr')).toEqual([first,second]);
 expect(issuedQuoteChoices('documentaire '.repeat(150)+'.','fr')).toEqual([]);
 const main='Synthetic medicine information is documented here.';
 expect(issuedQuoteChoices(main+' Avoid in pregnancy.','en')).toEqual([main+' Avoid in pregnancy.']);
 expect(issuedQuoteChoices(main+' '+'documentaire '.repeat(150)+'.','en')).toEqual([]);
});
it('admits only eligible references without renumbering the complete source context',()=>{
 const choices=[{index:1,quotes:['Other medication: synthetic information.','Requested medication: synthetic information.'],allowedQuoteIds:['q2']}];
 const answer=(quoteId:string)=>({coverage:'supported',sentences:[{text:'Synthèse fictive.',evidence:[{index:1,quoteId}]}]});
 expect(indexedKnowledgeAnswerSchema(choices).safeParse(answer('q1')).success).toBe(false);
 expect(resolveIndexedKnowledgeAnswer(answer('q2'),choices).sentences[0]?.evidence[0]?.quote).toBe(choices[0]?.quotes[1]);
});
it('makes insufficient and answered coverage mutually consistent in the native grammar',()=>{
 const schema=indexedKnowledgeAnswerSchema([{index:1,quotes:['Une phrase documentaire synthétique complète.']}]);
 const sentence={text:'Une réponse fictive.',evidence:[{index:1,quoteId:'q1'}]};
 expect(schema.safeParse({coverage:'insufficient',sentences:[]}).success).toBe(true);
 expect(schema.safeParse({coverage:'insufficient',sentences:[sentence]}).success).toBe(false);
 expect(schema.safeParse({coverage:'supported',sentences:[]}).success).toBe(false);
 expect(schema.safeParse({coverage:'partial',sentences:[sentence]}).success).toBe(true);
});
