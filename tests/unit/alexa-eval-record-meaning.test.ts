import {expect,it} from 'vitest';
import {recordReadMatches,recordMembershipMatches,financialRowsMatch,financialPresentationMatches,financialTotalsMatch,firstAppointmentPresented} from '../../scripts/lib/alexa-eval-record-meaning.mjs';
it('treats the omitted record mode as the documented default list mode',()=>{
 const observed={name:'query_alexa_records',args:{p_domain:'documents',p_spec:JSON.stringify({status:'issued',from:'1900-01-01T00:00:00+01:00',to:'1900-01-02T00:00:00+01:00',patientId:'22222222-2222-4222-8222-222222222222'})}};
 const oracle={domain:'documents',query:{mode:'list',status:'issued',from:'1900-01-01T00:00:00+01:00',to:'1900-01-02T00:00:00+01:00',patientId:'22222222-2222-4222-8222-222222222222'}};
 expect(recordReadMatches(observed,oracle,{})).toBe(true);
});
it('treats an agenda names-page limit as presentation-only while matching the bounded read',()=>{
 const observed={name:'query_alexa_records',args:{p_domain:'agenda',p_spec:JSON.stringify({from:'2026-10-29T00:00:00+01:00',to:'2026-10-30T00:00:00+01:00'})}};
 const oracle={domain:'agenda',query:{mode:'list',from:'2026-10-29T00:00:00+01:00',to:'2026-10-30T00:00:00+01:00',limit:5}};
 expect(recordReadMatches(observed,oracle,{})).toBe(true);
});
it('requires the first ordered identity and time, rather than a later member or a list',()=>{
 const first={id:'a',name:'Amina FICTIVE',at:'2026-10-24T09:00:00+01:00',status:'confirmed'},expected={total:2,first};
 const answer='Premier rendez-vous de la période demandée.\nAmina FICTIVE : demain à 9 h (Confirmé).',sources=[{type:'appointment',id:'a'}];
 expect(firstAppointmentPresented(answer,sources,expected,'2026-10-23T12:00:00+01:00')).toBe(true);
 expect(firstAppointmentPresented(answer,[{type:'appointment',id:'b'}],expected,'2026-10-23T12:00:00+01:00')).toBe(false);
 expect(firstAppointmentPresented(answer.replace('9 h','10 h'),sources,expected,'2026-10-23T12:00:00+01:00')).toBe(false);
 expect(firstAppointmentPresented(answer.replace('demain','hier'),sources,expected,'2026-10-23T12:00:00+01:00')).toBe(false);
 expect(firstAppointmentPresented(answer.replace('demain','après-demain'),sources,expected,'2026-10-22T12:00:00+01:00')).toBe(true);
 expect(firstAppointmentPresented(answer.replace('Confirmé','Terminé'),sources,expected,'2026-10-23T12:00:00+01:00')).toBe(false);
 expect(firstAppointmentPresented(answer+'\nAutre patient.',sources,expected,'2026-10-23T12:00:00+01:00')).toBe(false);
 expect(firstAppointmentPresented('0 rendez-vous prévus.',[],{total:0},'2026-10-23T12:00:00+01:00')).toBe(true);
 expect(firstAppointmentPresented('0 rendez-vous prévus.',sources,{total:0},'2026-10-23T12:00:00+01:00')).toBe(false);
 expect(recordMembershipMatches({rows:[{id:'b'},{id:'a'}]},{ids:['a','b']},{mode:'first'})).toBe(false);
});
it('checks default record lists as well as explicitly declared lists and rejects missing or swapped rows',()=>{
 const expected={ids:['a','b']};
 expect(recordMembershipMatches({rows:[{id:'a'},{id:'b'}]},expected,{})).toBe(true);
 expect(recordMembershipMatches({rows:[{id:'a'},{id:'b'}]},expected,{mode:'list'})).toBe(true);
 expect(recordMembershipMatches({rows:[{id:'b'},{id:'a'}]},expected,{})).toBe(false);
 expect(recordMembershipMatches({},expected,{})).toBe(false);
 expect(recordMembershipMatches({rows:[{id:'a'}]},expected,{})).toBe(false);
 expect(recordMembershipMatches({rows:[]},{ids:[]},{})).toBe(true);
 expect(recordMembershipMatches({},expected,{mode:'count'})).toBe(true);
});
it('verifies labeled financial totals in native label-before-number order without accepting an unrelated amount',()=>{
 const summary={total:2,pendingDzd:300,collectedDzd:500,unpriced:1,amount:800,dateAxis:'created_at'};
 const answer='2 Résultat(s)\nSolde connu à encaisser (DZD) : 300\nEncaissements (DZD) : 500\nConsultations sans tarif : 1\nPériode selon la création du paiement ; les consultations sans tarif sont comptées séparément.';
 expect(financialTotalsMatch(answer,summary)).toBe(true);
 expect(financialTotalsMatch(answer.replace(/\n/gu,' '),summary)).toBe(true);
 expect(financialTotalsMatch(answer.replace('Encaissements (DZD) : 500','Encaissements (DZD) : 800'),summary)).toBe(false);
 expect(financialTotalsMatch('Autre somme : 800 DZD',summary)).toBe(false);
 expect(financialTotalsMatch(answer.replace('Solde connu à encaisser (DZD) : 300\n',''),summary)).toBe(false);
 expect(financialTotalsMatch(answer+'\nAutre somme : 900 DZD',summary)).toBe(false);
 expect(financialTotalsMatch(answer,{...summary,amount:900})).toBe(false);
 expect(financialTotalsMatch(answer.replace('2 Résultat(s)','3 Résultat(s)'),summary)).toBe(false);
 expect(financialTotalsMatch(answer.replace('300','-300'),summary)).toBe(false);
 expect(financialTotalsMatch(answer.replace('300','3000'),summary)).toBe(false);
 expect(financialTotalsMatch(answer+'\nEncaissements (DZD) : 500',summary)).toBe(false);
});
it('accepts a concise verified collected amount when the question asks only for that amount',()=>{
 const summary={total:0,pendingDzd:0,collectedDzd:0,unpriced:80,amount:0,dateAxis:'collected_at'};
 expect(financialTotalsMatch('Sur la période demandée, le montant encaissé est de 0 DZD.',summary,{state:'collected'})).toBe(true);
 expect(financialTotalsMatch('Sur la période demandée, le montant encaissé est de 50 DZD.',summary,{state:'collected'})).toBe(false);
 expect(financialTotalsMatch('Le montant total est de 0 DZD.',summary,{state:'collected'})).toBe(false);
});
it('requires the requested members and their own amounts in the visible answer',()=>{
 const at='2026-10-01T08:00:00Z',date=new Date(at).toLocaleString('fr-DZ',{timeZone:'Africa/Algiers'});
 const expected=[{id:'pay-a',patientId:'a',label:'FICTIF Alpha',amount:300,at,status:'collected'},{id:'pay-b',patientId:'b',label:'FICTIF Bêta',amount:500,at,status:'collected'}];
 const summary={total:2,pendingDzd:0,collectedDzd:800,unpriced:0,dateAxis:'collected_at'};
 const answer=`2 résultats\nFICTIF Alpha — ${date} — Encaissé — 300 DZD\nFICTIF Bêta — ${date} — Encaissé — 500 DZD\nEncaissements (DZD) : 800`;
 expect(financialPresentationMatches(answer,expected,summary)).toBe(true);
 expect(financialPresentationMatches(answer+'\nAutre paiement : 900 DZD',expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer+'\nAutre paiement : 900',expected,summary)).toBe(false);
 expect(financialPresentationMatches('2 résultats ; total800DZD',expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer.replace('300 DZD','500 DZD').replace(`Bêta — ${date} — Encaissé — 500`,`Bêta — ${date} — Encaissé — 300`),expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer.replace(date,'date inconnue'),expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer.replace('Encaissé','À encaisser'),expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer+'\nEncaissements (DZD) : 900',expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer.replace('FICTIF Alpha','FICTIF Bêta'),expected,summary)).toBe(false);
 expect(financialPresentationMatches(answer.split('\n').slice(0,2).join('\n'),expected,summary)).toBe(false);
 expect(financialPresentationMatches('0 résultat',[],{total:0,pendingDzd:0,collectedDzd:0,unpriced:0,dateAxis:'collected_at'})).toBe(true);
 expect(financialPresentationMatches('Aucun paiement en attente ne correspond à cette demande.',[],{total:0,pendingDzd:0,collectedDzd:0,unpriced:0,dateAxis:'created_at'})).toBe(true);
});
it('checks each payment amount and patient association rather than only matching the sum',()=>{
 const expected=[{id:'payment-a',patientId:'patient-a',amount:300},{id:'payment-b',patientId:'patient-b',amount:500}];
 expect(financialRowsMatch(expected,expected)).toBe(true);
 expect(financialRowsMatch([{...expected[0],amount:500},{...expected[1],amount:300}],expected)).toBe(false);
 expect(financialRowsMatch([{...expected[0],patientId:'patient-b'},expected[1]],expected)).toBe(false);
 expect(financialRowsMatch([expected[0],expected[0]],expected)).toBe(false);
 expect(financialRowsMatch(expected.slice().reverse(),expected)).toBe(false);
 expect(financialRowsMatch([],[])).toBe(true);
 expect(financialRowsMatch([],expected)).toBe(false);
 expect(financialRowsMatch(undefined,expected)).toBe(false);
});
it('separates agenda output intent from its SQL schema without admitting an invented SQL mode',()=>{
 const query={from:'2026-10-23T00:00:00+01:00',to:'2026-10-24T00:00:00+01:00'};
 const read=(spec:object)=>({name:'query_alexa_records',args:{p_domain:'agenda',p_spec:JSON.stringify(spec)}});
 expect(recordReadMatches(read(query),{domain:'agenda',query:{...query,mode:'count'}},{})).toBe(true);
 expect(recordReadMatches(read({...query,mode:'count'}),{domain:'agenda',query:{...query,mode:'count'}},{})).toBe(false);
 expect(recordReadMatches(read({...query,statuses:['arrived']}),{domain:'agenda',query:{...query,mode:'list'}},{})).toBe(false);
});
it('rejects equal-count reads with different domains, axes, types or narrower scopes',()=>{
 const query={mode:'count',from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'};
 const read=(domain:string,spec:object)=>({name:'query_alexa_records',args:{p_domain:domain,p_spec:JSON.stringify(spec)}});
 const oracle={domain:'consultations',query};
 expect(recordReadMatches(read('consultations',query),oracle,{})).toBe(true);
 for(const changed of [{domain:'documents',spec:query},{domain:'consultations',spec:{...query,dateAxis:'ended_at'}},{domain:'consultations',spec:{...query,status:'closed'}},{domain:'consultations',spec:{...query,patientId:'different'}},{domain:'consultations',spec:{...query,mode:'list'}}])expect(recordReadMatches(read(changed.domain,changed.spec),oracle,{})).toBe(false);
 expect(recordReadMatches(read('documents',{...query,kind:'ordonnance'}),{domain:'documents',query:{...query,kind:'certificat_medical'}},{})).toBe(false);
 expect(recordReadMatches(read('agenda',{...query,statuses:['arrived']}),{domain:'agenda',query:{...query,statuses:['confirmed']}},{})).toBe(false);
});
