import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluationId,visitContent,createEvaluationPlan} from './clinical-evaluation-data.mjs';
test('identifiers and trajectories are repeatable, age-safe and retain internal provenance',()=>{
 assert.equal(evaluationId('note','abc'),evaluationId('note','abc'));
 const input={patientId:'abc',index:3,position:1,count:6,birthDate:'2000-01-01',at:'2026-02-01'};
 const content=visitContent(input);assert.deepEqual(content,visitContent(input));
 assert.equal(content.structured.sessionDetails.scoreConvention,'difficulty-v1');
 assert.throws(()=>visitContent({...input,birthDate:'2222-01-01'}),/VisitBeforeBirth/);
 assert.doesNotMatch([content.raw,content.subjective,content.objective,content.assessment,content.plan].join(' '),/\b(test|fictif|dummy|lorem ipsum|exemple)\b/i);
 assert.doesNotMatch([content.raw,content.subjective,content.objective,content.assessment,content.plan].join(' '),/\bde (?:un|une|le|les)\b/u);
});
test('planning excludes impossible ages and allocates no overlapping appointments',()=>{
 const patients=Array.from({length:10},(_,i)=>({id:evaluationId('patient',i),birth_date:i===9?'2222-01-01':'1990-01-01'}));
 const p=createEvaluationPlan(patients);assert.equal(p.excluded.length,1);assert.equal(p.patients[0].count,104);
 const visits=[...p.visits].sort((a,b)=>a.at.localeCompare(b.at));
 for(let i=1;i<visits.length;i++)assert.ok(Date.parse(visits[i].at)>=Date.parse(visits[i-1].end));
});
test('long histories compare against the actual preceding visit rather than the preceding trajectory bucket',()=>{
 const input={patientId:'abc',index:0,count:104,birthDate:'1990-01-01',at:'2026-02-01'};
 const previous=visitContent({...input,position:10}),current=visitContent({...input,position:11});
 assert.deepEqual(current.structured.sessionDetails.mesures,previous.structured.sessionDetails.mesures);
 assert.match(current.raw,/peu de changement/);
});
test('the complete cohort fits the historical calendar',()=>{
 const patients=Array.from({length:1558},(_,i)=>({id:evaluationId('patient',i),birth_date:'1990-01-01'}));
 const plan=createEvaluationPlan(patients);assert.equal(plan.patients.length,1558);
 assert.ok(plan.visits.every(v=>Date.parse(v.end)<Date.parse('2026-10-01T00:00:00+01:00')));
});
