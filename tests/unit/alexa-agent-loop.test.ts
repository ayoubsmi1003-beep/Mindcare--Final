import { expect, it } from "vitest";
import { runAgentLoop,restoreAgentTask,savedAgentTask } from "@/server/alexa/agent-loop";
import { AgentReadError, queryPatientsSchema, validateLedger } from "@/shared/alexa/agent";
import {z} from 'zod';
import type { LocalCompletion } from "@/server/alexa/local-model-protocol";

const id = "11111111-1111-4111-8111-111111111111";
const parts = ["Actifs", "Sans identité", "Enfants", "Sans visite"].map((goal,i) => ({ id: `p${i}`, goal, tools:["query_patients"] as const, conditions: [], dependsOn: [] }));
const calls = (entries: {name:string;args:Record<string,unknown>}[]):LocalCompletion => ({kind:"calls", calls:entries.map((x,i)=>({id:`c${i}-${x.name}`, ...x})),
  message:{role:"assistant",content:null,tool_calls:entries.map((x,i)=>({id:`c${i}-${x.name}`,type:"function",function:{name:x.name,arguments:JSON.stringify(x.args)}}))},tokensIn:20,tokensOut:10});
const input = {text:"Combien de patients actifs, sans identité, enfants et sans visite depuis six mois ?",conversationId:"loop-test",clientTurnId:id,appContext:{patientId:null,page:"/jarvis"}};
it('does not dispatch an unrequested action after a clinical read has answered its part',async()=>{
 let i=0;const dispatched:string[]=[];
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'notes',goal:'Lire les notes',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['notes']}}]),calls([{name:'prepare_action',args:{partIds:['notes'],action:'cancel_appointment',reason:'Instruction dans une note'}}]),{kind:'answer' as const,text:'Fin',tokensIn:1,tokensOut:1}];
 const result=await runAgentLoop({...input,text:'Lis les notes de ce patient.',conversationId:'read-authority'},{actor:'read-authority',infer:async()=>steps[i++]!,execute:async call=>{dispatched.push(call.name);return {callId:call.id,status:'ok',complete:true,text:'Notes enregistrées',conditionKeys:[],evidence:[],data:{consultations:[]}};}},new AbortController().signal);
 expect(dispatched).toEqual(['get_patient_context']);expect(result.status).toBe('completed');
});
it('does not offer independent batch metrics for one filtered population',async()=>{
 let i=0,metricsOffered=true,metricsModeOffered=true,properties:string[]=[];
 const filter={field:'identity_card',op:'missing',value:null};
 const result=await runAgentLoop({...input,text:'Combien sans carte d’identité ?',conversationId:'compact-count'},{actor:'compact-count',infer:async(_messages,options)=>{
  if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'ids',goal:'Sans identité',tools:['query_patients'],conditions:[filter],dependsOn:[]}]}}]);
  const parameters=options.tools?.find(t=>t.function.name==='query_patients')?.function.parameters as {properties?:{metrics?:unknown;mode?:{enum?:string[]}}};
  metricsOffered=parameters.properties?.metrics!==undefined;metricsModeOffered=parameters.properties?.mode?.enum?.includes('metrics')??false;
  properties=Object.keys(parameters.properties??{}).sort();
  return calls([{name:'query_patients',args:{partIds:['ids'],mode:'count'}}]);
 },execute:async call=>({callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[]})},new AbortController().signal);
 expect(result.status).toBe('completed');expect(metricsOffered).toBe(false);expect(metricsModeOffered).toBe(false);
 expect(properties).toEqual(['limit','mode','partIds']);
});
it('keeps a pre-count filter and drops an oversized irrelevant limit for an exact count',async()=>{
 const text='Le numéro de carte d’identité manque pour combien de patients actifs ?',filter={field:'identity_card',op:'missing',value:null};let i=0,executed:Record<string,unknown>|undefined;
 const result=await runAgentLoop({...input,text,conversationId:'prefixed-count-filter'},{actor:'prefixed-count-filter',infer:async()=>i++===0?calls([{name:'declare_request',args:{parts:[{id:'id',goal:text,tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}}]):i===2?calls([{name:'query_patients',args:{partIds:['id'],mode:'count',limit:100}}]):{kind:'answer',text:'',tokensIn:0,tokensOut:0},execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'7 patients',conditionKeys:['identity_card:missing:null'],evidence:[]};}},new AbortController().signal);
 expect(result.status).toBe('completed');expect(executed).toMatchObject({mode:'count',population:'active',filters:[filter]});expect(executed?.limit).toBeUndefined();
});
it('does not expose or execute a patient search term for a count that names no patient',async()=>{
 let i=0,queryOffered=true,executed=0,executedQuery:unknown='not-called';
 const result=await runAgentLoop({...input,text:'Compte les patients actifs.',conversationId:'active-count-no-query'},{actor:'active-count-no-query',infer:async(_messages,options)=>{
  if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'active',goal:'Compte les patients actifs',tools:['query_patients'],conditions:[],dependsOn:[]}]}}]);
  const parameters=options.tools?.find(t=>t.function.name==='query_patients')?.function.parameters as {properties?:Record<string,unknown>};
  queryOffered=Object.hasOwn(parameters.properties??{},'query');
  return calls([{name:'query_patients',args:{partIds:['active'],mode:'count',query:'adulte'}}]);
 },execute:async call=>{executed++;executedQuery=call.args['query'];return {callId:call.id,status:'ok',complete:true,text:'32',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(queryOffered).toBe(false);
 expect(executed).toBe(1);
 expect(executedQuery).toBeUndefined();
 expect(result.status).toBe('completed');
});
it('limits a patient-name search to the exact grounded French name',async()=>{
 let i=0,querySchema:Record<string,unknown>|undefined;
 const result=await runAgentLoop({...input,text:'Montre le dossier du patient Nadia Test.',conversationId:'named-patient-query'},{actor:'named-patient-query',infer:async(_messages,options)=>{
  if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'patient',goal:'Montre le dossier du patient Nadia Test',tools:['query_patients'],literalQuery:'Nadia Test',conditions:[],dependsOn:[]}]}}]);
  const parameters=options.tools?.find(t=>t.function.name==='query_patients')?.function.parameters as {properties?:Record<string,{enum?:string[]}>};
  querySchema=parameters.properties?.query;
  return calls([{name:'query_patients',args:{partIds:['patient'],mode:'list',query:'Nadia Test'}}]);
 },execute:async call=>({callId:call.id,status:'ok',complete:true,text:'1 patient',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(querySchema?.enum).toEqual(['Nadia Test']);
 expect(result.status).toBe('completed');
});
it('carries a verified query into a short list continuation before native domain selection',async()=>{
 const actor='list-resume',conversationId='list-resume';let i=0;
 const filter={field:'identity_card',op:'missing',value:null};
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'ids',goal:'Sans identité',tools:['query_patients'],conditions:[filter],dependsOn:[]}]}}]),calls([{name:'query_patients',args:{partIds:['ids'],mode:'count'}}])];
 await runAgentLoop({...input,conversationId},{actor,infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[],data:{patientQuery:{mode:'count',filters:[filter]},asOf:'2026-10-15T12:00:00.000Z'}})},new AbortController().signal);
 let metadataOffered=true;
 const next=await runAgentLoop({...input,conversationId,text:'Lesquels ?'},{actor,infer:async(_messages,options)=>{metadataOffered=!!options.tools?.some(t=>t.function.name==='declare_request');return calls([{name:'query_patients',args:{partIds:['continuation'],mode:'list'}}]);},execute:async call=>({callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[]})},new AbortController().signal);
 expect(metadataOffered).toBe(false);expect(next.status).toBe('completed');expect(next.parts[0]?.conditions).toEqual([filter]);
});
it('registers metadata split across native calls atomically before dependent reads',async()=>{
 let i=0;
 const steps=[calls(parts.map(p=>({name:'declare_request',args:{parts:[p]}}))),calls([{name:'query_patients',args:{partIds:parts.map(p=>p.id),mode:'metrics',metrics:['active']}}])];
 const result=await runAgentLoop({...input,conversationId:'split-metadata'},{actor:'split-metadata',infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'ok',complete:true,text:'32',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(result.parts).toHaveLength(4);expect(result.parts.every(p=>p.status==='answered')).toBe(true);
});
it("answers four registered parts without the legacy three-question limit",async()=>{
 let index=0;const steps=[calls([{name:"declare_request",args:{parts}}]),calls([{name:"query_patients",args:{partIds:parts.map(p=>p.id),mode:"metrics",metrics:["active","missing_identity_card","children","not_seen_6m"]}}]),{kind:"answer" as const,text:"Terminé",tokensIn:20,tokensOut:10}];
 const result=await runAgentLoop(input,{actor:"four",infer:async()=>steps[index++]!,execute:async(call)=>({callId:call.id,status:"ok",complete:true,data:{total:4},evidence:[],text:"Données vérifiées",conditionKeys:[]})},new AbortController().signal);
 expect(result.parts.map(p=>p.status)).toEqual(["answered","answered","answered","answered"]);
 expect(result.status).toBe("completed");expect(result.sentences.join(" ")).toContain("Données vérifiées");
});
it.each(['database','timeout','malformed'])("keeps three verified answers when an independent fourth query fails: %s",async(kind)=>{
 let index=0;const steps=[calls([{name:"declare_request",args:{parts}}]),calls(parts.map(p=>({name:"query_patients",args:{partIds:[p.id],mode:"count"}}))),{kind:"answer" as const,text:"",tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,conversationId:"partial"},{actor:"partial",infer:async()=>steps[index++]!,execute:async(call)=>{
  if((call.args["partIds"] as string[])[0]==="p2"){
   if(kind==='timeout')throw new AgentReadError('timeout');
   if(kind==='malformed')z.object({total:z.number()}).parse({total:'invalid'});
   throw new Error("private database diagnostic");
  }
  return {callId:call.id,status:"ok",complete:true,data:{total:2},text:"2 patients",evidence:[],conditionKeys:[]};
 }},new AbortController().signal);
 expect(result.status).toBe("partial");expect(result.parts.filter(p=>p.status==="answered")).toHaveLength(3);
 expect(JSON.stringify(result)).not.toContain("private database diagnostic");
});
it("refuses dropped compound conditions and invalid ledger dependencies",()=>{
 expect(()=>queryPatientsSchema.parse({partIds:["a"],mode:"count",filters:[{field:"sql",op:"eq",value:"SELECT"}]})).toThrow();
 expect(()=>validateLedger([{id:"a",goal:"A",conditions:[],dependsOn:["a"]}])).toThrow();
 expect(()=>validateLedger([{id:"a",goal:"A",conditions:[],dependsOn:[]},{id:"a",goal:"B",conditions:[],dependsOn:[]}])).toThrow();
});
it("does not claim an answer when an executed query omitted a material filter",async()=>{
 let index=0;const condition={field:"age",op:"gte",value:18};
 const steps=[calls([{name:"declare_request",args:{parts:[{id:"adult",goal:"Adultes",tools:["query_patients"],conditions:[condition],dependsOn:[]}]}}]),calls([{name:"query_patients",args:{partIds:["adult"],mode:"count"}}]),{kind:"answer" as const,text:"10 adultes",tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,conversationId:"predicate"},{actor:"predicate",infer:async()=>steps[index++]!,execute:async(call)=>({callId:call.id,status:"ok",complete:true,data:{total:10},text:"10 patients",evidence:[],conditionKeys:[]})},new AbortController().signal);
 expect(result.status).not.toBe("completed");expect(result.sentences.join(" ")).not.toContain("10 adultes");
});
it('withholds a model-only financial answer when a registered database read was never executed',async()=>{
 let i=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'money',goal:'Recettes',tools:['query_finance'],conditions:[],dependsOn:[]}]}}]),{kind:'answer' as const,text:'Les recettes sont de 9000 DZD.',tokensIn:10,tokensOut:10}];
 const result=await runAgentLoop({...input,text:'Quel est le chiffre d’affaires ?',conversationId:'unexecuted-read'},{actor:'finance',infer:async()=>steps[i++]!,execute:async()=>{throw Error('Unexpected');}},new AbortController().signal);
 expect(result.status).toBe('failed');expect(result.sentences.join(' ')).not.toContain('9000');
});
it('does not credit two independent metrics as proof of one AND-filtered count',async()=>{
 let i=0,executed=0;const filters=[{field:'phone',op:'missing',value:null},{field:'age',op:'lt',value:18}];
 const steps=[calls([{name:'declare_request',args:{parts:[{id:'children_without_phone',goal:'Enfants sans téléphone',tools:['query_patients'],conditions:filters,dependsOn:[]}]}}]),calls([{name:'query_patients',args:{partIds:['children_without_phone'],mode:'metrics',metrics:['missing_phone','children']}}]),{kind:'answer' as const,text:'2',tokensIn:0,tokensOut:0}];
 const result=await runAgentLoop({...input,text:'Combien d’enfants sans téléphone ?',conversationId:'metric-and'},{actor:'metric-and',infer:async()=>steps[i++]!,execute:async call=>{executed++;return {callId:call.id,status:'ok',complete:true,text:'2',evidence:[],conditionKeys:['phone:missing:null','age:lt:18']};}},new AbortController().signal);
 expect(executed).toBe(0);expect(result.status).not.toBe('completed');
});
it('rejects an extra model filter that narrows the registered population',async()=>{
 let i=0,executed=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'id',goal:'Sans identité',tools:['query_patients'],conditions:[{field:'identity_card',op:'missing',value:null}],dependsOn:[]}]}}]),calls([{name:'query_patients',args:{partIds:['id'],mode:'count',filters:[{field:'phone',op:'missing',value:null}]}}]),{kind:'answer' as const,text:'2',tokensIn:0,tokensOut:0}];
 await runAgentLoop({...input,conversationId:'extra-filter'},{actor:'extra-filter',infer:async()=>steps[i++]!,execute:async call=>{executed++;return {callId:call.id,status:'ok',complete:true,text:'2',evidence:[],conditionKeys:['identity_card:missing:null']};}},new AbortController().signal);
 expect(executed).toBe(0);
});
it('retains the original task when the client adopts the patient resolved during clarification',async()=>{
 const patient='11111111-1111-4111-8111-111111111111',conversationId='adopt-resolved';let i=0;
 const declaration=calls([{name:'declare_request',args:{parts:[{id:'rdv',goal:'Préparer le rendez-vous',tools:['prepare_action'],conditions:[],dependsOn:[]}]}}]);
 const steps=[declaration,calls([{name:'prepare_action',args:{partIds:['rdv'],action:'create_appointment',patientId:patient}}])];
 const first={...input,text:'Prépare un rendez-vous pour le patient sélectionné.',conversationId};
 await runAgentLoop(first,{actor:'scope-adoption',infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'needs_input',complete:false,patientId:patient,text:'Quelle heure ?',evidence:[],conditionKeys:[]})},new AbortController().signal);
 let metadata='';await runAgentLoop({...first,text:'Demain à 10 heures',appContext:{patientId:patient,page:'/jarvis'}},{actor:'scope-adoption',infer:async messages=>{metadata=messages[1]?.content??'';return {kind:'answer',text:'',tokensIn:0,tokensOut:0};},execute:async()=>{throw Error('Unexpected');}},new AbortController().signal);
 expect(metadata).toContain(first.text);
});


it('recovers once from an unsupported model answer while a database part is still pending',async()=>{
 let index=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'p',goal:'Patients actifs',tools:['query_patients'],conditions:[],dependsOn:[]}]}}]),{kind:'answer' as const,text:'Il y a 999 patients.',tokensIn:1,tokensOut:1},calls([{name:'query_patients',args:{partIds:['p'],mode:'count'}}])];
 const result=await runAgentLoop({...input,text:'Combien de patients actifs ?',conversationId:'plain-recovery'},{actor:'plain-recovery',infer:async()=>steps[index++]!,execute:async call=>({callId:call.id,status:'ok',complete:true,text:'32 patients actifs vérifiés',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(result.status).toBe('completed');expect(result.sentences.join(' ')).toContain('32 patients actifs');expect(result.sentences.join(' ')).not.toContain('999');
});

it('pins a saved note continuation to notes even if the model selects profile',async()=>{
 const actor='note-resume',conversationId='note-resume',patient='22222222-2222-4222-8222-222222222222';let i=0;
 const first=[calls([{name:'declare_request',args:{parts:[{id:'n',goal:'Lire les notes',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['n'],section:'notes'}}])];
 await runAgentLoop({...input,text:'Lis les notes.',conversationId,appContext:{patientId:patient,page:'/patients/'+patient}},{actor,infer:async()=>first[i++]!,execute:async call=>({callId:call.id,status:'partial',complete:false,patientId:patient,text:'Extrait partiel',conditionKeys:[],evidence:[],data:{noteQuery:{patientId:patient,area:'working'},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(32),next:{offset:0,textOffset:1200}}})},new AbortController().signal);
 let executed:unknown;await runAgentLoop({...input,text:'La suite.',conversationId,appContext:{patientId:patient,page:'/patients/'+patient}},{actor,infer:async()=>calls([{name:'get_patient_context',args:{partIds:['continuation'],section:'profile'}}]),execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Suite exacte',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(executed).toMatchObject({section:'notes',reusePrevious:true});
});

it('reports a verified partial read as partial rather than failed',async()=>{let i=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'n',goal:'Les notes',tools:['get_patient_context'],conditions:[],dependsOn:[]}]}}]),calls([{name:'get_patient_context',args:{partIds:['n'],section:'notes'}}])];const r=await runAgentLoop({...input,conversationId:'single-partial',text:'Lis les notes.'},{actor:'single-partial',infer:async()=>steps[i++]!,execute:async call=>({callId:call.id,status:'partial',complete:false,text:'Extrait vérifié ; suite disponible.',evidence:[],conditionKeys:[]})},new AbortController().signal);expect(r.status).toBe('partial');expect(r.sentences.join(' ')).toContain('Extrait vérifié');});

it('pins a stored analysis continuation to its exact query and persists only the cursor',async()=>{
 const actor='analysis-resume',conversationId='analysis-resume',patient='22222222-2222-4222-8222-222222222222',consultation='33333333-3333-4333-8333-333333333333';let i=0;
 const first=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'Analyse',tools:['query_consultations'],conditions:[],dependsOn:[]}]}}]),calls([{name:'query_consultations',args:{partIds:['a'],consultationId:consultation,view:'analysis'}}])];
 await runAgentLoop({...input,text:'Lis cette analyse.',conversationId,appContext:{patientId:patient,page:'/consultation/'+consultation}},{actor,infer:async()=>first[i++]!,execute:async call=>({callId:call.id,status:'partial',complete:false,patientId:patient,text:'Extrait partiel',conditionKeys:[],evidence:[],data:{consultationQuery:{consultationId:consultation,view:'analysis',textOffset:0,revision:'a'.repeat(64)},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(64),nextTextOffset:1200,analysis:{text:'Do not persist this body'}}})},new AbortController().signal);
 let executed:unknown;await runAgentLoop({...input,text:'La suite.',conversationId,appContext:{patientId:patient,page:'/consultation/'+consultation}},{actor,infer:async()=>calls([{name:'query_consultations',args:{partIds:['continuation'],mode:'count'}}]),execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Suite exacte',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(executed).toEqual({partIds:['continuation'],view:'analysis',reusePrevious:true});
});

it('coalesces equivalent duplicate metadata for one explicit count and enforces count-only execution',async()=>{
 const condition={field:'identity_card',op:'missing',value:null},duplicates=['a','b'].map(id=>({id,goal:'has_card_identity',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}));let i=0,executed:unknown;
 const steps=[calls([{name:'declare_request',args:{parts:duplicates}}]),calls([{name:'query_patients',args:{partIds:['a'],mode:'list'}}])];
 const r=await runAgentLoop({...input,text:'Combien de patients n’ont pas de numéro de carte d’identité ?',conversationId:'one-count-contract'},{actor:'one-count-contract',infer:async()=>steps[i++]!,execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'25 patients',conditionKeys:["identity_card:missing:null"],evidence:[]};}},new AbortController().signal);
 expect(r.parts).toHaveLength(1);expect(r.parts[0]?.conditions).toEqual([condition]);expect(r.status).toBe('completed');expect(executed).toMatchObject({mode:'count'});
});
it('keeps count and list as distinct outputs when both were explicitly requested',async()=>{
 let i=0;const requested=['count','list'].map(id=>({id,goal:id,tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}));
 const steps=[calls([{name:'declare_request',args:{parts:requested}}]),calls([{name:'query_patients',args:{partIds:['count'],mode:'count'}},{name:'query_patients',args:{partIds:['list'],mode:'list'}}])];const modes:string[]=[];
 const r=await runAgentLoop({...input,text:'Combien de patients n’ont pas de numéro de carte d’identité ? Liste-les aussi.',conversationId:'count-and-list-contract'},{actor:'count-and-list-contract',infer:async()=>steps[i++]!,execute:async call=>{modes.push(String(call.args.mode));return {callId:call.id,status:'ok',complete:true,text:'25',conditionKeys:['identity_card:missing:null'],evidence:[]};}},new AbortController().signal);
 expect(r.parts).toHaveLength(2);expect(modes).toEqual(['count','list']);
});
it('cannot coalesce two different populations into a purported single count',async()=>{
 let i=0,reads=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'actifs',tool:'query_patients',conditions:[],dependsOn:[]},{id:'b',goal:'enfants',tool:'query_patients',conditions:['age:lt:18'],dependsOn:[]}]}}])];
 const r=await runAgentLoop({...input,text:'Combien de patients actifs avons-nous ?',conversationId:'different-populations-contract'},{actor:'different-populations-contract',infer:async()=>{if(i++===0)return steps[0]!;throw Error('No valid repair');},execute:async()=>{reads++;throw Error('No dispatch');}},new AbortController().signal);
 expect(reads).toBe(0);expect(r.parts).toHaveLength(1);expect(r.parts[0]?.status).not.toBe('answered');
});
it('accounts explicitly for all four count clauses after an incomplete native declaration',async()=>{
 let i=0,reads=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'actifs',tool:'query_patients',conditions:[],dependsOn:[]},{id:'b',goal:'enfants',tool:'query_patients',conditions:['age:lt:18'],dependsOn:[]}]}}])];
 const r=await runAgentLoop({...input,text:'Combien de patients actifs, combien sans identité, combien d’enfants et combien sans consultation terminée depuis six mois ?',conversationId:'four-count-omission-contract'},{actor:'four-count-omission-contract',infer:async()=>{if(i++===0)return steps[0]!;throw Error('No valid repair');},execute:async()=>{reads++;throw Error('No dispatch');}},new AbortController().signal);
 expect(reads).toBe(0);expect(r.parts).toHaveLength(4);expect(r.parts.every(p=>p.status!=='answered')).toBe(true);expect(r.parts[3]?.goal).toContain('six mois');
});
it('never substitutes identity-number counts for the unsupported email field',async()=>{
 let i=0,reads=0;const steps=[calls([{name:'declare_request',args:{parts:[{id:'a',goal:'sans identité',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}}])];
 const r=await runAgentLoop({...input,text:'Combien de patients n’ont pas d’adresse électronique ?',conversationId:'unsupported-email-contract'},{actor:'unsupported-email-contract',infer:async()=>{if(i++===0)return steps[0]!;throw Error('No dispatch');},execute:async()=>{reads++;throw Error('No dispatch');}},new AbortController().signal);
 expect(reads).toBe(0);expect(r.parts[0]?.status).toBe('unsupported');expect(r.sentences.join(' ')).toContain('email');
});

function mixedReadingTask(actor:string,bothPartial:boolean){
 const patient='22222222-2222-4222-8222-222222222222',consultation='33333333-3333-4333-8333-333333333333';
 const note={callId:'n',status:bothPartial?'partial':'ok',complete:!bothPartial,text:'Notes',conditionKeys:[],evidence:[],data:{noteQuery:{patientId:patient,area:'working'},asOf:'2026-10-15T12:00:00Z',revision:'a'.repeat(32),...(bothPartial?{next:{offset:0,textOffset:1200}}:{})}};
 const analysis={callId:'a',status:'partial',complete:false,text:'Analyse',conditionKeys:[],evidence:[],data:{consultationQuery:{consultationId:consultation,view:'analysis',textOffset:0,revision:'b'.repeat(64)},asOf:'2026-10-15T12:00:00Z',revision:'b'.repeat(64),nextTextOffset:1200,analysis:{text:'Body not persisted'}}};
 restoreAgentTask(actor,actor,{original:'Lis les notes puis l’analyse.',parts:[{id:'p',goal:'Lectures',tools:['get_patient_context','query_consultations'],conditions:[],dependsOn:[],status:'budget_limited',resultRefs:['n','a']}],results:[note,analysis],at:Date.now(),patientId:patient,page:'/consultation/'+consultation});
 return {...input,conversationId:actor,text:'La suite.',appContext:{patientId:patient,page:'/consultation/'+consultation}};
}
it('resumes the sole unfinished analysis instead of completed notes',async()=>{
 const actor='sole-analysis-cursor',next=mixedReadingTask(actor,false);let executed:unknown;
 const r=await runAgentLoop(next,{actor,infer:async()=>calls([{name:'query_consultations',args:{partIds:['continuation'],mode:'list'}}]),execute:async call=>{executed=call.args;return {callId:call.id,status:'ok',complete:true,text:'Analyse suivante',conditionKeys:[],evidence:[]};}},new AbortController().signal);
 expect(r.status).toBe('completed');expect(executed).toMatchObject({view:'analysis',reusePrevious:true});
});
it('clarifies two unfinished text readings and resumes the explicitly selected analysis',async()=>{
 const actor='ambiguous-reading-cursors',next=mixedReadingTask(actor,true);let inferred=0,executed:unknown;
 const deps={actor,infer:async(_messages:unknown,options:{tools?:readonly {function:{name:string}}[]})=>{inferred++;return options.tools?.some(t=>t.function.name==='get_patient_context')?calls([{name:'get_patient_context',args:{partIds:['continuation'],section:'profile'}}]):calls([{name:'query_consultations',args:{partIds:['continuation'],mode:'list'}}]);},execute:async(call:{id:string;args:Record<string,unknown>})=>{executed=call.args;return {callId:call.id,status:'ok' as const,complete:true,text:'Suite',conditionKeys:[],evidence:[]};}};
 const choice=await runAgentLoop(next,deps,new AbortController().signal);expect(choice.status).toBe('needs_input');expect(inferred).toBe(0);expect(choice.sentences.join(' ')).toMatch(/notes.*analyse/i);
 const persisted=savedAgentTask(actor,actor)!;expect(JSON.stringify(persisted)).not.toContain('Body not persisted');restoreAgentTask(actor,actor,persisted);
 const final=await runAgentLoop({...next,text:'L’analyse'},deps,new AbortController().signal);expect(final.status).toBe('completed');expect(executed).toMatchObject({view:'analysis',reusePrevious:true});const remaining=await runAgentLoop({...next,text:'Les notes'},deps,new AbortController().signal);expect(remaining.status).toBe('completed');expect(executed).toMatchObject({section:'notes',reusePrevious:true});
});
it('blocks an unrequested missing-identity predicate in a positive phone lookup',async()=>{
 let i=0,reads=0;const r=await runAgentLoop({...input,text:'Quel est le téléphone enregistré du patient sélectionné ?',conversationId:'phone-not-missing-id'},{actor:'phone-not-missing-id',infer:async()=>{if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'a',goal:'Téléphone',tool:'query_patients',conditions:['identity_card:missing'],dependsOn:[]}]}}]);throw Error('No repair');},execute:async()=>{reads++;throw Error('No read');}},new AbortController().signal);expect(reads).toBe(0);expect(r.status).toBe('failed');
});

it('gives native intent declaration the actual selected-patient state and a French capability map',async()=>{
 let captured:readonly {role:string;content?:string|null}[]=[];
 await runAgentLoop({...input,text:'Quel est le téléphone du patient sélectionné ?',conversationId:'metadata-selected-patient',appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/22222222-2222-4222-8222-222222222222'}},{actor:'metadata-selected-patient',infer:async messages=>{captured=messages;throw Error('Capture only');},execute:async()=>{throw Error('No execution');}},new AbortController().signal);
 expect(captured[1]?.content).toContain('Patient sélectionné : oui');expect(captured[0]?.content).toContain('get_patient_context :');expect(captured[0]?.content).toContain('answer_general :');expect(captured[0]?.content).toContain('query_finance :');
});

it('does not offer unknown record IDs or redundant absolute dates for one whole relative period',async()=>{
 let i=0,parameters:Record<string,unknown>={};
 await runAgentLoop({...input,text:'Quels sont les rendez-vous de demain ?',conversationId:'grounded-agenda-catalogue'},{actor:'grounded-agenda-catalogue',infer:async(_m,o)=>{if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'a',goal:'Demain',tool:'query_agenda',conditions:[],dependsOn:[]}]}}]);parameters=o.tools!.find(t=>t.function.name==='query_agenda')!.function.parameters;return calls([{name:'query_agenda',args:{partIds:['a'],period:'demain'}}]);},execute:async call=>({callId:call.id,status:'empty',complete:true,text:'0 rendez-vous',conditionKeys:[],evidence:[]})},new AbortController().signal);
 const properties=parameters.properties as Record<string,unknown>;for(const field of ['appointmentId','patientId','patientName'])expect(properties).not.toHaveProperty(field);expect(properties).toHaveProperty('period');expect(properties).not.toHaveProperty('from');expect(properties).not.toHaveProperty('to');expect(parameters.required).toContain('period');
});

it.each(['Quels sont les rendez-vous du 2026-10-01 au 2026-10-15 ?','Montre les rendez-vous de demain entre 9h et 12h.','Quels sont les rendez-vous demain dans la matinée ?','Montre les rendez-vous demain en fin de journée.'])('keeps precise bounds available for the fully specified window %s',async text=>{
 let i=0,parameters:Record<string,unknown>={};
 await runAgentLoop({...input,text,conversationId:'precise-agenda-'+text},{actor:'precise-agenda',infer:async(_m,o)=>{if(i++===0)return calls([{name:'declare_request',args:{parts:[{id:'a',goal:text,tool:'query_agenda',conditions:[],dependsOn:[]}]}}]);parameters=o.tools!.find(t=>t.function.name==='query_agenda')!.function.parameters;return calls([{name:'query_agenda',args:{partIds:['a'],from:'2026-10-16T09:00:00+01:00',to:'2026-10-16T12:00:00+01:00'}}]);},execute:async call=>({callId:call.id,status:'empty',complete:true,text:'0 rendez-vous',conditionKeys:[],evidence:[]})},new AbortController().signal);
 expect(parameters.properties).toHaveProperty('from');expect(parameters.properties).toHaveProperty('to');expect(parameters.required).not.toContain('period');
});
