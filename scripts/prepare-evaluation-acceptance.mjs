// Select real evaluation records and record their authorized source truth before browser questions.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {evaluationId} from './lib/clinical-evaluation-data.mjs';
const root=path.resolve('.cache/clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
if(isolation.database!=='alexa_eval_clinical_20261022'||isolation.port!==55444||!isolation.restorationVerified)throw Error('VerifiedEvaluationRequired');
const plan=JSON.parse(readFileSync(path.join(root,'cohort-plan.json'),'utf8'));
function sql(query){return execFileSync('docker',['exec','-i',isolation.target,'psql','-X','-U','postgres','-d',isolation.database,'-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});}
const json=query=>JSON.parse(sql(query).split('\n').find(l=>l.startsWith('{')||l.startsWith('[')));
const candidates=plan.patients.filter(p=>p.index%10===5&&p.count>=4).slice(0,6);
const ids=candidates.map(p=>`'${evaluationId('treatment',p.id)}'::uuid`).join(',');
const primary=json(`BEGIN READ ONLY; SELECT jsonb_build_object('id',t.patient_id,'appointments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'startsAt',a.starts_at,'endsAt',a.ends_at,'status',a.status) ORDER BY a.starts_at) FROM app.appointments a WHERE a.patient_id=t.patient_id),'[]'::jsonb)) FROM app.patient_treatments t WHERE t.id IN(${ids}) ORDER BY EXISTS(SELECT 1 FROM app.appointments a WHERE a.patient_id=t.patient_id AND a.starts_at>now() AND a.status IN('confirmed','requested')) DESC,t.patient_id LIMIT 1; COMMIT;`);
const secondary=plan.patients.find(p=>p.count<100&&p.id!==primary.id),long=plan.patients.find(p=>p.count>100);
const actor=plan.patients.find(p=>p.id===primary.id).practitioner_id;
function readPatient(id,includeClinical=true){
 return json(`BEGIN; SELECT set_config('request.jwt.claim.sub','${actor}',true); SET LOCAL ROLE authenticated;
 SELECT jsonb_build_object('id',p.id,'name',concat_ws(' ',p.first_name,p.last_name)${includeClinical?`, 'clinical',app.get_alexa_clinical_context(p.id,100,NULL,NULL)`:''}) FROM app.get_patient('${id}') p; ROLLBACK;`);
}
const first={...primary,...readPatient(primary.id)},other=readPatient(secondary.id),longPatient=readPatient(long.id,false);
if(first.clinical.patientId!==first.id||other.clinical.patientId!==other.id)throw Error('PatientScopeMismatch');
const latest=first.clinical.consultations[0];if(!latest)throw Error('HistoricalConsultationRequired');
const format=date=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(date));
const date=format(latest.startedAt),agendaDate='2026-10-29';
const agenda=json(`BEGIN READ ONLY; SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'patientId',patient_id,'startsAt',starts_at,'endsAt',ends_at,'status',status) ORDER BY starts_at),'[]') FROM app.appointments WHERE starts_at>='${agendaDate}T00:00:00+01' AND starts_at<'2026-10-30T00:00:00+01'; COMMIT;`);
const cases=[
 ['q1',`Résume le parcours complet de ${first.name}.`],
 ['q2','Qu’est-ce qui a changé entre ses deux dernières consultations ?'],
 ['q3',`Quel était le focus de sa séance du ${date} ?`],
 ['q4',`Que disent les cinq notes de sa consultation du ${date} ?`],
 ['q5','Comment ses mesures ont-elles évolué ?'],
 ['q6','Quel est son traitement actuel et quels changements sont documentés ?'],
 ['q7','Retrouve une difficulté mentionnée dans une ancienne consultation.'],
 ['q8','Quel suivi est prévu et quand est son prochain rendez-vous ?'],
 ['q9',`Quels rendez-vous sont prévus le ${format(agendaDate+'T12:00:00+01:00')} et quels sont leurs statuts ?`],
 ['q10',[`Quel est le traitement actuel de ${other.name} ?`,`Reviens à ${first.name} et résume sa dernière séance.`]],
].map(([id,turns])=>({id,turns:Array.isArray(turns)?turns:[turns]}));
writeFileSync(path.join(root,'acceptance-source-truth.json'),JSON.stringify({capturedAt:new Date().toISOString(),actor,primary:first,secondary:other,longPatient:{...longPatient,expectedVisits:long.count},agendaDate,agenda},null,2));
writeFileSync(path.join(root,'acceptance-questions.json'),JSON.stringify({origin:'http://127.0.0.1:3006',cases},null,2));
console.log(JSON.stringify({questions:cases.length,primaryVisits:first.clinical.consultations.length,primaryTreatments:first.clinical.treatments.current.length,futureAppointments:first.appointments.filter(a=>Date.parse(a.startsAt)>Date.now()).length,longVisits:long.count,agendaAppointments:agenda.length}));
