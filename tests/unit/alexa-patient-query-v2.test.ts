import {expect,it} from 'vitest';
import {patientQueryContract,patientQueryPeriod} from '@/shared/alexa/patient-query-contract';
import {conditionSchema,queryPatientsSchema} from '@/shared/alexa/agent';

const asOf='2026-10-23T12:00:00+01:00';
it('does not apply a sibling CNI absence predicate to a specified sex',()=>{
 expect(patientQueryContract('Compte les patients de sexe féminin sans CNI.',asOf).filterGroups).toEqual([[{field:'identity_card',op:'missing',value:null},{field:'sex',op:'eq',value:'F'}]]);
 expect(patientQueryContract('Compte les hommes et les femmes sans CNI.',asOf).unsupported).toContain('Combinaison de sexes non résolue');
});
it('retains a zero-debt restriction in an extended patient population',()=>{
 const plan=patientQueryContract('Combien de femmes sans impayés parmi les patients actifs ?',asOf);
 expect(plan.unsupported).toEqual([]);expect(plan.filterGroups[0]).toContainEqual({field:'outstanding_balance',op:'eq',value:0});
});
it('keeps an unresolved coordinated field instead of reading a broader population',()=>{
 const plan=patientQueryContract('Combien de patients avec téléphone et CNI ?',asOf);
 expect(plan.unsupported).toContain('Condition de présence ou d’absence non résolue : carte d’identité');
});
it.each(['ouvertes','en cours','non signées','annulées','non terminées','non clôturées','pas encore terminées'])('does not substitute completed visits for %s visits',status=>{
 expect(patientQueryContract(`Combien de patientes ont au moins 3 consultations ${status} en janvier 2026 ?`,asOf).unsupported).toContain('Statut de consultations non pris en charge pour ce filtre patient');
});
it('retains the consultation window on the full conjunctive patient request',()=>{
 const plan=patientQueryContract("Liste les patients adultes sans carte d’identité ayant au moins deux consultations terminées entre le 1er septembre 2026 et le 30 septembre 2026.",asOf);
 expect(plan.unsupported).toEqual([]);
 expect(plan.consultationPeriod).toEqual({from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00',axis:'started_at'});
 expect(plan.filterGroups).toHaveLength(1);
 expect(plan.filterGroups[0]).toHaveLength(3);
 expect(plan.filterGroups[0]).toEqual(expect.arrayContaining([{field:'age',op:'gte',value:18},{field:'identity_card',op:'missing',value:null},{field:'completed_consultations',op:'gte',value:2}]));
 expect(plan.ledger.some(c=>c.kind==='period'&&c.span.includes('septembre'))).toBe(true);
});
it('does not silently apply an unknown or ambiguous patient restriction',()=>{
 expect(patientQueryContract('Liste les patients adultes sans CNI inscrits en septembre.',asOf).unsupported.length).toBeGreaterThan(0);
 expect(patientQueryContract('Liste les patients adultes sans CNI qui habitent Alger.',asOf).unsupported.length).toBeGreaterThan(0);
 expect(patientQueryContract('Combien de patients n’ont pas d’adresse électronique ?',asOf).unsupported.length).toBeGreaterThan(0);
 expect(patientQueryContract('Liste les patients adultes ou mineurs.',asOf).unsupported.length).toBeGreaterThan(0);
 expect(patientQueryContract('Liste les patients adultes qui ne sont pas des femmes.',asOf).unsupported.length).toBeGreaterThan(0);
 expect(patientQueryContract('Liste les patients qui n’ont pas moins de 18 ans.',asOf).unsupported.length).toBeGreaterThan(0);
});
it('keeps independent OR branches and their local absence or presence semantics',()=>{
 expect(patientQueryContract('Liste les patients sans CNI ou avec un téléphone renseigné.',asOf).filterGroups).toEqual([[{field:'identity_card',op:'missing',value:null}],[{field:'phone',op:'present',value:null}]]);
});
it('keeps a numeric age disjunction as two bounded patient filter groups',()=>{
 const plan=patientQueryContract('Combien de patients actifs ont moins de 18 ans ou plus de 65 ans ?',asOf);
 expect(plan.unsupported).toEqual([]);
 expect(plan.filterGroups).toEqual([[{field:'age',op:'lt',value:18}],[{field:'age',op:'gt',value:65}]]);
 expect(plan.extended).toBe(true);
});
it('binds creation dates separately from explicit closure dates',()=>{
 expect(patientQueryContract('Compte les patients inscrits en septembre 2026.',asOf).createdPeriod).toEqual({from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'});
 expect(patientQueryContract('Liste les patients avec au moins 2 consultations selon leur date de clôture en septembre 2026.',asOf).consultationPeriod?.axis).toBe('ended_at');
});
it('keeps active and archived patients together when both populations are requested',()=>{
 expect(patientQueryContract('Liste les patients actifs et archivés avec un téléphone renseigné.',asOf).population).toBe('all');
});
it('resolves compact closed ranges without turning open bounds into one day or month',()=>{
 const september={from:'2026-09-01T00:00:00+01:00',to:'2026-10-01T00:00:00+01:00'};
 expect(patientQueryPeriod('du 1 au 30 septembre 2026',asOf)).toEqual(september);
 expect(patientQueryPeriod('du 1 septembre au 30 septembre 2026',asOf)).toEqual(september);
 expect(patientQueryPeriod('depuis septembre 2026',asOf)).toBeNull();
 expect(patientQueryPeriod('avant le 1 octobre 2026',asOf)).toBeNull();
 expect(patientQueryPeriod('ce mois à ce jour',asOf)).toBeNull();
 expect(patientQueryPeriod('en septembre et octobre 2026',asOf)).toBeNull();
});
it('accepts only meaningful typed predicates and bounded groups',()=>{
 expect(conditionSchema.safeParse({field:'sex',op:'eq',value:'F'}).success).toBe(true);
 expect(conditionSchema.safeParse({field:'phone',op:'present',value:null}).success).toBe(true);
 expect(conditionSchema.safeParse({field:'age',op:'lte',value:30}).success).toBe(true);
 expect(conditionSchema.safeParse({field:'phone',op:'eq',value:'F'}).success).toBe(false);
 expect(queryPatientsSchema.safeParse({partIds:['p'],mode:'count',filterGroups:Array.from({length:5},()=>[{field:'phone',op:'missing',value:null}])}).success).toBe(false);
});
