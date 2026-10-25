import {it,expect,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import {inferNativeGeneralAlexa} from '@/server/alexa/model-gateway';
import {inferLocalText} from '@/server/alexa/local-model';
vi.mock('@/server/alexa/local-model',()=>({inferLocalCompletion:vi.fn(),inferLocalText:vi.fn(async()=> 'La Lune reste en orbite grâce à la gravité et à sa vitesse.')}));
const id='11111111-1111-4111-8111-111111111111';
const input={text:'Pourquoi la Lune tourne autour de la Terre ?',conversationId:'general-tool',clientTurnId:id,appContext:{patientId:null,page:'/jarvis'}};
it('answers a supported public fact from the local reference without running a model or database query',async()=>{
 vi.mocked(inferLocalText).mockClear();
 const result=await inferNativeGeneralAlexa(input.text,new AbortController().signal);
 expect(result).toMatchObject({ok:true,model:null,reference:{id:'moon-orbit',label:'NASA — How Orbits Work'}});
 if(result.ok){expect(result.text).toContain('gravité');expect(result.text).toContain('vitesse');}
 expect(inferLocalText).not.toHaveBeenCalled();
});
it('uses a local source to explain the processor, program instructions and data',async()=>{
 vi.mocked(inferLocalText).mockClear();
 const result=await inferNativeGeneralAlexa('Comment fonctionne un ordinateur ?',new AbortController().signal);
 expect(result).toMatchObject({ok:true,model:null,reference:{id:'computer'}});
 if(result.ok){expect(result.text).toContain('processeur');expect(result.text).toContain('instructions');expect(result.text).toContain('données');}
 expect(inferLocalText).not.toHaveBeenCalled();
});
it.each([
 ['Pourquoi le jour et la nuit se succèdent-ils ?','day-night','tourne sur son axe'],
 ['Pourquoi la glace flotte-t-elle sur l’eau ?','ice-density','moins dense'],
 ['Quelle est la différence entre un son aigu et un son grave ?','sound-pitch','fréquence'],
])('uses a verified local fact for the public question %s',async(question,sourceId,phrase)=>{
 vi.mocked(inferLocalText).mockClear();const rpc=vi.fn();
 const result=await agentExecutor({...input,text:question},{rpc},{rpc:vi.fn()})({id:'g',name:'answer_general',args:{partIds:['g'],question}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(result).toMatchObject({status:'ok',complete:true});expect(result.text).toContain(phrase);
 expect(result.evidence).toContainEqual(expect.objectContaining({type:'query',provenance:expect.objectContaining({gate:'local_public_fact',sourceId})}));
 expect(rpc).not.toHaveBeenCalled();expect(inferLocalText).not.toHaveBeenCalled();
});
it('retains MiniCPM for a safe public question with no verified local fact',async()=>{
 vi.mocked(inferLocalText).mockClear().mockResolvedValueOnce('La buée se forme lorsque la vapeur d’eau refroidit et se condense.');
 const question='Pourquoi un miroir se couvre-t-il de buée ?',signal=new AbortController().signal;
 const result=await inferNativeGeneralAlexa(question,signal);
 expect(result).toMatchObject({ok:true,model:expect.any(String)});
 expect(vi.mocked(inferLocalText)).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({role:'user',content:question})]),expect.objectContaining({signal}));
});
it('answers a narrowly matched Alexa capability question from the configured capability map',async()=>{
 vi.mocked(inferLocalText).mockClear();const question='Bonjour Alexa, comment peux-tu m’aider au cabinet ?';
 const result=await inferNativeGeneralAlexa(question,new AbortController().signal);
 expect(result).toMatchObject({ok:true,model:null,localSource:'capability'});
 if(result.ok){expect(result.text).toContain('agenda');expect(result.text).toContain('confirmation');}
 expect(inferLocalText).not.toHaveBeenCalled();
 const executed=await agentExecutor({...input,text:question},{rpc:vi.fn()},{rpc:vi.fn()})({id:'g',name:'answer_general',args:{partIds:['g'],question}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(executed.evidence).toContainEqual(expect.objectContaining({type:'query',label:'Capacités configurées dans MindCare',provenance:expect.objectContaining({gate:'alexa_local_contract',sourceId:'capability'})}));
});
it('answers the missing-information policy from the verified Alexa contract, without claiming a database lookup',async()=>{
 vi.mocked(inferLocalText).mockClear();const question='Dis-moi en deux phrases comment tu gères une information absente.';
 const result=await inferNativeGeneralAlexa(question,new AbortController().signal);
 expect(result).toMatchObject({ok:true,model:null,localSource:'missing_information'});
 if(result.ok){expect(result.text).toContain('je ne remplace pas');expect(result.text).toContain('lecture fiable');}
 expect(inferLocalText).not.toHaveBeenCalled();
});
it('fails closed on a mixed-English public answer',async()=>{
 vi.mocked(inferLocalText).mockClear().mockResolvedValueOnce('Un miroir se couvre de vapeur because the temperature falls.').mockResolvedValueOnce('Un miroir se couvre de vapeur because the temperature falls.');
 const result=await inferNativeGeneralAlexa('Pourquoi un miroir se couvre-t-il de buée ?',new AbortController().signal);
 expect(result).toMatchObject({ok:false,code:'invalid-response'});
});
it('shows a short human limitation instead of exposing model internals when both answers are rejected',async()=>{
 const question='Pourquoi un miroir se couvre-t-il de buée ?';
 vi.mocked(inferLocalText).mockClear().mockResolvedValue('La réponse mentionne un dossier patient.');
 const execute=agentExecutor({...input,text:question},{rpc:vi.fn()},{rpc:vi.fn()});
 const result=await execute({id:'g',name:'answer_general',args:{partIds:['g'],question}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(result.status).toBe('error');expect(result.complete).toBe(false);
 expect(result.text).toContain('Je n’ai pas de réponse fiable');expect(result.text).not.toContain('MiniCPM');
 expect(vi.mocked(inferLocalText)).toHaveBeenCalledTimes(2);
});
it('retries a rejected public answer from the original question only',async()=>{
 const question='Pourquoi un miroir se couvre-t-il de buée ?',rejected='La réponse mentionne un agenda et ne convient pas.';
 vi.mocked(inferLocalText).mockClear().mockResolvedValueOnce(rejected).mockResolvedValueOnce('La buée se forme lorsque la vapeur d’eau refroidit et se condense.');
 const result=await inferNativeGeneralAlexa(question,new AbortController().signal);
 expect(result).toMatchObject({ok:true,model:expect.any(String)});expect(vi.mocked(inferLocalText)).toHaveBeenCalledTimes(2);
 expect(vi.mocked(inferLocalText).mock.calls[1]![0]).toEqual([expect.objectContaining({role:'system'}),{role:'user',content:question}]);
 expect(JSON.stringify(vi.mocked(inferLocalText).mock.calls[1])).not.toContain(rejected);
});
it('rejects mixed English in a generated answer and retries once in French',async()=>{
 const question='Pourquoi les listes de contrôle réduisent-elles les erreurs dans une procédure répétitive ?';
 vi.mocked(inferLocalText).mockClear().mockResolvedValueOnce('Les lists de contrôle offrent des checks et limitent les mistakes.').mockResolvedValueOnce('Une liste de vérification rappelle les étapes importantes et réduit les oublis.');
 const result=await inferNativeGeneralAlexa(question,new AbortController().signal);
 expect(result).toMatchObject({ok:true,model:expect.any(String)});expect(vi.mocked(inferLocalText)).toHaveBeenCalledTimes(2);
});
it('uses a separate admitted local general answer without a database read',async()=>{
 vi.mocked(inferLocalText).mockClear();
 const rpc=vi.fn();const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'g',name:'answer_general',args:{partIds:['g'],question:input.text}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(r).toMatchObject({complete:true});expect(r.text).toContain('gravité');expect(r.text).toContain('vitesse');expect(r.evidence).toContainEqual(expect.objectContaining({type:'query',provenance:expect.objectContaining({gate:'local_public_fact',sourceId:'moon-orbit'})}));expect(rpc).not.toHaveBeenCalled();expect(inferLocalText).not.toHaveBeenCalled();
});
it.each(['Quel est le chiffre d’affaires ?','Quels sont les impayés ?','Quel diagnostic est enregistré ?','Combien de patients actifs ?'])('cannot replace an application/clinical answer with general prose: %s',async question=>{
 const rpc=vi.fn();const r=await agentExecutor({...input,text:question},{rpc},{rpc:vi.fn()})({id:'g',name:'answer_general',args:{partIds:['g'],question}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(r.complete).toBe(false);expect(r.text).not.toContain('gravité');expect(rpc).not.toHaveBeenCalled();
});
it('refuses an invented general question not asked by the doctor',async()=>{
 const r=await agentExecutor(input,{rpc:vi.fn()},{rpc:vi.fn()})({id:'g',name:'answer_general',args:{partIds:['g'],question:'Pourquoi les avions volent ?'}},'2026-10-15T12:00:00Z',[],new AbortController().signal);expect(r.complete).toBe(false);
});
it('does not publish a general answer that bypassed its admitted tool',async()=>{
 let i=0;const decl={kind:'calls' as const,calls:[{id:'d',name:'declare_request',args:{parts:[{id:'g',goal:'Question',tool:'none',conditions:[],dependsOn:[]}]}}],message:{role:'assistant' as const,content:null,tool_calls:[{id:'d',type:'function' as const,function:{name:'declare_request',arguments:'{}'}}]},tokensIn:1,tokensOut:1};
 const r=await runAgentLoop({...input,text:'Quel est le chiffre d’affaires ?'},{actor:'general-bypass',infer:async()=>i++===0?decl:{kind:'answer',text:'9999 DZD',tokensIn:1,tokensOut:1},execute:vi.fn()},new AbortController().signal);
 expect(r.status).not.toBe('completed');expect(r.sentences.join(' ')).not.toContain('9999');
});
