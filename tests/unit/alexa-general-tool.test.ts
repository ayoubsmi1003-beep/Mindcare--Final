import {it,expect,vi} from 'vitest';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {runAgentLoop} from '@/server/alexa/agent-loop';
vi.mock('@/server/alexa/local-model',()=>({inferLocalCompletion:vi.fn(),inferLocalText:vi.fn(async()=> 'La Lune reste en orbite grâce à la gravité et à sa vitesse.')}));
const id='11111111-1111-4111-8111-111111111111';
const input={text:'Pourquoi la Lune tourne autour de la Terre ?',conversationId:'general-tool',clientTurnId:id,appContext:{patientId:null,page:'/jarvis'}};
it('uses a separate admitted local general answer without a database read',async()=>{
 const rpc=vi.fn();const r=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'g',name:'answer_general',args:{partIds:['g'],question:input.text}},'2026-10-15T12:00:00Z',[],new AbortController().signal);
 expect(r).toMatchObject({complete:true});expect(r.text).toContain('Réponse générale');expect(r.text).toContain('gravité');expect(rpc).not.toHaveBeenCalled();
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
