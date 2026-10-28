import {expect,it,vi} from 'vitest';
import {frenchRequestAdmission,frenchReadArgumentBindings,requestedReadTool} from '@/shared/alexa/request-contract';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const patientId='22222222-2222-4222-8222-222222222222';
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null},tokensIn:1,tokensOut:1});
it.each([
 ['Prépare un brouillon de certificat médical pour le patient sélectionné.','create_editable_document_draft','certificat_medical'],
 ['Prépare un certificat de bonne santé mentale pour Ayoub Salmi.','create_editable_document_draft','bonne_sante_mentale'],
 ['Propose un rendez-vous pour Ayoub Salmi.','create_appointment',undefined],
])('requires a proposal outcome for a supported preparation: %s',(text,action,documentType)=>{const admission=frenchRequestAdmission(text,false);expect(admission.tools).toEqual(['prepare_action']);expect(frenchReadArgumentBindings(admission,'prepare_action')).toEqual({action,...(documentType?{documentType}:{})});expect(requestedReadTool(text,text)).toBe('prepare_action');});
it('keeps an administrative review list in the read gate',()=>expect(requestedReadTool('Prépare les corrections pour revue.','Identifie les dossiers administratifs incomplets et prépare les corrections pour revue.')).toBe('query_patients'));
it('blocks an unrelated population read before publishing the actual proposal',async()=>{
 const text='Prépare un brouillon de certificat médical pour le patient sélectionné.';let step=0;const seen:string[]=[];
 const execute=vi.fn(async(c:{id:string;name:string;args:Record<string,unknown>})=>({callId:c.id,status:'ok' as const,complete:true,text:'Proposition pour confirmation',evidence:[],conditionKeys:[],proposal:{tool:'create_editable_document_draft' as const,args:{patientId,documentType:'certificat_medical'}}}));
 const result=await runAgentLoop({text,conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{actor:'prep',execute,infer:async(messages)=>{seen.push(...messages.filter(m=>m.role==='tool').map(m=>m.content));step++;if(step===1)return call('bad','query_patients',{partIds:['requested_1'],mode:'count'});return call('p','prepare_action',{partIds:['requested_1'],action:'create_editable_document_draft',documentType:'certificat_medical'});}},new AbortController().signal);
 expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'prepare_action',args:{action:'create_editable_document_draft',documentType:'certificat_medical'}});expect(result.status).toBe('needs_confirmation');expect(result.parts[0]?.status).toBe('proposed');expect(result.proposal?.tool).toBe('create_editable_document_draft');expect(seen.some(s=>s.includes('32'))).toBe(false);expect(result.sentences.join(' ')).not.toContain('population');
});
