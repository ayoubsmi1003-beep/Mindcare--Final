import {frenchRequestAdmission,frenchRequestedOutputs,requestedReadTool,frenchPatientCompoundContract} from '@/shared/alexa/request-contract';
import {it,expect,vi} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion,LocalTextOptions} from '@/server/alexa/local-model-protocol';
const input={text:'Quel est le chiffre d’affaires de ce mois ?',conversationId:'domain',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}};
it('recognizes every supported predicate in the approved French compound-patient query',()=>{
 const text='Trouve les adultes ayant au moins trois consultations terminées, un solde restant dû positif et aucune consultation terminée depuis 90 jours. Donne le nombre, la liste et trie par solde décroissant.';
 const contract=frenchPatientCompoundContract(text);expect(contract).toMatchObject({count:true,sort:'outstanding_desc'});expect(contract?.conditions).toHaveLength(4);expect(contract?.conditions).toEqual(expect.arrayContaining([{field:'age',op:'gte',value:18},{field:'completed_consultations',op:'gte',value:3},{field:'outstanding_balance',op:'gt',value:0},{field:'no_completed_days',op:'eq',value:90}]));
});
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1});
it.each(['Quel est le chiffre d’affaires de ce mois ?','Donne les recettes de la semaine.','Quel est le total des dépenses ?','Affiche la répartition des charges.'])('blocks a patient-count substitution for the explicit financial request: %s',async text=>{
 let step=0;const execute=vi.fn(async()=>({callId:'bad',status:'ok' as const,complete:true,text:'32 patients',data:{total:32},evidence:[],conditionKeys:[]}));
 const r=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'domain',execute,infer:async()=>step++===0?call('decl','declare_request',{parts:[{id:'p',goal:'Patients',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('bad','query_patients',{partIds:['p'],mode:'count'})},new AbortController().signal);
 expect(execute).not.toHaveBeenCalled();expect(r.status).not.toBe('completed');expect(r.sentences.join(' ')).not.toContain('32 patients');
});
it('dispatches an admitted public question through the local-answer gate without a database read',async()=>{
 const text='Pourquoi les objets tombent-ils vers le sol ?',execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[{id:c.id,type:'query',label:'Réponse générale',provenance:{gate:'local_model',provider:'local'}}],conditionKeys:[]})),infer=vi.fn();
 const result=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'domain',infer,execute},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general',args:{question:text}});expect(result.status).toBe('completed');
});
it('projects an administrative profile read without note-only arguments for a simple selected-patient field question',async()=>{
 const observed:Record<string,unknown>[]=[];const infer=vi.fn();const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Téléphone : 0000000001',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop({...input,text:'Quel est le téléphone du patient sélectionné ?',conversationId:crypto.randomUUID(),appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/22222222-2222-4222-8222-222222222222'}},{actor:'domain',infer,observeCall:call=>observed.push({name:call.name,args:call.args}),execute},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(result.status).toBe('completed');expect(observed[0]).toMatchObject({name:'get_patient_context',args:{section:'profile'}});expect(Object.keys(observed[0]!.args as object).sort()).toEqual(['partIds','section']);expect(execute.mock.calls[0]?.[0]).toMatchObject({args:{section:'profile'}});
});
it('retains the date and signature filters in the notes tool catalogue',async()=>{
 const text='Quel est son téléphone ? Et quelles notes signées de septembre ?',outputs=frenchRequestedOutputs(text)!,options:LocalTextOptions[]=[];let step=0;expect(outputs).toHaveLength(2);await runAgentLoop({...input,text,conversationId:crypto.randomUUID(),appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/22222222-2222-4222-8222-222222222222'}},{actor:'domain',infer:async(_m,o)=>{options.push(o);if(step++===0)return call('d','declare_request',{parts:outputs.map((goal,index)=>({id:'p'+index,goal,tool:requestedReadTool(goal,text),conditions:[],dependsOn:[]}))});throw Error('Capture only');},execute:vi.fn()},new AbortController().signal);
 const tool=options[1]?.tools?.find(t=>t.function.name==='get_patient_context');expect(tool?.function.parameters['properties']).toHaveProperty('status');expect(tool?.function.parameters['properties']).toHaveProperty('from');
});

it.each(['Pourquoi mes reçus ne s’affichent-ils pas ?','Pourquoi MindCare ralentit ?','Pourquoi la caisse est vide ?','Pourquoi ce résultat diffère de la semaine passée ?'])('does not turn an application/context question into admitted public knowledge: %s',text=>{expect(frenchRequestAdmission(text,true).tools).not.toEqual(['answer_general']);});
it.each(['Compare les revenus et les rendez-vous de demain.','Que dit le DSM sur le stress lié aux revenus ?','Montre les impayés et les traitements.'])('does not close the catalogue on a mixed-domain request: %s',text=>{expect(frenchRequestAdmission(text,false).tools).toBeUndefined();});

it('preserves cabinet-contact and finance as separate requested domains',()=>{expect(frenchRequestAdmission('Donne les recettes du mois et le téléphone du cabinet.',false).tools).toBeUndefined();});
it('keeps historical reads when combined with an administrative field',()=>{expect(frenchRequestAdmission('Quel est son téléphone et son historique ?',false).profileOnly).toBe(false);});
it('does not interpret electrical charges as financial charges',()=>{expect(frenchRequestAdmission('Pourquoi les charges électriques s’attirent-elles ?',true).tools).toEqual(['answer_general']);});

it('answers four supported counts in one authoritative metrics read',async()=>{
 const text='Combien de patients actifs, combien sans identité, combien d’enfants et combien sans consultation terminée depuis six mois ?',execute=vi.fn(async(c:{id:string;args:Record<string,unknown>})=>({callId:c.id,status:'ok' as const,complete:true,text:'Patients actifs : 4\nSans identité : 1\nEnfants : 1\nSans consultation terminée depuis six mois : 2',data:{metrics:{active:4,missing_identity_card:1,children:1,not_seen_6m:2}},evidence:[],conditionKeys:[]})),infer=vi.fn();
 const result=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'counts',execute,infer},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'query_patients',args:{mode:'metrics',metrics:['active','missing_identity_card','children','not_seen_6m']}});expect(result.parts).toHaveLength(4);expect(result.parts.every(p=>p.status==='answered')).toBe(true);
});

it.each(['Quels patients sont actifs ?','Quel est le téléphone du patient sélectionné ?','Pourquoi les patients ont-ils changé de traitement ?'])('blocks an unrequested count as the final answer: %s',async text=>{
 let step=0;const execute=vi.fn(async()=>({callId:'bad',status:'ok' as const,complete:true,text:'32 patients',conditionKeys:[],evidence:[]}));
 await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'operation',execute,infer:async()=>step++===0?call('d','declare_request',{parts:[{id:'p',goal:'Patients',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('bad','query_patients',{partIds:['p'],mode:'count'})},new AbortController().signal);expect(execute).not.toHaveBeenCalled();
});
it('keeps irrelevant patient-tool instructions out of a positively admitted public request',async()=>{
 const text='Pourquoi le ciel est bleu ?',execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[],conditionKeys:[]})),infer=vi.fn();await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'context',execute,infer},new AbortController().signal);expect(infer).not.toHaveBeenCalled();expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general'});expect(execute.mock.calls[0]?.[0].name).not.toBe('query_patients');
});
it('does not offer no-tool metadata for an explicit supported finance request',async()=>{
 let options:LocalTextOptions|undefined;await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'context',execute:vi.fn(),infer:async(_m,o)=>{options=o;throw Error('Capture only');}},new AbortController().signal);
 const raw=JSON.stringify(options?.tools);expect(raw).toContain('query_finance');expect(raw).not.toContain('"none"');
});

it('does not offer a clarification escape for an already admitted complete public question',async()=>{
 const text='Pourquoi la Lune tourne autour de la Terre ?',execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[],conditionKeys:[]})),infer=vi.fn();await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'public',execute,infer},new AbortController().signal);expect(infer).not.toHaveBeenCalled();expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general',args:{question:text}});
});
it('rejects a model-only request to repeat a complete admitted public question',async()=>{
 const text='Pourquoi le ciel est bleu ?',execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[],conditionKeys:[]})),infer=vi.fn();const r=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'public',execute,infer},new AbortController().signal);expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general',args:{question:text}});expect(r.status).toBe('completed');
});

it('requires an explicit finance view and recovers without dispatching a default payment list',async()=>{
 let step=0;const execute=vi.fn(async(c:{id:string;args:Record<string,unknown>})=>({callId:c.id,status:'ok' as const,complete:true,text:'Encaissements : 1000 DZD',evidence:[],conditionKeys:[]}));
 const r=await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'finance-view',execute,infer:async()=>{if(step++===0)return call('d','declare_request',{parts:[{id:'p',goal:input.text,tool:'query_finance',conditions:[],dependsOn:[]}]});return call('f'+step,'query_finance',{partIds:['p'],period:'ce mois',...(step>2?{mode:'overview'}:{})});}},new AbortController().signal);
 expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0].args['mode']).toBe('overview');expect(r.status).toBe('completed');
});
