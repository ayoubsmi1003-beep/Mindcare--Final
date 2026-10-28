import {frenchRequestAdmission,frenchRequestedOutputs,requestedReadTool,frenchPatientCompoundContract} from '@/shared/alexa/request-contract';
import {it,expect,vi} from 'vitest';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion,LocalTextOptions} from '@/server/alexa/local-model-protocol';
import type {AgentCall} from '@/shared/alexa/agent';
const input={text:'Quel est le chiffre d’affaires de ce mois ?',conversationId:'domain',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}};
it('recognizes every supported predicate in the approved French compound-patient query',()=>{
 const text='Trouve les adultes ayant au moins trois consultations terminées, un solde restant dû positif et aucune consultation terminée depuis 90 jours. Donne le nombre, la liste et trie par solde décroissant.';
 const contract=frenchPatientCompoundContract(text);expect(contract).toMatchObject({count:true,sort:'outstanding_desc'});expect(contract?.conditions).toHaveLength(4);expect(contract?.conditions).toEqual(expect.arrayContaining([{field:'age',op:'gte',value:18},{field:'completed_consultations',op:'gte',value:3},{field:'outstanding_balance',op:'gt',value:0},{field:'no_completed_days',op:'eq',value:90}]));
});
const call=(id:string,name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id,name,args}],message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]},tokensIn:1,tokensOut:1});
it.each(['Quel est le chiffre d’affaires de ce mois ?','Donne les recettes de la semaine.','Quel est le total des dépenses ?','Affiche la répartition des charges.'])('blocks a patient-count substitution for the explicit financial request: %s',async text=>{
 let step=0;const execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:c.name==='query_finance'?'Recettes vérifiées : 12 500 DZD':'32 patients',data:{total:12500},evidence:[],conditionKeys:[]}));
 const infer=vi.fn(async()=>step++===0?call('decl','declare_request',{parts:[{id:'p',goal:'Patients',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('bad','query_patients',{partIds:['p'],mode:'count'}));
 const r=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'domain',execute,infer},new AbortController().signal);
 if(text==='Quel est le chiffre d’affaires de ce mois ?'){expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'query_finance'});expect(r.status).toBe('completed');}
 else{expect(execute).not.toHaveBeenCalled();expect(r.status).not.toBe('completed');}
 expect(r.sentences.join(' ')).not.toContain('32 patients');
});
it('dispatches an admitted public question through the local-answer gate without a database read',async()=>{
 const text='Pourquoi les objets tombent-ils vers le sol ?',execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[{id:c.id,type:'query' as const,label:'Réponse générale',provenance:{gate:'local_model',provider:'local'}}],conditionKeys:[]})),infer=vi.fn();
 const result=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'domain',infer,execute},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general',args:{question:text}});expect(result.status).toBe('completed');
});
it('binds the selected patient identity to an administrative profile read without note-only arguments',async()=>{
 const patientId='22222222-2222-4222-8222-222222222222',observed:Record<string,unknown>[]=[];const infer=vi.fn();const execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Téléphone : 0000000001',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop({...input,text:'Quel est le téléphone du patient sélectionné ?',conversationId:crypto.randomUUID(),appContext:{patientId,page:'/patients/'+patientId}},{actor:'domain',infer,observeCall:call=>observed.push({name:call.name,args:call.args}),execute},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(result.status).toBe('completed');expect(observed[0]).toMatchObject({name:'get_patient_context',args:{patientId,section:'profile'}});expect(Object.keys(observed[0]!.args as object).sort()).toEqual(['partIds','patientId','section']);expect(execute.mock.calls[0]?.[0]).toMatchObject({args:{patientId,section:'profile'}});
});
it('retains the date and signature filters in the notes tool catalogue',async()=>{
 const text='Quel est son téléphone ? Et quelles notes signées de septembre ?',outputs=frenchRequestedOutputs(text)!,options:LocalTextOptions[]=[];let step=0;expect(outputs).toHaveLength(2);await runAgentLoop({...input,text,conversationId:crypto.randomUUID(),appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/22222222-2222-4222-8222-222222222222'}},{actor:'domain',infer:async(_m,o)=>{options.push(o);if(step++===0)return call('d','declare_request',{parts:outputs.map((goal,index)=>({id:'p'+index,goal,tool:requestedReadTool(goal,text),conditions:[],dependsOn:[]}))});throw Error('Capture only');},execute:vi.fn()},new AbortController().signal);
 const tool=options[1]?.tools?.find(t=>t.function.name==='get_patient_context');expect(tool?.function.parameters['properties']).toHaveProperty('status');expect(tool?.function.parameters['properties']).toHaveProperty('from');
});
it('keeps each requested document kind in its own read result',async()=>{
 const text='Pour Ayoub Salmi, montre les ordonnances et les certificats médicaux, puis résume ses traitements en cours.',outputs=frenchRequestedOutputs(text)!;
 expect(outputs).toHaveLength(3);
 const multi=(entries:{id:string;name:string;args:Record<string,unknown>}[]):LocalCompletion=>({kind:'calls',calls:entries,message:{role:'assistant',content:null,tool_calls:entries.map(entry=>({id:entry.id,type:'function',function:{name:entry.name,arguments:JSON.stringify(entry.args)}}))},tokensIn:3,tokensOut:3});
 let step=0;
 const execute=vi.fn(async(call:AgentCall)=>({callId:call.id,status:call.args['kind']==='certificat_medical'?'empty' as const:'ok' as const,complete:true,text:call.name==='get_patient_context'?'Traitement en cours : vérifié.':call.args['kind']==='ordonnance'?'Ordonnance vérifiée.':'Aucun certificat médical ne correspond à cette demande.',patientId:'22222222-2222-4222-8222-222222222222',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop({...input,text,conversationId:'document-results-must-stay-separate'},{actor:'document-results-must-stay-separate',infer:async(messages)=>{
  if(step++===0)return call('declaration','declare_request',{parts:outputs.map((goal,index)=>({id:'p'+(index+1),goal,tool:requestedReadTool(goal,text),conditions:[],dependsOn:[]}))});
  if(step===2)return call('grouped-documents','query_documents',{partIds:['p1','p2'],kind:'ordonnance',patientName:'Ayoub Salmi'});
  if(!JSON.stringify(messages).includes('DocumentPartsMustBeReadSeparately'))throw new Error('Alexa must be told to query each document part separately.');
  return multi([
   {id:'read-ordonnance',name:'query_documents',args:{partIds:['p1'],kind:'ordonnance',patientName:'Ayoub Salmi'}},
   {id:'read-certificate',name:'query_documents',args:{partIds:['p2'],kind:'certificat_medical',patientName:'Ayoub Salmi'}},
   {id:'read-treatments',name:'get_patient_context',args:{partIds:['p3'],section:'treatments',patientName:'Ayoub Salmi'}},
  ]);
 },execute},new AbortController().signal);
 expect(execute).toHaveBeenCalledTimes(3);
 expect(execute.mock.calls.map(([tool])=>tool.args['partIds'])).toEqual([['p1'],['p2'],['p3']]);
 expect(result.status).toBe('completed');expect(result.parts.map(part=>part.status)).toEqual(['answered','answered','answered']);
 expect(result.sentences.join(' ')).toContain('Aucun certificat médical ne correspond');
});

it('does not let an undeclared clarification replace a complete treatment read',async()=>{
 const text='Pour Ayoub Salmi, montre les ordonnances et les certificats médicaux, puis résume ses traitements en cours.',outputs=frenchRequestedOutputs(text)!;let step=0,offered:string[]=[];
 const multi=(entries:{id:string;name:string;args:Record<string,unknown>}[]):LocalCompletion=>({kind:'calls',calls:entries,message:{role:'assistant',content:null,tool_calls:entries.map(entry=>({id:entry.id,type:'function',function:{name:entry.name,arguments:JSON.stringify(entry.args)}}))},tokensIn:3,tokensOut:3});
 const execute=vi.fn(async(tool:AgentCall)=>({callId:tool.id,status:tool.args['kind']==='certificat_medical'?'empty' as const:'ok' as const,complete:true,text:tool.name==='get_patient_context'?'Traitements en cours lus.':tool.args['kind']==='ordonnance'?'Ordonnance lue.':'Aucun certificat médical ne correspond.',patientId:'22222222-2222-4222-8222-222222222222',evidence:[],conditionKeys:[]}));
 const result=await runAgentLoop({...input,text,conversationId:'no-unrequested-treatment-clarification'},{actor:'no-unrequested-treatment-clarification',infer:async(messages,options)=>{
  if(step++===0)return call('declaration','declare_request',{parts:outputs.map((goal,index)=>({id:'p'+(index+1),goal,tool:requestedReadTool(goal,text),conditions:[],dependsOn:[]}))});
  if(step===2){offered=options.tools?.map(tool=>tool.function.name)??[];return call('unneeded-clarification','ask_doctor',{partIds:['p3'],question:'Résume les traitements en cours de Ayoub Salmi'});}
  if(!JSON.stringify(messages).includes('InvalidArgumentsOrDependency'))throw new Error('Alexa must reject the undeclared clarification and retry the admitted read.');
  return multi([
   {id:'read-ordonnance',name:'query_documents',args:{partIds:['p1'],kind:'ordonnance',patientName:'Ayoub Salmi'}},
   {id:'read-certificate',name:'query_documents',args:{partIds:['p2'],kind:'certificat_medical',patientName:'Ayoub Salmi'}},
   {id:'read-treatments',name:'get_patient_context',args:{partIds:['p3'],section:'treatments',patientName:'Ayoub Salmi'}},
  ]);
 },execute},new AbortController().signal);
 expect(offered).not.toContain('ask_doctor');expect(execute).toHaveBeenCalledTimes(3);expect(result.status).toBe('completed');expect(result.parts.map(part=>part.status)).toEqual(['answered','answered','answered']);
});

it('limits model instructions to the tools required by mixed document and treatment reads',async()=>{
 const text='Pour Ayoub Salmi, montre les ordonnances et les certificats médicaux, puis résume ses traitements en cours.';let system='';
 await runAgentLoop({...input,text,conversationId:'scoped-document-treatment-prompt'},{actor:'scoped-document-treatment-prompt',infer:async messages=>{system=String(messages[0]?.content);throw new Error('Capture only');},execute:vi.fn()},new AbortController().signal);
 expect(system).toContain('query_documents :');expect(system).toContain('get_patient_context :');expect(system).not.toContain('query_finance :');expect(system).not.toContain('query_agenda :');expect(system).not.toContain('ask_doctor :');
});

it.each(['Pourquoi mes reçus ne s’affichent-ils pas ?','Pourquoi MindCare ralentit ?','Pourquoi la caisse est vide ?','Pourquoi ce résultat diffère de la semaine passée ?'])('does not turn an application/context question into admitted public knowledge: %s',text=>{expect(frenchRequestAdmission(text,true).tools).not.toEqual(['answer_general']);});
it.each(['Compare les revenus et les rendez-vous de demain.','Que dit le DSM sur le stress lié aux revenus ?','Montre les impayés et les traitements.'])('does not close the catalogue on a mixed-domain request: %s',text=>{expect(frenchRequestAdmission(text,false).tools).toBeUndefined();});

it('preserves cabinet-contact and finance as separate requested domains',()=>{expect(frenchRequestAdmission('Donne les recettes du mois et le téléphone du cabinet.',false).tools).toBeUndefined();});
it('keeps historical reads when combined with an administrative field',()=>{expect(frenchRequestAdmission('Quel est son téléphone et son historique ?',false).profileOnly).toBe(false);});
it('does not interpret electrical charges as financial charges',()=>{expect(frenchRequestAdmission('Pourquoi les charges électriques s’attirent-elles ?',true).tools).toEqual(['answer_general']);});

it('answers four supported counts in one authoritative metrics read',async()=>{
 const text='Combien de patients actifs, combien sans identité, combien d’enfants et combien sans consultation terminée depuis six mois ?',execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Patients actifs : 4\nSans identité : 1\nEnfants : 1\nSans consultation terminée depuis six mois : 2',data:{metrics:{active:4,missing_identity_card:1,children:1,not_seen_6m:2}},evidence:[],conditionKeys:[]})),infer=vi.fn();
 const result=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'counts',execute,infer},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'query_patients',args:{mode:'metrics',metrics:['active','missing_identity_card','children','not_seen_6m']}});expect(result.parts).toHaveLength(4);expect(result.parts.every(p=>p.status==='answered')).toBe(true);
});

it('uses the patient list read rather than an unrequested count for “Quels patients sont actifs ?”',async()=>{
 const text='Quels patients sont actifs ?',execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Ayoub Salmi',data:{total:1,rows:[]},conditionKeys:[],evidence:[]})),infer=vi.fn();
 const result=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'operation',execute,infer},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'query_patients',args:{mode:'list',population:'active'}});expect(execute.mock.calls[0]?.[0].args['mode']).not.toBe('count');expect(result.status).toBe('completed');
});
it.each(['Quel est le téléphone du patient sélectionné ?','Pourquoi les patients ont-ils changé de traitement ?'])('blocks an unrequested count as the final answer: %s',async text=>{
 let step=0;const execute=vi.fn(async()=>({callId:'bad',status:'ok' as const,complete:true,text:'32 patients',conditionKeys:[],evidence:[]}));
 await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'operation',execute,infer:async()=>step++===0?call('d','declare_request',{parts:[{id:'p',goal:'Patients',tool:'query_patients',conditions:[],dependsOn:[]}]}):call('bad','query_patients',{partIds:['p'],mode:'count'})},new AbortController().signal);expect(execute).not.toHaveBeenCalled();
});
it('keeps irrelevant patient-tool instructions out of a positively admitted public request',async()=>{
 const text='Pourquoi le ciel est bleu ?',execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[],conditionKeys:[]})),infer=vi.fn();await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'context',execute,infer},new AbortController().signal);expect(infer).not.toHaveBeenCalled();expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general'});expect(execute.mock.calls[0]?.[0].name).not.toBe('query_patients');
});
it('uses the deterministic finance read for a complete supported finance request',async()=>{
 const execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Recettes vérifiées : 12 500 DZD',data:{total:12500},evidence:[],conditionKeys:[]})),infer=vi.fn();
 await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'context',execute,infer},new AbortController().signal);
 expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'query_finance',args:{mode:'overview'}});
});

it('does not offer a clarification escape for an already admitted complete public question',async()=>{
 const text='Pourquoi la Lune tourne autour de la Terre ?',execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[],conditionKeys:[]})),infer=vi.fn();await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'public',execute,infer},new AbortController().signal);expect(infer).not.toHaveBeenCalled();expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general',args:{question:text}});
});
it('rejects a model-only request to repeat a complete admitted public question',async()=>{
 const text='Pourquoi le ciel est bleu ?',execute=vi.fn(async(c:AgentCall)=>({callId:c.id,status:'ok' as const,complete:true,text:'Réponse générale locale.',evidence:[],conditionKeys:[]})),infer=vi.fn();const r=await runAgentLoop({...input,text,conversationId:crypto.randomUUID()},{actor:'public',execute,infer},new AbortController().signal);expect(infer).not.toHaveBeenCalled();expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'answer_general',args:{question:text}});expect(r.status).toBe('completed');
});

it('requires an explicit finance view and recovers without dispatching a default payment list',async()=>{
 let step=0;const execute=vi.fn(async(c:{id:string;args:Record<string,unknown>})=>({callId:c.id,status:'ok' as const,complete:true,text:'Encaissements : 1000 DZD',evidence:[],conditionKeys:[]}));
 const r=await runAgentLoop({...input,conversationId:crypto.randomUUID()},{actor:'finance-view',execute,infer:async()=>{if(step++===0)return call('d','declare_request',{parts:[{id:'p',goal:input.text,tool:'query_finance',conditions:[],dependsOn:[]}]});return call('f'+step,'query_finance',{partIds:['p'],period:'ce mois',...(step>2?{mode:'overview'}:{})});}},new AbortController().signal);
 expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0]?.[0].args['mode']).toBe('overview');expect(r.status).toBe('completed');
});
