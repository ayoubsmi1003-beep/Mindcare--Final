import {expect,it} from 'vitest';
import {assessFinanceView} from '../../scripts/lib/alexa-eval-view-meaning.mjs';

it('accepts the independently verified total for punctual charges',()=>{
 const expected={punctualPeriod:1200,recurringMonthly:500};
 const queries=[{name:'get_charges_list',response:{ok:true,data:[{lignes:[],total_ponctuel_periode:1200,total_recurrent_mensuel:500}]}}];
 expect(assessFinanceView({view:'charges'},expected,queries,[],'Les charges ponctuelles de la période totalisent 1 200 DZD.')).toEqual([]);
});
it('rejects an app finance gate result or answer with an incorrect amount',()=>{
 const expected={punctualPeriod:1200,recurringMonthly:500};
 const queries=[{name:'get_charges_list',response:{ok:true,data:[{lignes:[],total_ponctuel_periode:1700,total_recurrent_mensuel:500}]}}];
 expect(assessFinanceView({view:'charges'},expected,queries,[],'Les charges ponctuelles totalisent 1 200 DZD.')).toContain('independent-finance-charge-total');
});
it('checks recurrent charge membership against independent IDs and names',()=>{
 const expected={recurringRows:[{id:'a',name:'Loyer mensuel'},{id:'b',name:'Internet'}]};
 const queries=[{name:'get_charges_list',response:{ok:true,data:[{lignes:[{id:'a',intitule:'Loyer mensuel',type:'recurrente'},{id:'b',intitule:'Internet',type:'recurrente'}] } ]}}];
 expect(assessFinanceView({view:'recurring_charges'},expected,queries,[],'Les charges récurrentes enregistrées sont le loyer mensuel et Internet.')).toEqual([]);
 expect(assessFinanceView({view:'recurring_charges'},expected,[{...queries[0],response:{ok:true,data:[{lignes:[{id:'a',intitule:'Loyer mensuel',type:'recurrente'}]}]}}],[],'Le loyer mensuel est enregistré.')).toContain('independent-recurring-charge-membership');
});
it('calculates created payment totals from the authorized gate totals fields',()=>{
 const expected={createdAmount:150,collectedAmount:50};
 const queries=[
  {name:'query_alexa_records',args:{p_spec:JSON.stringify({mode:'totals',state:'all'})},response:{ok:true,data:[{totals:{pendingDzd:100,collectedDzd:50,unpriced:0}}]}},
  {name:'query_alexa_records',args:{p_spec:JSON.stringify({mode:'totals',state:'collected'})},response:{ok:true,data:[{totals:{pendingDzd:0,collectedDzd:50,unpriced:0}}]}},
 ];
 const calls=[{name:'query_finance',args:{mode:'totals'}}];
 expect(assessFinanceView({view:'compare_dates'},expected,queries,calls,'En octobre 2026, 150 DZD de paiements ont été créés et 50 DZD encaissés.')).toEqual([]);
});
it('requires the completed-consultation filter for an unpriced count',()=>{
 const expected={unpricedCount:4},query={name:'query_alexa_records',args:{p_spec:JSON.stringify({mode:'totals',state:'all'})},response:{ok:true,data:[{totals:{pendingDzd:0,collectedDzd:0,unpriced:4}}]}};
 const answer='4 consultations terminées sans tarif enregistré.';
 expect(assessFinanceView({view:'unpriced'},expected,[query],[],answer)).toContain('unpriced-consultation-status-missing');
 const scoped={...query,args:{p_spec:JSON.stringify({mode:'totals',state:'all',consultationStatus:'closed'})}};
 expect(assessFinanceView({view:'unpriced'},expected,[scoped],[],answer)).toEqual([]);
});
it('uses a pending-state payment read as the independent oracle for all-time outstanding balance',()=>{
 const expected={outstandingAmount:3500,outstandingCount:2},query={name:'query_alexa_records',args:{p_spec:JSON.stringify({mode:'totals',state:'pending'})},response:{ok:true,data:[{totals:{pendingDzd:3500,collectedDzd:0,unpriced:0}}]}};
 expect(assessFinanceView({view:'outstanding'},expected,[query],[],'Le solde restant à encaisser est de 3 500 DZD.')).toEqual([]);
});
it('accepts a correctly formatted negative net result from the finance overview',()=>{
 const expected={collectedAmount:1000,chargeTotal:4500,net:-3500};
 const queries=[{name:'get_finance_overview',response:{ok:true,data:[{pulse:{revenu_periode:1000,charges_periode:4500,resultat_net_periode:-3500}}]}}];
 const amount=new Intl.NumberFormat('fr-FR').format(expected.net),answer=`En octobre 2026, le résultat net du cabinet est de ${amount} DZD.`;
 expect(assessFinanceView({view:'net'},expected,queries,[],answer)).toEqual([]);
});
