import {expect,it} from 'vitest';
import {assessMixedAppAnswer} from '../../scripts/lib/alexa-eval-mixed-meaning.mjs';

const missingId={mode:'count',filters:[{field:'identity_card',op:'missing',value:null}]};
const missingPhone={mode:'count',filters:[{field:'phone',op:'missing',value:null}]};

it('checks distinct patient counts and their labels against exact filter reads',()=>{
 const expected={checks:[
  {kind:'patients',query:missingId,result:{total:24},terms:['CNI','carte d’identité']},
  {kind:'patients',query:missingPhone,result:{total:13},terms:['téléphone']},
 ]};
 const queries=[
  {name:'search_patients',args:{p_spec:JSON.stringify(missingId)},response:{ok:true,data:[{total:24,rows:[]}]}},
  {name:'search_patients',args:{p_spec:JSON.stringify(missingPhone)},response:{ok:true,data:[{total:13,rows:[]}]}}
 ];
 expect(assessMixedAppAnswer({},expected,queries,[],[],'Sans CNI : 24 patients. Sans téléphone : 13 patients.')).toEqual([]);
 expect(assessMixedAppAnswer({},expected,[queries[0],{...queries[1],args:{p_spec:JSON.stringify({mode:'count',filters:[]})}}],[],[],'Sans CNI : 24 patients. Sans téléphone : 13 patients.')).toContain('mixed-app-constraint-not-preserved');
});

it('checks amount and appointment count separately for a mixed finance-agenda answer',()=>{
 const expected={checks:[
  {kind:'records',domain:'finance',query:{mode:'totals',state:'collected',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'},result:{total:3,amount:9000},terms:['encaissements','recettes'],unit:'DZD'},
  {kind:'records',domain:'agenda',query:{from:'2026-10-24T00:00:00+01:00',to:'2026-10-25T00:00:00+01:00'},result:{total:7,ids:[]},terms:['rendez-vous','rdv']}
 ]};
 const queries=[
  {name:'query_alexa_records',args:{p_domain:'finance',p_spec:JSON.stringify(expected.checks[0]!.query)},response:{ok:true,data:[{total:3,totals:{amount:9000}}]}},
  {name:'query_alexa_records',args:{p_domain:'agenda',p_spec:JSON.stringify(expected.checks[1]!.query)},response:{ok:true,data:[{total:7,rows:[]}]}}
 ];
 expect(assessMixedAppAnswer({},expected,queries,[],[],'Les encaissements du mois atteignent 9 000 DZD. Demain, 7 rendez-vous sont prévus.')).toEqual([]);
 expect(assessMixedAppAnswer({},expected,queries.slice(0,1),[],[],'Les encaissements du mois atteignent 9 000 DZD. Demain, 7 rendez-vous sont prévus.')).toContain('mixed-app-independent-read-missing');
});

it('checks that requested patient names are shown from the independently expected page',()=>{
 const expected={checks:[{kind:'patients',query:{mode:'list',filters:[{field:'identity_card',op:'missing',value:null}]},result:{total:2,ids:['a','b'],names:['Lina Test','Nadia Test']},terms:['CNI','patients'],listLimit:2}]};
 const query={name:'search_patients',args:{p_spec:JSON.stringify(expected.checks[0]!.query)},response:{ok:true,data:[{total:2,rows:[{id:'a',first_name:'Lina',last_name:'Test'},{id:'b',first_name:'Nadia',last_name:'Test'}]}]}};
 expect(assessMixedAppAnswer({},expected,[query],[],[],'Il y a 2 patients sans CNI : Lina Test et Nadia Test.')).toEqual([]);
 expect(assessMixedAppAnswer({},expected,[{...query,response:{ok:true,data:[{total:2,rows:[{id:'a',first_name:'Lina',last_name:'Test'}]}]}}],[],[],'Il y a 2 patients sans CNI : Lina Test et Patient-b1234567.')).toContain('mixed-app-page-membership-mismatch');
});

it('recognizes the identity-card label and collected finance total returned by their read gates',()=>{
 const financeQuery={mode:'totals',state:'collected',from:'2026-10-01T00:00:00+01:00',to:'2026-11-01T00:00:00+01:00'};
 const expected={checks:[
  {kind:'patients',query:missingId,result:{total:308},terms:['CNI']},
  {kind:'records',domain:'finance',query:financeQuery,result:{total:0,amount:0},terms:['encaissements','recettes'],unit:'DZD'}
 ]};
 const queries=[
  {name:'search_patients',args:{p_spec:JSON.stringify(missingId)},response:{ok:true,data:[{total:308,rows:[]}]}},
  {name:'query_alexa_records',args:{p_domain:'finance',p_spec:JSON.stringify(financeQuery)},response:{ok:true,data:[{total:0,totals:{collectedDzd:0}}]}}
 ];
 expect(assessMixedAppAnswer({},expected,queries,[],[],'308 patients n’ont pas de numéro de carte d’identité renseigné. Le montant encaissé est de 0 DZD.')).toEqual([]);
});
