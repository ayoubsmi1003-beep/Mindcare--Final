import {it,expect} from 'vitest';
import {evaluateAlexaCase} from '../eval/evaluate-alexa-agent.mjs';
it('does not qualify a count-only request that exposes a list or duplicates the question',()=>{
 const spec={id:'count-only',scenario:2,language:'fr',permittedToolSequence:[['query_patients']],timing:{deadlineMs:90000},expectedManifest:{requiredParts:['missing_identity_card'],filters:[]},expected:{count:25,patientModes:['count','metrics'],exactParts:1,noPatientRecords:true}};
 const part={id:'a',goal:'Sans identité',conditions:[{field:'identity_card',op:'missing',value:null}],status:'answered',resultRefs:['c']};
 const record={events:[{type:'done',status:'completed',parts:[part,{...part,id:'b'}]},{type:'sentence',text:'25 patients',sources:[{type:'patient',id:'one'}]}],calls:[],queries:[{name:'search_patients',args:{p_spec:JSON.stringify({mode:'list'})}}],ms:10};
 const result=evaluateAlexaCase(spec,record);
 expect(result.status).toBe('FAIL');expect(result.failures).toContain('requested patient operation');expect(result.failures).toContain('exact requested output count');expect(result.failures).toContain('count-only response omits patient records');
 const correct={...record,events:[{type:'done',status:'completed',parts:[part]},{type:'sentence',text:'25 patients',sources:[]}],queries:[{name:'search_patients',args:{p_spec:JSON.stringify({mode:'count'})}}]};
 expect(evaluateAlexaCase(spec,correct).status).toBe('PASS');
});
import manifest from '../eval/alexa-agent-cases.json';
it('checks the material conditions of each metric independently of its label',()=>{
 const spec=manifest.cases.find(c=>c.id==='21-fr')!;
 const names=['Patients actifs','Sans identité','Enfants','Sans visite six mois'];
 const conditions=[[{field:'identity_card',op:'missing',value:null}],[{field:'phone',op:'missing',value:null}],[{field:'age',op:'lt',value:18}],[{field:'outstanding_balance',op:'gt',value:0}]];
 const parts=names.map((goal,i)=>({id:'p'+i,goal,conditions:conditions[i],status:'budget_limited',resultRefs:[],reason:'Limite'}));
 const result=evaluateAlexaCase(spec,{events:[{type:'done',status:'failed',parts}],calls:[],queries:[],ms:10});
 expect(result.failures).toContain('requested conditions preserved: active');expect(result.failures).toContain('requested conditions preserved: missing_identity_card');expect(result.failures).toContain('requested conditions preserved: not_seen_6m');
 expect(result.metrics.filterPreservation).toEqual({correct:1,total:4});
});
it('scores missing requested questions against the independent manifest even if the model ledger says completed',()=>{
 const spec=manifest.cases.find(c=>c.id==='21-fr')!;
 const result=evaluateAlexaCase(spec,{events:[{type:'done',status:'completed',parts:[{id:'a',goal:'Patients actifs',conditions:[],status:'answered',resultRefs:['c']}]},{type:'sentence',text:'Patients actifs : 32\nSans numéro de pièce d’identité : 25\nEnfants : 1\nSans visite six mois : 24',sources:[]}],calls:[],queries:[],ms:10});
 expect(result.status).toBe('FAIL');expect(result.metrics.partIdentification.correct).toBe(1);expect(result.metrics.partIdentification.total).toBe(4);
});

it.each(['23-fr','24-fr'])('does not equate a sufficiently long unrelated ledger with requested-output identification: %s',id=>{
 const spec=manifest.cases.find(c=>c.id===id)!;
 const result=evaluateAlexaCase(spec,{events:[{type:'done',status:'partial',parts:Array.from({length:4},(_,i)=>({id:'p'+i,goal:'patients actifs',conditions:[],status:'answered',resultRefs:['c']}))}],calls:[],queries:[],ms:10});
 expect(result.status).toBe('FAIL');expect(result.metrics.partIdentification.correct).toBeLessThan(4);
});
it('rejects compound filters split between independent queries',()=>{
 const spec=manifest.cases.find(c=>c.id==='22-fr')!;
 const result=evaluateAlexaCase(spec,{events:[{type:'done',status:'completed',parts:[]},{type:'sentence',text:'3 patients, 2000,1500,1500',sources:[]}],calls:[],queries:spec.expectedManifest.filters.map(c=>({name:'search_patients',args:{p_spec:JSON.stringify({filters:[c],sort:'outstanding_desc'})}})),ms:10});
 expect(result.failures).toContain('all compound predicates in one query');
});

it('reports correctness separately from the original latency assertion without changing its verdict',()=>{
 const spec={id:'slow-correct',scenario:2,language:'fr',permittedToolSequence:[['query_patients']],timing:{deadlineMs:90000},expectedManifest:{requiredParts:[],filters:[]},expected:{count:25,status:'completed'}};
 const record={events:[{type:'done',status:'completed',parts:[]},{type:'sentence',text:'25 patients',sources:[]}],calls:[],queries:[],ms:93000,requestBudgetMs:360000};
 const result=evaluateAlexaCase(spec,record);
 expect(result.status).toBe('FAIL');expect(result.failures).toContain('request deadline');
 expect(result.correctness).toEqual({status:'PASS',failures:[]});
 expect(result.timing).toMatchObject({legacyTargetMs:90000,requestBudgetMs:360000,legacyTargetStatus:'FAIL',requestBudgetStatus:'PASS',ms:93000});
 const wrong=evaluateAlexaCase(spec,{...record,events:[{type:'done',status:'failed',parts:[]}]});
 expect(wrong.correctness.status).toBe('FAIL');expect(wrong.correctness.failures).toContain('exact count visible');
 const over=evaluateAlexaCase(spec,{...record,ms:363000});expect(over.timing.requestBudgetStatus).toBe('FAIL');
});

it('rejects a tautological public answer that lacks independently expected causal concepts',()=>{
 const spec={id:'causal-quality',scenario:1,language:'fr',permittedToolSequence:[],timing:{deadlineMs:90000},expectedManifest:{requiredParts:[],filters:[]},expected:{status:'completed',responseConcepts:[['gravitation','gravité','attraction'],['vitesse','inertie','mouvement']]}};
 const record={events:[{type:'done',status:'completed',parts:[]},{type:'sentence',text:'La Lune tourne car elle est orbitante.'}],calls:[],queries:[],ms:10};
 expect(evaluateAlexaCase(spec,record).status).toBe('FAIL');
 expect(evaluateAlexaCase(spec,{...record,events:[record.events[0],{type:'sentence',text:'La gravité attire la Lune ; sa vitesse maintient son orbite.'}]}).status).toBe('PASS');
});
it('rejects general answers with contradicted facts or English code-switching',()=>{
 const spec={id:'general-quality',scenario:26,language:'fr',permittedToolSequence:[],timing:{deadlineMs:240000},expectedManifest:{requiredParts:[],filters:[]},expected:{status:'completed',responseLanguage:'fr',responseConcepts:[['fusion nucléaire','produit sa propre lumière'],['planète','orbite']],responseMustNotContain:['sans masse']}};
 const events=[{type:'done',status:'completed',parts:[]},{type:'sentence',text:'Une étoile produit sa propre lumière par fusion nucléaire ; une planète orbite autour d’elle, in motion.'}];
 const result=evaluateAlexaCase(spec,{events,calls:[],queries:[],ms:10});
 expect(result.status).toBe('FAIL');expect(result.failures).toContain('response language is French');
 const falseFact={...events[1],text:'Une étoile produit sa propre lumière par fusion nucléaire, mais elle est sans masse. Une planète orbite autour d’elle.'};
 const falseResult=evaluateAlexaCase(spec,{events:[events[0],falseFact],calls:[],queries:[],ms:10});expect(falseResult.failures).toContain('forbidden response claim: sans masse');
});

it('rejects four correctly labelled but failed parts with no agenda or administrative read',()=>{
 const spec=manifest.cases.find(c=>c.id==='23-fr')!;const goals=['Agenda de demain','Dossiers administratifs incomplets','Champs manquants','Corrections pour revue'];const record={events:[{type:'done',status:'failed',parts:goals.map((goal,i)=>({id:'p'+i,goal,conditions:[],status:'failed',resultRefs:[],reason:'Model unavailable'}))}],calls:[],queries:[],ms:10};const result=evaluateAlexaCase(spec,record);expect(result.status).toBe('FAIL');expect(result.failures).toContain('supported administrative workflow completed');expect(result.failures).toContain('administrative review scoped to agenda patients');
});

it('requires the stated database fault to have been exercised rather than accepting an unrelated failure',()=>{const spec=manifest.cases.find(c=>c.id==='24-fr')!;const parts=['Patients actifs','Agenda demain','Consultations terminées','Encaissements'].map((goal,i)=>({id:'p'+i,goal,conditions:[],status:i<3?'answered':'failed',resultRefs:['r'+i],reason:i===3?'Failure':undefined}));const record={events:[{type:'done',status:'partial',parts},{type:'sentence',text:'32 patients, 2 rendez-vous, 26 consultations'}],calls:[],queries:[],ms:10};expect(evaluateAlexaCase(spec,record).failures).toContain('expected database fault actually exercised');});
