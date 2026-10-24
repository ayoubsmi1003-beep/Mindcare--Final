import {expect,it} from 'vitest';
import {readOnlyPort,semanticSignature,assertUnchanged,reviewManifest} from '../../scripts/lib/alexa-eval-readonly.mjs';
import manifest from '../eval/alexa-fr-200-cases.json';
it('does not present two hundred different hashes as two hundred semantically accepted cases',()=>{
 expect(reviewManifest(manifest)).toMatchObject({candidates:200,mechanicallyUnique:200,semanticReview:'PENDING',accepted:0});
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
it('fails on content changes even when row counts are unchanged',()=>{
 expect(()=>assertUnchanged({patients:{count:2,hash:'a'}},{patients:{count:2,hash:'b'}})).toThrow('EvaluationStateChanged');
 expect(()=>assertUnchanged({patients:{count:2,hash:'a'}},{patients:{count:2,hash:'a'}})).not.toThrow();
});
