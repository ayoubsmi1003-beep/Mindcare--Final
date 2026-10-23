// Assess captured responses against actual saved source truth. Does not call the application.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('.cache/clinical-evaluation-20261022');
const report=JSON.parse(readFileSync(path.join(root,'questions-browser-report.json'),'utf8'));
const truth=JSON.parse(readFileSync(path.join(root,'acceptance-source-truth.json'),'utf8'));
assert.equal(report.answersInjected,false);assert.ok(report.finishedAt,'CompleteCapturedCampaignRequired');
const normalize=value=>value.normalize('NFKC').replace(/\s+/gu,' ').trim();
const visits=truth.primary.clinical.consultations;
const text=id=>report.cases.find(c=>c.id===id).turns.map(t=>t.answer).join('\n');
const includes=(answer,wanted)=>assert.ok(normalize(answer).includes(normalize(wanted)),'Recorded fact missing from answer');
const checks={
 q3:()=>{for(const value of [...visits[0].sessionDetails.focus,visits[0].sessionDetails.focusLibre].filter(Boolean))includes(text('q3'),value);assert.ok(!text('q3').includes('scoreConvention'));},
 q4:()=>{for(const value of [visits[0].rawNotes,...['subjective','objective','assessment','plan'].map(k=>visits[0].notes[0][k])])includes(text('q4'),value);},
 q5:()=>{const sorted=[...visits].reverse(),answer=text('q5');for(let i=1;i<sorted.length;i++)for(const key of ['anxiete','sommeil','humeur']){const before=sorted[i-1].sessionDetails.mesures[key],after=sorted[i].sessionDetails.mesures[key];includes(answer,`score précédent ${before}/10, score actuel ${after}/10`);}assert.equal((answer.match(/score précédent/gu)??[]).length,(sorted.length-1)*3);},
 q6:()=>{const answer=text('q6'),t=truth.primary.clinical.treatments;for(const current of t.current){includes(answer,current.medication);includes(answer,current.dose);}for(const change of t.history){if(change.previous?.dose!==null&&change.previous?.dose!==undefined)includes(answer,`Avant : ${change.previous.dose}`);if(change.next?.dose!==null&&change.next?.dose!==undefined)includes(answer,`Après : ${change.next.dose}`);}},
 q7:()=>includes(text('q7'),visits[1].notes[0].subjective),
 q8:()=>{includes(text('q8'),visits[0].notes[0].plan);assert.equal(truth.primary.appointments.filter(a=>Date.parse(a.startsAt)>Date.parse(report.startedAt)).length,0);includes(text('q8'),'Aucun rendez-vous à venir');},
 q9:()=>{const answer=text('q9');includes(answer,`${truth.agenda.length} rendez-vous`);for(const status of new Set(truth.agenda.map(a=>a.status))){const label={confirmed:'Confirmé',requested:'Demandé'}[status];assert.ok(label,'Unassessed agenda status');assert.equal(answer.split(`(${label})`).length-1,truth.agenda.filter(a=>a.status===status).length);}const events=JSON.stringify(report.cases.find(c=>c.id==='q9').turns[0].events);for(const item of truth.agenda)assert.ok(events.includes(item.id),'Appointment source not cited');},
};
for(const scenario of report.cases){
 const check=checks[scenario.id];
 if(!check){const unavailable=/pas pu produire|pas pu générer|synthèse assez fiable|compréhension locale.*indisponible/iu.test(text(scenario.id));scenario.semanticAccuracy=unavailable?'FAIL':'NOT RUN';scenario.assessment=unavailable?'Requested generated paragraph unavailable.':'Manual clinical prose comparison required; fact-read checks do not qualify generation.';continue;}
 try{check();scenario.semanticAccuracy='PASS';scenario.assessment='Captured response matches saved source facts for this question.';}catch(error){scenario.semanticAccuracy='FAIL';scenario.assessment=error.message;}
}
report.counts=Object.fromEntries(['PASS','PARTIAL','FAIL','NOT RUN'].map(status=>[status,report.cases.filter(c=>c.semanticAccuracy===status).length]));
report.semanticAccuracy=report.counts.PASS===10?'PASS':'FAIL';
report.assessmentMethod='Source comparison of actual authenticated browser responses; no injected answer or request.';
writeFileSync(path.join(root,'questions-browser-assessed.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.semanticAccuracy,...report.counts,cases:report.cases.map(c=>({id:c.id,status:c.semanticAccuracy,assessment:c.assessment}))}));
