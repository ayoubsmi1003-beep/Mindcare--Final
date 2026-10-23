// Read-only acceptance checks against the explicitly isolated evaluation copy.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('.cache/clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
if(isolation.database!=='alexa_eval_clinical_20261022'||isolation.port!==55444||!isolation.restorationVerified)throw Error('VerifiedIsolatedCopyRequired');
const query=`BEGIN READ ONLY;
WITH generated AS (
 SELECT c.*,n.subjective,n.objective,n.assessment,n.plan,n.structured
 FROM app.consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id
 WHERE n.structured->'evaluation'->>'campaign'='clinical-20261022'
), ordered_slots AS (
 SELECT *,max(ends_at) OVER(PARTITION BY practitioner_id ORDER BY starts_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) previous_end
 FROM app.appointments WHERE status<>'cancelled'
), histories AS (SELECT patient_id,count(*) visits FROM generated GROUP BY patient_id)
SELECT json_build_object(
 'patients',(SELECT count(*) FROM app.patients),
 'identityHash',(SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM app.patients p),
 'generatedConsultations',(SELECT count(*) FROM generated),
 'patientsWithHistory',(SELECT count(*) FROM histories),
 'historiesAbove100',(SELECT count(*) FROM histories WHERE visits>100),
 'missingNoteAreas',(SELECT count(*) FROM generated WHERE nullif(trim(raw_notes),'') IS NULL OR nullif(trim(subjective),'') IS NULL OR nullif(trim(objective),'') IS NULL OR nullif(trim(assessment),'') IS NULL OR nullif(trim(plan),'') IS NULL),
 'missingSessionDetails',(SELECT count(*) FROM generated WHERE structured->'sessionDetails' IS NULL),
 'duplicateVisitNarratives',(SELECT coalesce(sum(n-1),0) FROM (SELECT count(*) n FROM generated GROUP BY patient_id,raw_notes,subjective,objective,assessment,plan HAVING count(*)>1) duplicates),
 'visibleProvenanceTerms',(SELECT count(*) FROM generated WHERE concat_ws(' ',raw_notes,subjective,objective,assessment,plan) ~* '\\m(test|fictif|dummy|exemple)\\M'),
 'visitsBeforeBirth',(SELECT count(*) FROM generated c JOIN app.patients p ON p.id=c.patient_id WHERE (c.started_at AT TIME ZONE 'Africa/Algiers')::date<p.birth_date),
 'appointmentOverlaps',(SELECT count(*) FROM ordered_slots WHERE starts_at<previous_end),
 'futureCompletedAppointments',(SELECT count(*) FROM app.appointments WHERE starts_at>now() AND status='completed'),
 'octoberAppointments',(SELECT count(*) FROM app.appointments WHERE starts_at>='2026-10-01T00:00:00+01' AND starts_at<'2026-11-01T00:00:00+01'),
 'appointmentsWithoutGeneratedConsultations',(SELECT count(*) FROM app.appointments WHERE id NOT IN (SELECT appointment_id FROM generated)),
 'treatments',(SELECT count(*) FROM app.patient_treatments)
); COMMIT;`;
const output=execFileSync('docker',['exec','-i',isolation.target,'psql','-X','-U','postgres','-d',isolation.database,'-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
const result=JSON.parse(output.split('\n').find(l=>l.startsWith('{')));
const originalAppointments=JSON.parse(execFileSync('docker',['exec',isolation.source,'psql','-X','-U','postgres','-d','mindcare','-At','-c',"BEGIN READ ONLY; SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',md5(to_jsonb(a)::text))),'[]') FROM app.appointments a; COMMIT;"],{encoding:'utf8',windowsHide:true}).split('\n').find(l=>l.startsWith('[')));
const copiedAppointments=JSON.parse(execFileSync('docker',['exec',isolation.target,'psql','-X','-U','postgres','-d',isolation.database,'-At','-c',"BEGIN READ ONLY; SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'fingerprint',md5(to_jsonb(a)::text))),'[]') FROM app.appointments a; COMMIT;"],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}).split('\n').find(l=>l.startsWith('[')));
result.originalAppointmentsPreserved=originalAppointments.every(a=>copiedAppointments.some(copy=>copy.id===a.id&&copy.fingerprint===a.fingerprint));
result.originalAppointmentsChecked=originalAppointments.length;
const snapshot=JSON.parse(readFileSync(path.join(root,'source-inventory.json'),'utf8'));
result.identityPreserved=result.identityHash===snapshot.identityHash;
result.status=result.identityPreserved&&result.originalAppointmentsPreserved&&result.patients===1558&&result.generatedConsultations===8142&&result.patientsWithHistory===1554&&result.historiesAbove100===3&&['missingNoteAreas','missingSessionDetails','duplicateVisitNarratives','visibleProvenanceTerms','visitsBeforeBirth','appointmentOverlaps','futureCompletedAppointments'].every(k=>result[k]===0)?'PASS':'FAIL';
writeFileSync(path.join(root,'data-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
process.exitCode=result.status==='PASS'?0:1;
