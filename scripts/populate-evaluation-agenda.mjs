import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {evaluationId,visitContent} from './lib/clinical-evaluation-data.mjs';
const root=path.resolve('.cache/clinical-evaluation-20261022'),container='mindcare-evaluation-20261022',database='alexa_eval_clinical_20261022';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
if(isolation.port!==55444||isolation.database!==database)throw Error('IsolatedEvaluationRequired');
function sql(q){try{return execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();}catch(e){writeFileSync(path.join(root,'agenda-error.log'),String(e.stderr??''));throw Error('AgendaWriteFailed');}}
const plan=JSON.parse(readFileSync(path.join(root,'cohort-plan.json'),'utf8'));
const existing=JSON.parse(sql("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'patient_id',patient_id,'starts_at',starts_at,'ends_at',ends_at)),'[]') FROM app.appointments WHERE starts_at>='2026-10-01T00:00:00+01' AND starts_at<'2026-11-01T00:00:00+01'"));
const before=sql("SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM app.patients p");
const rows=[],completedByPatient=new Map();let index=0;
for(let day=1;day<=31;day++){
 const date=`2026-10-${String(day).padStart(2,'0')}`,weekday=new Date(`${date}T12:00:00+01:00`).getUTCDay();
 if([5,6].includes(weekday))continue;
 for(const hour of [9,10,11,14,15,16]){
  const patient=plan.patients[(index*37+7)%plan.patients.length],id=evaluationId('october-appointment',`${date}:${hour}`),first=index%8===0;
  const at=new Date(`${date}T${String(hour).padStart(2,'0')}:00:00+01:00`),end=new Date(at.getTime()+(first?60:30)*60000);index++;
  if(existing.some(a=>a.id!==id&&Date.parse(a.starts_at)<+end&&Date.parse(a.ends_at)>+at))continue;
  const past=+end<Date.now(),status=past?(index%11===0?'no_show':index%17===0?'cancelled':'completed'):(index%3===0?'requested':'confirmed');
  const completed=status==='completed';
  const ordinal=completedByPatient.get(patient.id)??0;
  if(completed)completedByPatient.set(patient.id,ordinal+1);
  const v=visitContent({patientId:patient.id,index:patient.index,position:patient.count+ordinal,count:patient.count,birthDate:patient.birth_date,at:at.toISOString()});
  const consultationId=evaluationId('october-consultation',id),noteId=evaluationId('october-note',id);
  rows.push({id,patient,at:at.toISOString(),end:end.toISOString(),status,first,completed,consultationId,noteId,...v});
 }
}
for(const row of rows){
 const v=JSON.stringify(row).replace(/'/g,"''");
 sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${row.patient.practitioner_id}',true);
 INSERT INTO app.appointments(id,cabinet_id,practitioner_id,patient_id,starts_at,ends_at,status,source,kind,created_by,is_synthetic,notes_admin)
 VALUES('${row.id}','${row.patient.cabinet_id}','${row.patient.practitioner_id}','${row.patient.id}','${row.at}','${row.end}','${row.status}','doctor','${row.first?'premiere_consultation':'suivi'}','${row.patient.practitioner_id}',true,${row.first?"'Première rencontre de ce nouvel épisode de soins.'":"NULL"}) ON CONFLICT(id) DO NOTHING;
 ${row.completed?`INSERT INTO app.consultations(id,cabinet_id,practitioner_id,patient_id,appointment_id,started_at,ended_at,status,raw_notes,is_synthetic)
 SELECT '${row.consultationId}','${row.patient.cabinet_id}','${row.patient.practitioner_id}','${row.patient.id}','${row.id}','${row.at}','${row.end}','closed',x->>'raw',true FROM (SELECT '${v}'::jsonb x) q ON CONFLICT(id) DO NOTHING;
 INSERT INTO app.clinical_notes(id,cabinet_id,practitioner_id,patient_id,consultation_id,status,subjective,objective,assessment,plan,structured,is_synthetic)
 SELECT '${row.noteId}','${row.patient.cabinet_id}','${row.patient.practitioner_id}','${row.patient.id}','${row.consultationId}','draft',x->>'subjective',x->>'objective',x->>'assessment',x->>'plan',x->'structured',true FROM (SELECT '${v}'::jsonb x) q ON CONFLICT(id) DO NOTHING;`:''}
 COMMIT;`);
}
if(sql("SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM app.patients p")!==before)throw Error('IdentityChanged');
const result={appointments:rows.length,completedConsultations:rows.filter(r=>r.completed).length,identityPreserved:true};
writeFileSync(path.join(root,'agenda-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
