import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createEvaluationPlan,evaluationId,visitContent} from './lib/clinical-evaluation-data.mjs';
const root=path.resolve('.cache/clinical-evaluation-20261022'),container='mindcare-evaluation-20261022',database='alexa_eval_clinical_20261022';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
if(isolation.database!==database||isolation.port!==55444||!isolation.restorationVerified)throw Error('VerifiedIsolatedCopyRequired');
mkdirSync(root,{recursive:true});
function sql(query){try{return execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(e){writeFileSync(path.join(root,'last-sql-error.log'),String(e.stderr??''));throw Error('EvaluationWriteFailedSeePrivateDiagnostic');}}
const json=q=>JSON.parse(sql(q).split('\n').find(l=>l.startsWith('[')||l.startsWith('{')));
const patients=json("BEGIN READ ONLY; SELECT jsonb_agg(jsonb_build_object('id',id,'cabinet_id',cabinet_id,'practitioner_id',practitioner_id,'birth_date',birth_date) ORDER BY id) FROM app.patients; COMMIT;");
if(patients.length!==1558||sql("SELECT count(*) FROM app.patients WHERE is_synthetic IS DISTINCT FROM true")!=='0')throw Error('UnexpectedEvaluationPopulation');
const identity=()=>sql("SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM app.patients p");
const identityBefore=identity();
const existing=json("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'starts_at',starts_at,'ends_at',ends_at)),'[]') FROM app.appointments WHERE id NOT IN (SELECT appointment_id FROM app.consultations WHERE raw_notes IS NOT NULL)");
const planFile=path.join(root,'cohort-plan.json');
const plan=existsSync(planFile)?JSON.parse(readFileSync(planFile,'utf8')):createEvaluationPlan(patients,existing);
if(!existsSync(planFile))writeFileSync(planFile,JSON.stringify(plan));
writeFileSync(path.join(root,'excluded-dates.json'),JSON.stringify(plan.excluded,null,2));
const pilot=plan.patients.filter(p=>p.count<100).slice(0,5).map(p=>p.id);
const selected=process.argv.includes('--all')?plan.patients.map(p=>p.id):pilot;
const journalFile=path.join(root,'population-journal.json');
const journal=existsSync(journalFile)?JSON.parse(readFileSync(journalFile,'utf8')):{completed:[]};
for(let i=0;i<selected.length;i+=25){
 const ids=selected.slice(i,i+25).filter(id=>process.argv.includes('--refresh-generated')||!journal.completed.includes(id));if(!ids.length)continue;
 const visits=plan.visits.filter(v=>ids.includes(v.patient.id)).map(v=>({...v,...visitContent({patientId:v.patient.id,index:v.index,position:v.position,count:v.count,birthDate:v.patient.birth_date,at:v.at}),patientId:v.patient.id,cabinetId:v.patient.cabinet_id,practitionerId:v.patient.practitioner_id}));
 const data=JSON.stringify(visits).replace(/'/g,"''");
 sql(`BEGIN; SET LOCAL TIME ZONE 'UTC'; SELECT set_config('request.jwt.claim.sub','${visits[0].practitionerId}',true);
 CREATE TEMP TABLE evaluation_batch ON COMMIT DROP AS SELECT v FROM jsonb_array_elements('${data}'::jsonb) v;
 INSERT INTO app.appointments(id,cabinet_id,practitioner_id,patient_id,starts_at,ends_at,status,source,kind,created_by,is_synthetic)
 SELECT (v->>'appointmentId')::uuid,(v->>'cabinetId')::uuid,(v->>'practitionerId')::uuid,(v->>'patientId')::uuid,(v->>'at')::timestamptz,(v->>'end')::timestamptz,'completed','doctor',CASE WHEN (v->>'position')::int=0 THEN 'premiere_consultation'::app.consult_kind ELSE 'suivi'::app.consult_kind END,(v->>'practitionerId')::uuid,true FROM evaluation_batch ON CONFLICT(id) DO NOTHING;
 INSERT INTO app.consultations(id,cabinet_id,practitioner_id,patient_id,appointment_id,started_at,ended_at,status,raw_notes,is_synthetic)
 SELECT (v->>'id')::uuid,(v->>'cabinetId')::uuid,(v->>'practitionerId')::uuid,(v->>'patientId')::uuid,(v->>'appointmentId')::uuid,(v->>'at')::timestamptz,(v->>'end')::timestamptz,'closed',v->>'raw',true FROM evaluation_batch ON CONFLICT(id) DO UPDATE SET raw_notes=EXCLUDED.raw_notes WHERE EXISTS(SELECT 1 FROM app.clinical_notes n WHERE n.consultation_id=consultations.id AND n.status='draft' AND n.structured->'evaluation'->>'campaign'='clinical-20261022' AND coalesce((n.structured->'evaluation'->>'generatorVersion')::int,1)<2);
 INSERT INTO app.clinical_notes(id,cabinet_id,practitioner_id,patient_id,consultation_id,status,subjective,objective,assessment,plan,structured,is_synthetic)
 SELECT (v->>'noteId')::uuid,(v->>'cabinetId')::uuid,(v->>'practitionerId')::uuid,(v->>'patientId')::uuid,(v->>'id')::uuid,'draft',v->>'subjective',v->>'objective',v->>'assessment',v->>'plan',v->'structured',true FROM evaluation_batch ON CONFLICT(id) DO UPDATE SET subjective=EXCLUDED.subjective,objective=EXCLUDED.objective,assessment=EXCLUDED.assessment,plan=EXCLUDED.plan,structured=EXCLUDED.structured WHERE clinical_notes.status='draft' AND clinical_notes.lock_after IS NULL AND clinical_notes.structured->'evaluation'->>'campaign'='clinical-20261022' AND coalesce((clinical_notes.structured->'evaluation'->>'generatorVersion')::int,1)<2;
 COMMIT;`);
 journal.completed=[...new Set([...journal.completed,...ids])];writeFileSync(journalFile,JSON.stringify(journal));
 console.log(JSON.stringify({patientsCompleted:journal.completed.length,batchPatients:ids.length,batchConsultations:visits.length}));
}
const counts=json("SELECT json_build_object('patients',count(DISTINCT c.patient_id),'consultations',count(*)) FROM app.consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id WHERE n.structured->'evaluation'->>'campaign'='clinical-20261022'");
if(identity()!==identityBefore)throw Error('AdministrativeDataChanged');
writeFileSync(path.join(root,'population-result.json'),JSON.stringify({...counts,excludedPatients:plan.excluded.length,identityPreserved:true,pilotPatients:pilot},null,2));
console.log(JSON.stringify({...counts,excludedPatients:plan.excluded.length,identityPreserved:true}));
