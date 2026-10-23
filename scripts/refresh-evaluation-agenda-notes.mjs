// Correct generated October narratives only. Existing appointments are never rewritten.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {visitContent} from './lib/clinical-evaluation-data.mjs';
const root=path.resolve('.cache/clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
if(isolation.database!=='alexa_eval_clinical_20261022'||isolation.port!==55444||!isolation.restorationVerified)throw Error('VerifiedIsolatedCopyRequired');
function sql(query){return execFileSync('docker',['exec','-i',isolation.target,'psql','-X','-U','postgres','-d',isolation.database,'-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});}
const plan=JSON.parse(readFileSync(path.join(root,'cohort-plan.json'),'utf8'));
const patients=new Map(plan.patients.map(p=>[p.id,p]));
const rows=JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY started_at,id),'[]') FROM (
 SELECT c.id,c.patient_id,c.started_at,c.raw_notes,n.id note_id,n.subjective,n.objective,n.assessment,n.plan,n.structured
 FROM app.consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id
 WHERE c.started_at>='2026-10-01T00:00:00+01' AND c.started_at<'2026-11-01T00:00:00+01'
 AND n.status='draft' AND n.lock_after IS NULL AND n.structured->'evaluation'->>'campaign'='clinical-20261022'
) x`));
const trajectory=text=>text.replace(/(La personne|Le parent) rapporte (un mieux|une reprise des difficultés|peu de changement|une évolution contrastée des difficultés) depuis le dernier entretien\./gu,'');
const ordinals=new Map(),updates=[];let already=0,protectedEdits=0;
for(const row of rows){
 const patient=patients.get(row.patient_id);if(!patient)throw Error('UnknownEvaluationPatient');
 const ordinal=ordinals.get(patient.id)??0;ordinals.set(patient.id,ordinal+1);
 if(row.structured.evaluation.agendaNarrativeVersion===3){already++;continue;}
 const base={patientId:patient.id,index:patient.index,count:patient.count,birthDate:patient.birth_date,at:row.started_at};
 const old=visitContent({...base,position:patient.count-1});
 const saved=plan.visits.find(v=>v.patient.id===patient.id&&v.position===patient.count-1);
 const unchanged=[old,saved].filter(Boolean).some(candidate=>{
  const sameMeasures=['anxiete','sommeil','humeur'].every(k=>row.structured.sessionDetails.mesures[k]===candidate.structured.sessionDetails.mesures[k]);
  const sameFocus=JSON.stringify(row.structured.sessionDetails.focus)===JSON.stringify(candidate.structured.sessionDetails.focus)&&row.structured.sessionDetails.focusLibre===candidate.structured.sessionDetails.focusLibre;
  return trajectory(row.raw_notes)===trajectory(candidate.raw)&&trajectory(row.subjective)===trajectory(candidate.subjective)&&['objective','assessment','plan'].every(k=>row[k]===candidate[k])&&sameMeasures&&sameFocus;
 });
 if(!unchanged){protectedEdits++;continue;}
 const fresh=visitContent({...base,position:patient.count+ordinal});
 updates.push({id:row.id,noteId:row.note_id,...fresh,structured:{...row.structured,sessionDetails:fresh.structured.sessionDetails,evaluation:{...row.structured.evaluation,...fresh.structured.evaluation,agendaNarrativeVersion:3}}});
}
if(updates.length){
 const data=JSON.stringify(updates).replace(/'/g,"''");
 sql(`BEGIN;
 DO $$ BEGIN IF current_database()<>'alexa_eval_clinical_20261022' THEN RAISE EXCEPTION 'Isolated evaluation required'; END IF; END $$;
 CREATE TEMP TABLE agenda_narrative_repair ON COMMIT DROP AS SELECT value v FROM jsonb_array_elements('${data}'::jsonb);
 UPDATE app.consultations c SET raw_notes=r.v->>'raw' FROM agenda_narrative_repair r WHERE c.id=(r.v->>'id')::uuid;
 UPDATE app.clinical_notes n SET subjective=r.v->>'subjective',objective=r.v->>'objective',assessment=r.v->>'assessment',plan=r.v->>'plan',structured=r.v->'structured'
 FROM agenda_narrative_repair r WHERE n.id=(r.v->>'noteId')::uuid AND n.status='draft' AND n.lock_after IS NULL;
 COMMIT;`);
}
const result={updated:updates.length,alreadyCurrent:already,protectedEdits,appointmentsUnchanged:true};
writeFileSync(path.join(root,'agenda-narrative-refresh.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
