import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readOnlyPort,semanticSignature,assertUnchanged,reviewManifest,answerContainsCount,bindEvaluationQuestion} from '../../scripts/lib/alexa-eval-readonly.mjs';
import manifest from '../eval/alexa-fr-200-cases.json';
import manifest100 from '../eval/alexa-fr-100-cases.json';
it('does not present two hundred different hashes as two hundred semantically accepted cases',()=>{
 expect(reviewManifest(manifest)).toMatchObject({candidates:200,mechanicallyUnique:200,semanticReview:'PENDING',accepted:0});
});
it('accepts an explicitly sized 100-question campaign without weakening semantic deduplication',()=>{
 const cases=Array.from({length:100},(_,index)=>({id:`fr-${String(index+1).padStart(3,'0')}`,question:`Question ${index+1}`,language:'fr',category:'patients',oracle:{kind:'patients',query:{mode:'count',filters:[{field:'age',op:'gte',value:index+18}]}},semantics:{intent:'count',domain:'patients',minimumAge:index+18}}));
 expect(reviewManifest({targetCaseCount:100,cases})).toMatchObject({candidates:100,expectedCaseCount:100,mechanicallyUnique:100,semanticReview:'PENDING',accepted:0});
});
it('accepts the reviewed 100-case French Alexa campaign with distinct app, mixed, and MiniCPM coverage',()=>{
 const receipt=JSON.parse(readFileSync(new URL('../eval/alexa-fr-100-cases.semantic-review.json',import.meta.url),'utf8'));
 expect(reviewManifest(manifest100,receipt)).toMatchObject({candidates:100,expectedCaseCount:100,mechanicallyUnique:100,semanticReview:'SECOND_PASS_ACCEPTED',accepted:100,reviewMethod:'structured-secondary-pass',reviewer:'Codex same-agent structured secondary pass'});
 expect(manifest100.cases.filter(spec=>spec.question.includes('[PATIENT_NAME]'))).toHaveLength(4);
 expect(manifest100.cases.filter(spec=>spec.category==='llm')).toHaveLength(5);
 expect(manifest100.cases.some(spec=>/DSM|Taylor/iu.test(spec.question))).toBe(false);
});
it('labels a same-agent second semantic pass without claiming an external reviewer',()=>{
 const candidate={id:'fr-001',question:'Combien de patients adultes ?',language:'fr',category:'patients',oracle:{kind:'patients',query:{mode:'count',filters:[{field:'age',op:'gte',value:18}]}},semantics:{intent:'count',domain:'patients',minimumAge:18}};
 const manifest={targetCaseCount:1,cases:[candidate]},receipt={manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),method:'structured-secondary-pass',reviewer:'Codex same-agent secondary pass',cases:[{id:candidate.id,signature:semanticSignature(candidate),decision:'accept',distinction:'Population adulte; seuil minimum inclusif de 18 ans.'}]};
 expect(reviewManifest(manifest,receipt)).toMatchObject({semanticReview:'SECOND_PASS_ACCEPTED',accepted:1,reviewMethod:'structured-secondary-pass',reviewer:'Codex same-agent secondary pass'});
});
it('rejects a review receipt from another manifest before running cases',()=>{
 expect(()=>reviewManifest(manifest,{manifestSha256:'another-version',method:'independent-semantic-review',reviewer:'Synthetic reviewer',cases:[]})).toThrow('SemanticReviewDoesNotMatchManifest');
});
import {verifyCampaignState} from '../../scripts/lib/alexa-eval-finalize.mjs';
it('closes an unavailable final inspection without a false non-mutation pass',()=>{
 expect(verifyCampaignState({},()=>{throw Error('private SQL content');},()=>({unexpected:0}))).toEqual({nonMutation:'NOT VERIFIED',failure:'final-inspection-unavailable'});
 expect(verifyCampaignState({count:1},()=>({count:2}),()=>({unexpected:0})).nonMutation).toBe('FAIL');
 expect(verifyCampaignState({count:1},()=>({count:1}),()=>({unexpected:1})).nonMutation).toBe('FAIL');
 expect(verifyCampaignState({count:1},()=>({count:1}),()=>({unexpected:0})).nonMutation).toBe('PASS');
});
it('blocks writes before reaching the application adapter on either RPC path',async()=>{
 let reached=0;const port=readOnlyPort({rpc:async()=>{reached++;return {ok:true,data:[]};}});
 await expect(port.rpc('execute_jarvis_action',{})).rejects.toThrow('EvaluationWriteForbidden');
 await expect(port.rpc('save_alexa_case_summary',{})).rejects.toThrow('EvaluationWriteForbidden');
 await expect(port.rpc('unknown_reader',{})).rejects.toThrow('EvaluationWriteForbidden');
 expect(reached).toBe(0);
 await port.rpc('get_patient',{p_id:'local'});expect(reached).toBe(1);
 await port.rpc('get_active_document_template',{p_type:'certificat_medical'});expect(reached).toBe(2);
 await port.rpc('list_agenda',{p_day:'2026-10-27'});expect(reached).toBe(3);
});
it('observes and aborts a forbidden attempt even if application code catches the guard error',async()=>{
 const observed:unknown[]=[],abort=new AbortController();let reached=0;
 const port=readOnlyPort({rpc:async()=>{reached++;return {ok:true,data:[]};}},record=>observed.push(record),()=>abort.abort());
 try{await port.rpc('confirm_jarvis_action',{});}catch{/* The application may turn this into a limitation. */}
 expect(abort.signal.aborted).toBe(true);expect(reached).toBe(0);expect(observed).toEqual([{name:'confirm_jarvis_action',args:{},forbidden:true}]);
});
it('counts semantic query differences rather than cosmetic wording',()=>{
 const a={domain:'patients',intent:'count',filters:[{field:'age',op:'gte',value:18},{field:'phone',op:'missing',value:null}],question:'Question A'};
 expect(semanticSignature(a)).toBe(semanticSignature({...a,question:'Question B',filters:[...a.filters].reverse()}));
 expect(semanticSignature(a)).not.toBe(semanticSignature({...a,dateAxis:'ended_at'}));
 expect(semanticSignature({filterGroups:[a.filters]})).toBe(semanticSignature({filterGroups:[[...a.filters].reverse()]}));
});
it('matches French grouped counts without accepting a different adjacent number',()=>{
 expect(answerContainsCount('J’ai trouvé 1\u202f558 patients.',1558)).toBe(true);
 expect(answerContainsCount('J’ai trouvé 1 558 patients.',1558)).toBe(true);
 expect(answerContainsCount('J’ai trouvé 1558 patients.',1558)).toBe(true);
 expect(answerContainsCount('J’ai trouvé 15\u202f580 patients.',1558)).toBe(false);
});
it('binds a named-patient fixture locally and refuses unresolved name tokens',()=>{
 expect(bindEvaluationQuestion('Quel est le numéro de téléphone de [PATIENT_NAME] ?',{primaryName:'Amel Bensaid'})).toBe('Quel est le numéro de téléphone de Amel Bensaid ?');
 expect(bindEvaluationQuestion('Bonjour Alexa, que peux-tu lire ?',{})).toBe('Bonjour Alexa, que peux-tu lire ?');
 expect(()=>bindEvaluationQuestion('Résume la dernière consultation de [PATIENT_NAME].',{})).toThrow('PatientQuestionBindingUnavailable');
});
it('fails on content changes even when row counts are unchanged',()=>{
 expect(()=>assertUnchanged({patients:{count:2,hash:'a'}},{patients:{count:2,hash:'b'}})).toThrow('EvaluationStateChanged');
 expect(()=>assertUnchanged({patients:{count:2,hash:'a'}},{patients:{count:2,hash:'a'}})).not.toThrow();
});
