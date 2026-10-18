import {frenchRequestAdmission} from '@/shared/alexa/request-contract';
import {it,expect,vi} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion,LocalTextOptions} from '@/server/alexa/local-model-protocol';
const input={text:'Quel est le chiffre d’affaires de ce mois ?',conversationId:'domain',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}};
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1});
it.each(['Quel est le chiffre d’affaires de ce mois ?','Donne les recettes de la semaine.','Quel est le total des dépenses ?','Affiche la répartition des charges.'])('blocks a patient-count substitution for the explicit financial request: %s',async text=>{
 let step=0;const execute=vi.fn(async()=>({callId:'bad',status:'ok' as const,complete:true,text:'32 patients',data:{total:32},evidence:[],conditionKeys:[]}));
 const r=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'domain',execute,infer:async()=>step++===0?call('decl','declare_request',{parts:[{id:'p',goal:'Patients',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('bad','query_patients',{partIds:['p'],mode:'count'})},new AbortController().signal);
 expect(execute).not.toHaveBeenCalled();expect(r.status).not.toBe('completed');expect(r.sentences.join(' ')).not.toContain('32 patients');
});
it('projects the admitted general-domain enum before native selection without granting a database read',async()=>{
 let options:LocalTextOptions|undefined;await runAgentLoop({...input,text:'Pourquoi les objets tombent-ils vers le sol ?',conversationId:crypto.randomUUID()},{actor:'domain',infer:async(_m,o)=>{options=o;throw Error('Capture only');},execute:vi.fn()},new AbortController().signal);
 const raw=JSON.stringify(options?.tools);expect(raw).toContain('answer_general');expect(raw).not.toContain('query_patients');
});
it('projects an administrative profile read without note-only arguments for a simple selected-patient field question',async()=>{
 const options:LocalTextOptions[]=[];let step=0;const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Téléphone : 0000000001',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop({...input,text:'Quel est le téléphone du patient sélectionné ?',conversationId:crypto.randomUUID(),appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/22222222-2222-4222-8222-222222222222'}},{actor:'domain',infer:async(_m,o)=>{options.push(o);if(step++===0)return call('d','declare_request',{parts:[{id:'p',goal:'Téléphone',tool:'get_patient_context',conditions:[],dependsOn:[]}]});return call('read','get_patient_context',{partIds:['p']});},execute},new AbortController().signal);
 const tool=options[1]?.tools?.find(t=>t.function.name==='get_patient_context');expect(tool?.function.parameters['properties']).not.toHaveProperty('section');expect(result.status).toBe('completed');expect(execute.mock.calls[0]?.[0]).toMatchObject({args:{section:'profile'}});expect(tool?.function.parameters['properties']).not.toHaveProperty('status');
});
it('keeps clinical and administrative mixed requests open instead of pruning material note filters',async()=>{
 const options:LocalTextOptions[]=[];let step=0;await runAgentLoop({...input,text:'Quel est son téléphone et lis les notes signées de septembre.',conversationId:crypto.randomUUID()},{actor:'domain',infer:async(_m,o)=>{options.push(o);if(step++===0)return call('d','declare_request',{parts:[{id:'p',goal:'Dossier',tool:'get_patient_context',conditions:[],dependsOn:[]}]});throw Error('Capture only');},execute:vi.fn()},new AbortController().signal);
 const tool=options[1]?.tools?.find(t=>t.function.name==='get_patient_context');expect(tool?.function.parameters['properties']).toHaveProperty('status');expect(tool?.function.parameters['properties']).toHaveProperty('from');
});

it.each(['Pourquoi mes reçus ne s’affichent-ils pas ?','Pourquoi MindCare ralentit ?','Pourquoi la caisse est vide ?','Pourquoi ce résultat diffère de la semaine passée ?'])('does not turn an application/context question into admitted public knowledge: %s',text=>{expect(frenchRequestAdmission(text,true).tools).not.toEqual(['answer_general']);});
it.each(['Compare les revenus et les rendez-vous de demain.','Que dit le DSM sur le stress lié aux revenus ?','Montre les impayés et les traitements.'])('does not close the catalogue on a mixed-domain request: %s',text=>{expect(frenchRequestAdmission(text,false).tools).toBeUndefined();});

it('preserves cabinet-contact and finance as separate requested domains',()=>{expect(frenchRequestAdmission('Donne les recettes du mois et le téléphone du cabinet.',false).tools).toBeUndefined();});
it('keeps historical reads when combined with an administrative field',()=>{expect(frenchRequestAdmission('Quel est son téléphone et son historique ?',false).profileOnly).toBe(false);});
it('does not interpret electrical charges as financial charges',()=>{expect(frenchRequestAdmission('Pourquoi les charges électriques s’attirent-elles ?',true).tools).toEqual(['answer_general']);});

it('offers the independently detected four-output cardinality before native metadata generation',async()=>{
 let options:LocalTextOptions|undefined;await runAgentLoop({...input,text:'Combien de patients actifs, combien sans identité, combien d’enfants et combien jamais vus en consultation ?',conversationId:crypto.randomUUID()},{actor:'counts',execute:vi.fn(),infer:async(_m,o)=>{options=o;throw Error('Capture only');}},new AbortController().signal);
 const schema=options?.tools?.find(t=>t.function.name==='declare_request')?.function.parameters;expect(schema).toMatchObject({properties:{parts:{minItems:4,maxItems:4}}});
});
it('offers one coherent metrics call for independent named counts on the same active population',async()=>{
 const options:LocalTextOptions[]=[];let step=0;const conditions=[[],['identity_card:missing'],['age:lt:18'],['no_completed_months:eq:6']];
 await runAgentLoop({...input,text:'Combien de patients actifs, combien sans identité, combien d’enfants et combien sans consultation terminée depuis six mois ?',conversationId:crypto.randomUUID()},{actor:'counts',execute:vi.fn(),infer:async(_m,o)=>{options.push(o);if(step++===0)return call('d','declare_request',{parts:conditions.map((c,i)=>({id:'p'+i,goal:'Nombre',tool:'query_patients',conditions:c,dependsOn:[]}))});throw Error('Capture only');}},new AbortController().signal);
 const schema=options[1]?.tools?.find(t=>t.function.name==='query_patients')?.function.parameters;expect(schema).toMatchObject({properties:{mode:{enum:['metrics']},metrics:{minItems:4,maxItems:4,items:{enum:['active','missing_identity_card','children','not_seen_6m']}},partIds:{minItems:4,maxItems:4}}});
});

it.each(['Quels patients sont actifs ?','Quel est le téléphone du patient sélectionné ?','Pourquoi les patients ont-ils changé de traitement ?'])('blocks an unrequested count as the final answer: %s',async text=>{
 let step=0;const execute=vi.fn(async()=>({callId:'bad',status:'ok' as const,complete:true,text:'32 patients',conditionKeys:[],evidence:[]}));
 await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'operation',execute,infer:async()=>step++===0?call('d','declare_request',{parts:[{id:'p',goal:'Patients',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('bad','query_patients',{partIds:['p'],mode:'count'})},new AbortController().signal);expect(execute).not.toHaveBeenCalled();
});
it('keeps irrelevant patient-tool instructions out of a positively admitted public request',async()=>{
 let prompt='';await runAgentLoop({...input,text:'Pourquoi le ciel est bleu ?',conversationId:crypto.randomUUID()},{actor:'context',execute:vi.fn(),infer:async(m)=>{prompt=m[0]!.content??'';throw Error('Capture only');}},new AbortController().signal);expect(prompt).toContain('answer_general');expect(prompt).not.toContain('query_patients');
});
it('does not offer no-tool metadata for an explicit supported finance request',async()=>{
 let options:LocalTextOptions|undefined;await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'context',execute:vi.fn(),infer:async(_m,o)=>{options=o;throw Error('Capture only');}},new AbortController().signal);
 const raw=JSON.stringify(options?.tools);expect(raw).toContain('query_finance');expect(raw).not.toContain('"none"');
});

it('does not offer a clarification escape for an already admitted complete public question',async()=>{
 const options:LocalTextOptions[]=[];let step=0;await runAgentLoop({...input,text:'Pourquoi la Lune tourne autour de la Terre ?',conversationId:crypto.randomUUID()},{actor:'public',execute:vi.fn(),infer:async(_m,o)=>{options.push(o);if(step++===0)return call('d','declare_request',{parts:[{id:'p',goal:'Question générale',tool:'answer_general',conditions:[],dependsOn:[]}]});throw Error('Capture only');}},new AbortController().signal);
 expect(JSON.stringify(options[0]?.tools)).not.toContain('ask_doctor');expect(options[1]?.tools?.some(t=>t.function.name==='ask_doctor')).toBe(false);
});
it('rejects a model-only request to repeat a complete admitted public question',async()=>{
 const execute=vi.fn();const r=await runAgentLoop({...input,text:'Pourquoi le ciel est bleu ?',conversationId:crypto.randomUUID()},{actor:'public',execute,infer:async()=>call('d','declare_request',{parts:[{id:'p',goal:'Question',tool:'ask_doctor',conditions:[],dependsOn:[]}]})},new AbortController().signal);expect(execute).not.toHaveBeenCalled();expect(r.parts.every(p=>!p.tools?.includes('ask_doctor'))).toBe(true);
});

it('requires an explicit finance view and recovers without dispatching a default payment list',async()=>{
 let step=0;const execute=vi.fn(async(c:{id:string;args:Record<string,unknown>})=>({callId:c.id,status:'ok' as const,complete:true,text:'Encaissements : 1000 DZD',evidence:[],conditionKeys:[]}));
 const r=await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'finance-view',execute,infer:async()=>{if(step++===0)return call('d','declare_request',{parts:[{id:'p',goal:input.text,tool:'query_finance',conditions:[],dependsOn:[]}]});return call('f'+step,'query_finance',{partIds:['p'],period:'ce mois',...(step>2?{mode:'overview'}:{})});}},new AbortController().signal);
 expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0].args['mode']).toBe('overview');expect(r.status).toBe('completed');
});
