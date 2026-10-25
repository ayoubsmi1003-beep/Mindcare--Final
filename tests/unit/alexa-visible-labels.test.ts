import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fixture from '../fixtures/alexa-visible-labels.json';
import {appendLinkedAnswerLine,answerLinkPath,validAnswerLinks,type AlexaAnswerBlock} from '@/shared/alexa/answer-links';
import {AlexaAnswerText} from '@/components/AlexaAnswerText';
import {readAlexaHistory} from '@/shared/alexa/history';
import {presentAgentResults} from '@/server/alexa/answer-presentation';
import {agentExecutor} from '@/server/alexa/agent-tools';
import {scriptedAlexaRpc} from '../helpers/alexa-rpc';

it.each(['agenda','documents'] as const)('assembles clickable %s rows from the authorized executor response',async domain=>{
 const patient=fixture.patients[0]!,doc=fixture.documents[0]!,row={id:doc.id,patientId:patient.id,label:domain==='agenda'?patient.label:`${patient.label} — ${doc.title} — ${doc.number}`,at:'2026-10-24T09:00:00+01:00',status:domain==='agenda'?'confirmed':'issued',amount:null};
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:25,rows:[row],totals:{},complete:true,offset:0}]}));
 const input={text:domain==='agenda'?'Affiche les rendez-vous du 24 octobre 2026.':'Liste les documents.',conversationId:crypto.randomUUID(),clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}};
 const result=await agentExecutor(input,{rpc},{rpc:vi.fn()})({id:'visible',name:domain==='agenda'?'query_agenda':'query_documents',args:{partIds:['p'],...(domain==='agenda'?{from:'2026-10-24T00:00:00+01:00',to:'2026-10-25T00:00:00+01:00'}:{})}},'2026-10-24T12:00:00+01:00',[],new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.text).toContain(patient.label);expect(result.text).toContain('1–1 / 25');
 expect(validAnswerLinks(result.text,result.links)).toBe(true);expect(answerLinkPath(result.links![0]!.target)).toBe(domain==='agenda'?patient.href:doc.href);
});

it('keeps homonymous patient labels bound to distinct verified destinations',()=>{
 const answer:AlexaAnswerBlock={text:'2 résultats'};
 for(const patient of fixture.patients)appendLinkedAnswerLine(answer,'Même NOM',' — détail',{kind:'patient',id:patient.id});
 expect(validAnswerLinks(answer.text,answer.links)).toBe(true);
 expect(answer.links?.map(link=>answerLinkPath(link.target))).toEqual(fixture.patients.map(patient=>`/patients/${patient.id}`));
 const html=renderToStaticMarkup(createElement(AlexaAnswerText,{text:answer.text,blocks:[answer]}));
 for(const patient of fixture.patients)expect(html).toContain(`/patients/${patient.id}`);
 expect(html).not.toContain('Patient-');
});
it('lists actual patient names for an authorized missing-CNI read instead of patient IDs',async()=>{
 const patient=fixture.patients[0]!,condition={field:'identity_card',op:'missing',value:null},asOf='2026-10-25T12:00:00.000Z';
 const row={id:patient.id,first_name:'Amina',last_name:'Meziane',missing:['identity_card'],completed_consultations:3,outstanding_balance:null};
 const rpc=scriptedAlexaRpc(async()=>({ok:true as const,data:[{total:25,rows:[row],metrics:{},unknownAge:0,revision:'c'.repeat(32),asOf,conditions:[condition],complete:true,offset:0}]}));
 const text='Quels patients sont sans CNI ? Donne leurs noms.';
 const execute=agentExecutor({text,conversationId:'named-missing-cni-list',clientTurnId:crypto.randomUUID(),appContext:{patientId:null,page:'/jarvis'}},{rpc},{rpc:vi.fn()});
 const result=await execute({id:'patients',name:'query_patients',args:{partIds:['patients'],mode:'list',filters:[condition],population:'active',limit:20,offset:0}},asOf,[],new AbortController().signal);
 expect(result.status).toBe('ok');expect(result.text).toContain('Amina Meziane');expect(result.text).not.toContain('Patient-');expect(result.text).not.toContain(patient.id);
 expect(result.evidence).toContainEqual(expect.objectContaining({id:patient.id,type:'patient',label:'Amina Meziane'}));
 expect(validAnswerLinks(result.text,result.links)).toBe(true);expect(answerLinkPath(result.links![0]!.target)).toBe(patient.href);
});
it('links issued references and unnumbered drafts without inventing a number',()=>{
 const answer:AlexaAnswerBlock={text:'2 documents'};
 for(const doc of fixture.documents)appendLinkedAnswerLine(answer,[doc.title,doc.number].filter(Boolean).join(' — '),'',{kind:doc.status==='draft'?'draft':'document',id:doc.id});
 expect(answer.links?.map(link=>answerLinkPath(link.target))).toEqual(fixture.documents.map(doc=>doc.href));
 expect(answer.text.match(/DOC-/gu)).toHaveLength(1);
});
it('rejects stale, overlapping, out of range or arbitrary URL links and escapes text',()=>{
 const answer:AlexaAnswerBlock={text:'Lecture'};appendLinkedAnswerLine(answer,'<script>','',{kind:'patient',id:fixture.patients[0]!.id});
 expect(validAnswerLinks(answer.text,answer.links)).toBe(true);
 expect(validAnswerLinks(answer.text,[{...answer.links![0],start:0}])).toBe(false);
 expect(validAnswerLinks(answer.text,[answer.links![0],answer.links![0]])).toBe(false);
 expect(validAnswerLinks(answer.text,[{...answer.links![0],target:{kind:'patient',id:'javascript:alert(1)'}}])).toBe(false);
 const html=renderToStaticMarkup(createElement(AlexaAnswerText,{text:answer.text,blocks:[answer]}));
 expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
 expect(renderToStaticMarkup(createElement(AlexaAnswerText,{text:'Contexte modifié',blocks:[answer]}))).not.toContain('href=');
});
it('restores validated optional links from persisted SSE evidence',()=>{
 const block:AlexaAnswerBlock={text:'Résultats'};appendLinkedAnswerLine(block,'Nom FICTIF','',{kind:'patient',id:fixture.patients[0]!.id});
 const restored=readAlexaHistory({version:1,events:[{type:'sentence',...block,sources:[]},{type:'done',status:'completed',parts:[],patientId:null}]});
 expect(restored.alexaBlocks).toEqual([block]);
 expect(readAlexaHistory({version:1,events:[{type:'sentence',...block,links:[{...block.links![0],end:9999}],sources:[]},{type:'done',status:'completed',parts:[],patientId:null}]}).alexaBlocks).toBeUndefined();
});
it('preserves list rows even when the question says affiche instead of liste',()=>{
 const block:AlexaAnswerBlock={text:'Résultats'};appendLinkedAnswerLine(block,'Nom FICTIF','',{kind:'patient',id:fixture.patients[0]!.id});
 expect(presentAgentResults([{...block,callId:'c',status:'ok',complete:true,evidence:[],conditionKeys:[]}],'Affiche les patients.')).toEqual([block.text]);
});
