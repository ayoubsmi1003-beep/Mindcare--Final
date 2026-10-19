import {it,expect} from 'vitest';
import {constrainRequestedOutputs,frenchRequestedOutputs,patientConditionsGrounded,frenchPatientCompoundContract,frenchPatientCountContract,countContractHints} from '@/shared/alexa/request-contract';
import {runAgentLoop} from '@/server/alexa/agent-loop';
import type {LocalCompletion} from '@/server/alexa/local-model-protocol';
const text='Trouve les patients adultes avec au moins trois consultations terminées, un solde restant positif et aucune consultation terminée depuis 90 jours. Compte-les, liste-les et trie par solde décroissant.';
const input={text,conversationId:'compound-guard',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:null,page:'/jarvis'}};
const calls=(name:string,args:Record<string,unknown>):LocalCompletion=>({kind:'calls',calls:[{id:'c'+name,name,args}],message:{role:'assistant',content:null},tokensIn:1,tokensOut:1});
const conditions=['age:gte:18','completed_consultations:gte:3','outstanding_balance:gt:0','no_completed_days:eq:90'];
it.each([
 'Trouve les patients adultes actifs ayant au moins trois consultations terminées, un solde impayé et aucune consultation terminée depuis 90 jours. Compte-les et liste-les par solde décroissant.',
 'Donne la liste et le nombre des patients actifs majeurs avec au moins trois consultations closes, des impayés et aucune consultation close depuis 90 jours ; soldes du plus élevé au plus faible.',
])('retains every equivalent French compound predicate and its sort: %s',query=>{
 const c=frenchPatientCompoundContract(query);expect(c?.conditions.map(p=>p.field+':'+p.op+':'+p.value).sort()).toEqual([...conditions].sort());expect(c?.sort).toBe('outstanding_desc');expect(patientConditionsGrounded(c!.conditions,query)).toBe(true);
});
it.each([
 'Combien de patients sont actifs ? Parmi les actifs, combien n’ont pas de numéro d’identité, ont moins de 18 ans, et n’ont eu aucune consultation terminée dans les six derniers mois ? Donne chaque nombre séparément.',
 'Compte toute la patientèle active, puis séparément les actifs sans numéro d’identité, les actifs de moins de dix-huit ans et les actifs sans consultation terminée dans les six derniers mois.',
])('identifies all four expressly separate metric categories without turning them into an AND query: %s',query=>{
 const c=frenchPatientCountContract(query);expect(c?.clauses).toHaveLength(4);
 expect(countContractHints(c!).map(h=>h.conditions)).toEqual([[],['identity_card:missing'],['age:lt:18'],['no_completed_months:eq:6']]);
});
it.each([
 'Combien de patients sont actifs ? Parmi les actifs, combien n’ont pas de numéro d’identité, n’ont pas moins de dix-huit ans, et n’ont eu aucune consultation terminée dans les six derniers mois ? Donne chaque nombre séparément.',
 'Compte toute la patientèle active, puis séparément les actifs pas sans numéro d’identité, les actifs de moins de 18 ans et les actifs sans consultation terminée dans les six derniers mois.',
 'Combien de patients actifs sous antidépresseur ? Combien sont sans carte d’identité ? Combien sont mineurs ? Combien n’ont pas consulté depuis six derniers mois ? Donne chaque nombre séparément.',
 'Compte les patients actifs avec un téléphone renseigné, puis séparément les actifs sans numéro d’identité, les actifs de moins de 18 ans et les actifs sans consultation terminée dans les six derniers mois.',
 'Compte la patientèle active, puis séparément les actifs sans numéro d’identité et sans adresse électronique, les actifs de moins de 18 ans et les actifs sans consultation terminée dans les six derniers mois.',
])('does not silently drop an additional material filter from a separate-metric format: %s',query=>{
 expect(frenchPatientCountContract(query)).toBeNull();
});
it('rejects numeric thresholds invented from an adult or attendance condition',()=>{expect(patientConditionsGrounded([{field:'age',op:'gte',value:65}],text)).toBe(false);expect(patientConditionsGrounded([{field:'no_completed_days',op:'eq',value:60}],text)).toBe(false);});
it('blocks a native ledger that splits one compound population into unrelated partial filters before any SQL',async()=>{
 let i=0,reads=0;const steps=[calls('declare_request',{parts:[{id:'p1',goal:'Adultes',tool:'query_patients',conditions:['age:gte:65','completed_consultations:gte:3'],dependsOn:[]},{id:'p2',goal:'Solde',tool:'query_finance',conditions:['balance:gt:0'],dependsOn:[]}]}),calls('query_patients',{partIds:['p1'],mode:'list'})];
 const r=await runAgentLoop({...input,conversationId:'compound-omission'},{actor:'compound-omission',infer:async()=>{const step=steps[i++];if(!step)throw Error('No repair');return step;},execute:async call=>{reads++;return {callId:call.id,status:'empty',complete:true,text:'0 patients',evidence:[],conditionKeys:[]};}},new AbortController().signal);expect(reads).toBe(0);expect(r.status).not.toBe('completed');
});
it('keeps both requested outputs and every predicate in one sorted list query, even when the model omits sort',async()=>{
 let i=0;const executed:Record<string,unknown>[]=[];const steps=[calls('declare_request',{parts:['count','list'].map(id=>({id,goal:id,tool:'query_patients',conditions,dependsOn:[]}))}),calls('query_patients',{partIds:['count','list'],mode:'list'})];
 const r=await runAgentLoop({...input,conversationId:'compound-sorted'},{actor:'compound-sorted',infer:async()=>{const step=steps[i++];if(!step)throw Error('No more calls');return step;},execute:async call=>{executed.push(call.args);return {callId:call.id,status:'ok',complete:true,text:'3 patients',evidence:[],conditionKeys:conditions.map(c=>c.replace(':missing',':missing:null'))};}},new AbortController().signal);
 expect(executed).toHaveLength(1);expect(executed[0]).toMatchObject({mode:'list',sort:'outstanding_desc'});expect(executed[0]?.filters).toHaveLength(4);expect(r.parts).toHaveLength(2);expect(r.parts.every(p=>p.status==='answered')).toBe(true);
});

it('projects only the explicitly requested compound conditions and both outputs into native metadata',async()=>{
 let schema:Record<string,unknown>|undefined;
 await runAgentLoop({...input,conversationId:'compound-native-schema',text:text.replace('trois','quatre').replace('90','120')},{actor:'compound-native-schema',infer:async(_m,o)=>{schema=o.tools?.find(t=>t.function.name==='declare_request')?.function.parameters;throw Error('Capture only');},execute:async()=>{throw Error('No read');}},new AbortController().signal);
 const parts=(schema?.properties as Record<string,Record<string,unknown>>)?.parts;expect(parts?.minItems).toBe(2);expect(parts?.maxItems).toBe(2);const tuple=parts?.prefixItems as {properties:Record<string,unknown>}[];expect(tuple).toHaveLength(2);expect(parts).not.toHaveProperty('items');for(const row of tuple){expect(row.properties.tool).toMatchObject({enum:['query_patients']});expect(row.properties.conditions).toMatchObject({minItems:4,maxItems:4,prefixItems:[{const:'age:gte:18'},{const:'no_completed_days:eq:120'},{const:'completed_consultations:gte:4'},{const:'outstanding_balance:gt:0'}]});}
});
it('does not accept a single agenda answer as completion of four explicit application requests',async()=>{
 let i=0,reads=0;const steps=[calls('declare_request',{parts:[{id:'p1',goal:'Agenda',tool:'query_agenda',conditions:[],dependsOn:[]}]}),calls('query_agenda',{partIds:['p1'],period:'demain'})];
 const r=await runAgentLoop({...input,text:'Montre les rendez-vous de demain, identifie les dossiers administratifs incomplets, résume les champs manquants et prépare les corrections pour ma revue.',conversationId:'four-imperatives'},{actor:'four-imperatives',infer:async()=>{const step=steps[i++];if(!step)throw Error('No repair');return step;},execute:async call=>{reads++;return {callId:call.id,status:'ok',complete:true,text:'Deux rendez-vous',evidence:[],conditionKeys:[]};}},new AbortController().signal);
 expect(reads).toBe(0);expect(r.parts).toHaveLength(4);expect(r.status).not.toBe('completed');
});

it('offers only eligible part IDs to each native domain tool',async()=>{
 let i=0;const scoped:Record<string,unknown>={};await runAgentLoop({...input,text:'Montre les rendez-vous de demain et lis le profil du patient.',conversationId:'eligible-part-catalogue'},{actor:'eligible-part-catalogue',infer:async(_m,o)=>{if(i++===0)return calls('declare_request',{parts:[{id:'agenda',goal:'Montre les rendez-vous de demain',tool:'query_agenda',conditions:[],dependsOn:[]},{id:'profile',goal:'lis le profil du patient.',tool:'get_patient_context',conditions:[],dependsOn:[]}]});for(const t of o.tools??[]){const props=t.function.parameters.properties as Record<string,unknown>;scoped[t.function.name]=props?.partIds;}throw Error('Capture only');},execute:async()=>{throw Error('No read');}},new AbortController().signal);expect(scoped.query_agenda).toMatchObject({items:{enum:['agenda']}});expect(scoped.get_patient_context).toMatchObject({items:{enum:['profile']}});
});
it('preserves admission of a supported period expressed in French words',()=>{expect(patientConditionsGrounded([{field:'no_completed_months',op:'eq',value:3}],'Patients sans consultation depuis trois mois')).toBe(true);});

it('keeps administrative review on the patient reader and binds it to the agenda prerequisite',()=>{const original='Montre les rendez-vous de demain, identifie les patients avec un dossier administratif incomplet, résume les champs manquants et prépare les corrections pour ma revue.';const goals=frenchRequestedOutputs(original)!;const parts=goals.map((goal,i)=>({id:'p'+i,goal,tools:[i===0?'query_agenda':'query_patients'] as ('query_agenda'|'query_patients')[],conditions:[],dependsOn:[],status:'pending' as const,resultRefs:[]}));const valid=constrainRequestedOutputs(parts,goals);expect(valid[1]?.dependsOn).toEqual(['p0']);expect(valid[2]?.conditions).toEqual([{field:'administrative_incomplete',op:'eq',value:true}]);expect(()=>constrainRequestedOutputs(parts.map((p,i)=>i===2?{...p,tools:['query_documents']}:p),goals)).toThrow();});

it('projects each requested count into its own native tuple without losing unknown-filter reporting',async()=>{let schema:Record<string,unknown>|undefined;await runAgentLoop({...input,text:'Combien de patients actifs, combien de patients sans identité et combien sont mineurs ?',conversationId:'count-tuples'},{actor:'count-tuples',infer:async(_m,o)=>{schema=o.tools?.[0]?.function.parameters;throw Error('Capture only');},execute:async()=>{throw Error('No read');}},new AbortController().signal);const parts=(schema?.properties as Record<string,Record<string,unknown>>)?.parts;const tuple=parts?.prefixItems as {properties:Record<string,unknown>}[];expect(tuple).toHaveLength(3);expect(parts).not.toHaveProperty('items');expect(tuple[1]?.properties.conditions).toMatchObject({prefixItems:[{const:'identity_card:missing'}]});expect(tuple[1]?.properties).toHaveProperty('unsupportedConditions');});
it('projects a count operation for a patient sub-question inside a mixed request',async()=>{let i=0,mode:unknown;await runAgentLoop({...input,text:'Compte les patients actifs et montre les rendez-vous de demain.',conversationId:'mixed-count-operation'},{actor:'mixed-count-operation',infer:async(_m,o)=>{if(i++===0)return calls('declare_request',{parts:[{id:'n',goal:'Compte les patients actifs',tool:'query_patients',conditions:[],dependsOn:[]},{id:'a',goal:'montre les rendez-vous de demain.',tool:'query_agenda',conditions:[],dependsOn:[]}]});const props=o.tools?.find(t=>t.function.name==='query_patients')?.function.parameters.properties as Record<string,unknown>;mode=props?.mode;throw Error('Capture only');},execute:async()=>{throw Error('No read');}},new AbortController().signal);expect(mode).toMatchObject({enum:['count']});});
