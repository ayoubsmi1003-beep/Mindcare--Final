import {describe, expect, it} from 'vitest';
import {evaluateAlexaCase} from '../eval/evaluate-alexa-agent.mjs';

const patient = {type:'patient',id:'patient-a',provenance:{gate:'get_patient'}};
const baseSpec = {
 id:'strict-fr',scenario:1,language:'fr',permittedToolSequence:[],timing:{deadlineMs:90000},
 expectedManifest:{requiredParts:[],filters:[]},expected:{status:'completed'},
};
const baseRecord = {
 events:[{type:'done',status:'completed',parts:[]}],calls:[],queries:[],ms:10,
};
const specWith = (expected:Record<string,unknown>) => ({...baseSpec,expected:{...baseSpec.expected,...expected}});
const countSpec = specWith({count:25,rpcResults:[{name:'search_patients',args:{p_spec:{mode:'count'}},path:['total'],equals:25}]});
const countRecord = {
 ...baseRecord,events:[...baseRecord.events,{type:'sentence',kind:'fact',text:'25 patients actifs.',sources:[]}],
 queries:[{name:'search_patients',args:{p_spec:JSON.stringify({mode:'count',filters:[]})},response:{ok:true,data:[{total:25}]}}],
};

describe('preuves des réponses RPC',()=>{
 it('accepte un total exact avec arguments JSON et résultat direct ou enveloppé',()=>{
  expect(evaluateAlexaCase(countSpec,countRecord).status).toBe('PASS');
  const wrapped={...countRecord,queries:[{...countRecord.queries[0],response:{ok:true,data:[{search_patients:{total:25}}]}}]};
  expect(evaluateAlexaCase(countSpec,wrapped).status).toBe('PASS');
 });
 it.each([
  ['total erroné',{ok:true,data:[{total:24}]}],
  ['échec explicite',{ok:false,error:{code:'42501',message:'Refus'}}],
  ['réponse absente',undefined],
  ['données absentes',{ok:true}],
  ['réponse vide',{ok:true,data:[]}],
 ])('rejette un chiffre visible sans preuve autoritaire : %s',(_name,response)=>{
  const record={...countRecord,queries:[{...countRecord.queries[0],response}]};
  expect(evaluateAlexaCase(countSpec,record).failures).toContain('authoritative RPC result: search_patients total');
 });
 it('rejette une opération absente ou de mauvais arguments malgré une réponse correcte ailleurs',()=>{
  expect(evaluateAlexaCase(countSpec,{...countRecord,queries:[]}).status).toBe('FAIL');
  const wrong={...countRecord.queries[0],args:{p_spec:JSON.stringify({mode:'list'})}};
  expect(evaluateAlexaCase(countSpec,{...countRecord,queries:[wrong]}).status).toBe('FAIL');
 });
 it('accepte p_spec objet et refuse p_spec invalide sans interrompre le rapport',()=>{
  const object={...countRecord,queries:[{...countRecord.queries[0],args:{p_spec:{mode:'count'}}}]};
  expect(evaluateAlexaCase(countSpec,object).status).toBe('PASS');
  const malformed={...countRecord,queries:[{...countRecord.queries[0],args:{p_spec:'{invalide'}}]};
  expect(evaluateAlexaCase(countSpec,malformed).status).toBe('FAIL');
 });
 it('accepte une réponse correcte parmi plusieurs opérations de même nom',()=>{
  const queries=[{...countRecord.queries[0],response:{ok:true,data:[{total:3}]}},...countRecord.queries];
  expect(evaluateAlexaCase(countSpec,{...countRecord,queries}).status).toBe('PASS');
 });
 const listSpec=specWith({rpcResults:[{name:'search_patients',path:['rows'],pluck:'id',equals:['patient-b','patient-a']}]});
 const listRecord={...baseRecord,queries:[{name:'search_patients',args:{},response:{ok:true,data:[{rows:[{id:'patient-b'},{id:'patient-a'}]}]}}]};
 it('accepte une liste complète et ordonnée',()=>expect(evaluateAlexaCase(listSpec,listRecord).status).toBe('PASS'));
 it.each([
  ['mauvais membre',['patient-b','patient-c']],['ordre inversé',['patient-a','patient-b']],
  ['doublon supplémentaire',['patient-b','patient-a','patient-a']],['liste tronquée',['patient-b']],
 ])('rejette une liste incorrecte : %s',(_name,ids)=>{
  const queries=[{...listRecord.queries[0],response:{ok:true,data:[{rows:ids.map(id=>({id}))}]}}];
  expect(evaluateAlexaCase(listSpec,{...listRecord,queries}).status).toBe('FAIL');
 });
 it('compare les objets JSON sans dépendre de l’ordre des clés et conserve les types',()=>{
  const spec=specWith({rpcResults:[{name:'get_patient',path:[],equals:{id:'patient-a',phone:'0550000000'}}]});
  const record={...baseRecord,queries:[{name:'get_patient',args:{},response:{ok:true,data:[{phone:'0550000000',id:'patient-a'}]}}]};
  expect(evaluateAlexaCase(spec,record).status).toBe('PASS');
  expect(evaluateAlexaCase(specWith({rpcResults:[{name:'get_patient',path:['phone'],equals:550000000}]}),record).status).toBe('FAIL');
 });
 it.each(['area','query','excerpt'])('rejette une note dont %s est incorrect',field=>{
  const spec=specWith({rpcResults:[{name:'get_note',args:{p_spec:{area:'subjective',query:'sommeil'}},path:['notes','0','excerpt'],equals:'Sommeil amélioré.'}]});
  const query={name:'get_note',args:{p_spec:JSON.stringify({area:field==='area'?'objective':'subjective',query:field==='query'?'appétit':'sommeil'})},response:{ok:true,data:[{notes:[{excerpt:field==='excerpt'?'Appétit stable.':'Sommeil amélioré.'}]}]}};
  expect(evaluateAlexaCase(spec,{...baseRecord,queries:[query]}).status).toBe('FAIL');
 });
 it('suit un index numérique explicite dans un résultat de note',()=>{
  const spec=specWith({rpcResults:[{name:'get_note',args:{p_spec:{area:'subjective',query:'sommeil'}},path:['notes','0','excerpt'],equals:'Sommeil amélioré.'}]});
  const record={...baseRecord,queries:[{name:'get_note',args:{p_spec:JSON.stringify({area:'subjective',query:'sommeil'})},response:{ok:true,data:[{notes:[{excerpt:'Sommeil amélioré.'}]}]}}]};
  expect(evaluateAlexaCase(spec,record).status).toBe('PASS');
 });
});

describe('sources et champs réellement émis',()=>{
 const spec=specWith({sourceRefs:[patient],responseFields:[{label:'Téléphone',value:'0550000000',source:patient}]});
 const record={...baseRecord,events:[...baseRecord.events,{type:'sentence',kind:'fact',text:'Téléphone : 0550000000.',sources:[patient]}]};
 it('accepte une valeur factuelle avec libellé et source du même patient',()=>expect(evaluateAlexaCase(spec,record).status).toBe('PASS'));
 it.each([
  ['mauvais patient',{...patient,id:'patient-b'}],
  ['mauvais type',{...patient,type:'query'}],
  ['mauvaise porte',{...patient,provenance:{gate:'search_patients'}}],
 ])('rejette une source incorrecte : %s',(_name,source)=>{
  const events=[...baseRecord.events,{type:'sentence',kind:'fact',text:'Téléphone : 0550000000.',sources:[source]}];
  const result=evaluateAlexaCase(spec,{...baseRecord,events});
  expect(result.failures).toContain('emitted source: patient patient-a');
  expect(result.failures).toContain('sourced response field: Téléphone');
 });
 it.each([
  'Téléphone : 0660000000. Téléphone alternatif : 0550000000.',
  'Téléphone alternatif : 0550000000.', 'phone_alt : 0550000000.',
  'Téléphone : 05500000001.', 'AncienTéléphone : 0550000000.',
  'Téléphone. 0550000000.', 'Téléphone : 0550000000a.', 'Téléphone : 0550000000.5.',
 ])('rejette une valeur appartenant à un autre champ ou hors limite : %s',text=>{
  const events=[...baseRecord.events,{type:'sentence',kind:'fact',text,sources:[patient]}];
  expect(evaluateAlexaCase(spec,{...baseRecord,events}).failures).toContain('sourced response field: Téléphone');
 });
 it('ne confond pas phone et phone_alt',()=>{
  const spec=specWith({responseFields:[{label:'phone',value:'0550000000',source:patient}]});
  const events=[...baseRecord.events,{type:'sentence',kind:'fact',text:'phone_alt: 0550000000.',sources:[patient]}];
  expect(evaluateAlexaCase(spec,{...baseRecord,events}).status).toBe('FAIL');
 });
 it('ne prend pas une source située dans une autre phrase événement comme preuve du champ',()=>{
  const events=[...baseRecord.events,{type:'sentence',kind:'fact',text:'Téléphone : 0550000000.',sources:[{...patient,id:'patient-b'}]},{type:'sentence',kind:'fact',text:'Adresse : Alger.',sources:[patient]}];
  expect(evaluateAlexaCase(spec,{...baseRecord,events}).failures).toContain('sourced response field: Téléphone');
 });
 it('rejette une attribution ambiguë à deux patients dans le même événement',()=>{
  const events=[...baseRecord.events,{type:'sentence',kind:'fact',text:'Téléphone : 0550000000.',sources:[patient,{...patient,id:'patient-b'}]}];
  expect(evaluateAlexaCase(spec,{...baseRecord,events}).status).toBe('FAIL');
 });
 it.each(['inference','knowledge',undefined])('ne qualifie pas le champ brut avec kind=%s',kind=>{
  const events=[...baseRecord.events,{type:'sentence',kind,text:'Téléphone : 0550000000.',sources:[patient]}];
  expect(evaluateAlexaCase(spec,{...baseRecord,events}).failures).toContain('sourced response field: Téléphone');
 });
 it('accepte des références knowledge effectivement émises sans exiger un fait patient',()=>{
  const spec=specWith({sourceRefs:[{type:'knowledge',id:'book-1',provenance:{page:12}}]});
  const events=[...baseRecord.events,{type:'sentence',kind:'knowledge',text:'Référence approuvée.',sources:[{type:'knowledge',id:'book-1',provenance:{page:12,approved:'yes'}}]}];
  expect(evaluateAlexaCase(spec,{...baseRecord,events}).status).toBe('PASS');
 });
});

it('accepte une source sans provenance lorsque le contrat ne l’exige pas',()=>{
 const source={type:'patient',id:'patient-a'};
 const spec=specWith({sourceRefs:[source],responseFields:[{label:'Téléphone',value:'0550000000',source}]});
 const events=[...baseRecord.events,{type:'sentence',kind:'fact',text:'Téléphone : 0550000000.',sources:[source]}];
 expect(evaluateAlexaCase(spec,{...baseRecord,events}).status).toBe('PASS');
});

it('traite les caractères spéciaux des libellés littéralement et la valeur avec sa casse exacte',()=>{
 const spec=specWith({responseFields:[{label:'Référence (document)',value:'DOC-A1',source:patient}]});
 const events=[...baseRecord.events,{type:'sentence',kind:'fact',text:'Référence (document) : DOC-A1.',sources:[patient]}];
 expect(evaluateAlexaCase(spec,{...baseRecord,events}).status).toBe('PASS');
 const lower=[...baseRecord.events,{type:'sentence',kind:'fact',text:'Référence (document) : doc-a1.',sources:[patient]}];
 expect(evaluateAlexaCase(spec,{...baseRecord,events:lower}).status).toBe('FAIL');
});

it('conserve la compatibilité legacy sans transformer des flags déclaratifs en qualification',()=>{
 const result=evaluateAlexaCase(specWith({count:25,assertions:{correctSources:true,noPrivateEgress:true}}),{...countRecord,queries:[]});
 expect(result.status).toBe('PASS');
 expect(result.qualification).toMatchObject({authoritativeResults:'NOT RUN',sourceRefs:'NOT RUN',responseFields:'NOT RUN',privacy:'NOT RUN',voice:'NOT RUN',manual:'NOT RUN'});
 expect(evaluateAlexaCase(countSpec,countRecord).qualification.authoritativeResults).toBe('PASS');
});

it('rejects an extra clinical source when qualifying an exact filtered record set',()=>{const spec=specWith({sourceSets:[{type:'diagnostic',ids:['active-one']}]});const good={...baseRecord,events:[...baseRecord.events,{type:'sentence',kind:'fact',text:'Diagnostic actif.',sources:[{type:'diagnostic',id:'active-one'}]}]};expect(evaluateAlexaCase(spec,good).status).toBe('PASS');const wrong={...good,events:[...good.events,{type:'sentence',kind:'fact',text:'Diagnostic résolu.',sources:[{type:'diagnostic',id:'resolved-one'}]}]};expect(evaluateAlexaCase(spec,wrong).failures).toContain('exact emitted record set: diagnostic');});
it.each([[],[{type:'proposal',tool:'create_document_draft',args:{patientId:'patient-a',documentType:'certificat_medical'}}],[{type:'proposal',tool:'create_editable_document_draft',args:{patientId:'patient-b',documentType:'certificat_medical'}}]].map(proposals=>[proposals]))('requires the exact proposed business action, not a terminal label alone',proposals=>{const spec=specWith({status:'needs_confirmation',proposal:{tool:'create_editable_document_draft',args:{patientId:'patient-a',documentType:'certificat_medical'}}});const record={...baseRecord,events:[{type:'done',status:'needs_confirmation',parts:[{id:'a',status:'proposed',resultRefs:['r']}]},...proposals]};expect(evaluateAlexaCase(spec,record).failures).toContain('exact action proposal');});
it('qualifies a single exact reviewable proposal with no business execution',()=>{const proposal={tool:'create_editable_document_draft',args:{patientId:'patient-a',documentType:'certificat_medical',variables:'{}'}};const spec=specWith({status:'needs_confirmation',proposal,noBusinessWrite:true});const record={...baseRecord,events:[{type:'done',status:'needs_confirmation',parts:[{id:'a',status:'proposed',resultRefs:['r']}]},{type:'proposal',...proposal}]};expect(evaluateAlexaCase(spec,record).status).toBe('PASS');expect(evaluateAlexaCase(spec,{...record,events:[...record.events,{type:'proposal',...proposal}]}).failures).toContain('exact action proposal');});

it('distinguishes all agenda patients from the subset with administrative gaps',()=>{const spec={...baseSpec,scenario:23,expectedManifest:{requiredParts:['tomorrow_agenda','administrative_gaps','missing_fields','review_corrections'],filters:[]},expected:{status:'completed',reviewOnly:true,agendaCount:2,agendaPatientIds:['patient-a','patient-b'],findingPatientIds:['patient-b']}};const parts=['Agenda demain','Dossiers administratifs incomplets','Champs manquants','Corrections pour revue'].map((goal,i)=>({id:'p'+i,goal,status:'answered',conditions:[],resultRefs:['r']}));const record={...baseRecord,events:[{type:'done',status:'completed',parts},{type:'sentence',kind:'fact',text:'Aucune correction n’a été enregistrée.',sources:[{type:'appointment',id:'appointment-a'},{type:'appointment',id:'appointment-b'},{type:'patient',id:'patient-b'}]}],queries:[{name:'search_patients',args:{p_spec:JSON.stringify({mode:'review',patientIds:['patient-a','patient-b']})}}]};expect(evaluateAlexaCase(spec,record).status).toBe('PASS');expect(evaluateAlexaCase(spec,{...record,queries:[{name:'search_patients',args:{p_spec:JSON.stringify({mode:'review',patientIds:['patient-b']})}}]}).failures).toContain('administrative review scoped to agenda patients');});

it('rejects altered diagnostic labels even when every expected source ID remains present',()=>{const spec=specWith({sourceSets:[{type:'diagnostic',ids:['diag-one']}],textIncludes:['Diagnostic FICTIF attendu','FICTIF-1','non résolu']});const record={...baseRecord,events:[...baseRecord.events,{type:'sentence',kind:'fact',text:'Diagnostic enregistré : Diagnostic FICTIF attendu (FICTIF-1) · non résolu.',sources:[{type:'diagnostic',id:'diag-one'}]}]};expect(evaluateAlexaCase(spec,record).status).toBe('PASS');const wrong={...record,events:[record.events[0],{...record.events[1],text:'Diagnostic enregistré : contenu remplacé.'}]};expect(evaluateAlexaCase(spec,wrong).status).toBe('FAIL');});
