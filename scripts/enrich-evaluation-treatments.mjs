// Document a few medication trajectories in generated adult evaluation charts only.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {evaluationId} from './lib/clinical-evaluation-data.mjs';
const root=path.resolve('.cache/clinical-evaluation-20261022'),container='mindcare-evaluation-20261022',database='alexa_eval_clinical_20261022';
const isolation=JSON.parse(readFileSync(path.join(root,'isolation.json'),'utf8'));
if(isolation.database!==database||isolation.port!==55444)throw Error('IsolatedEvaluationRequired');
function sql(q){try{return execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']}).trim();}catch(e){writeFileSync(path.join(root,'treatment-error.log'),String(e.stderr??''));throw Error('EvaluationTreatmentWriteFailed');}}
const plan=JSON.parse(readFileSync(path.join(root,'cohort-plan.json'),'utf8'));
const medication=JSON.parse(sql("SELECT json_build_object('id',id,'name',coalesce(brand_name,inn)) FROM app.medications WHERE upper(coalesce(inn,'')) LIKE '%SERTRALINE%' ORDER BY id LIMIT 1"));
const before=sql("SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM app.patients p");
let added=0;
for(const p of plan.patients.filter(p=>p.index%10===5&&p.count>=4).slice(0,6)){
 const visits=plan.visits.filter(v=>v.patient.id===p.id).sort((a,b)=>a.at.localeCompare(b.at));
 if((Date.parse(visits[1].at)-Date.parse(p.birth_date))/31557600000<18)continue;
 const treatment=evaluationId('treatment',p.id),existing=sql(`SELECT count(*) FROM app.patient_treatments WHERE patient_id='${p.id}' AND id<>'${treatment}'`);
 if(existing!=='0')continue;
 const first=visits[1],changed=visits[3],snapshot=dose=>({status:'active',dose,dose_unit:'mg',frequency:'une prise par jour',timing:['matin'],instructions:null,start_date:first.at.slice(0,10),end_date:null});
 const old=JSON.stringify(snapshot('25')).replace(/'/g,"''"),current=JSON.stringify(snapshot('50')).replace(/'/g,"''"),name=medication.name.replace(/'/g,"''");
 sql(`BEGIN; SELECT set_config('request.jwt.claim.sub','${p.practitioner_id}',true);
 INSERT INTO app.patient_treatments(id,cabinet_id,practitioner_id,patient_id,medication_id,consultation_id,status,dose,dose_unit,frequency,timing,start_date,current_version,is_synthetic)
 VALUES('${treatment}','${p.cabinet_id}','${p.practitioner_id}','${p.id}','${medication.id}','${first.id}','active','50','mg','une prise par jour','["matin"]'::jsonb,'${first.at.slice(0,10)}',2,true) ON CONFLICT(id) DO NOTHING;
 INSERT INTO app.patient_treatment_history(id,treatment_id,version,action,previous_values,new_values,actor_id,occurred_at,consultation_id,is_synthetic,reason)
 VALUES('${evaluationId('treatment-start',p.id)}','${treatment}',1,'started',NULL,'${old}','${p.practitioner_id}','${first.at}','${first.id}',true,'Mise en route documentée pendant la séance.'),
 ('${evaluationId('treatment-change',p.id)}','${treatment}',2,'dose_changed','${old}','${current}','${p.practitioner_id}','${changed.at}','${changed.id}',true,'Difficultés encore présentes malgré une amélioration partielle.') ON CONFLICT(id) DO NOTHING;
 ${visits.slice(1).map((v,i)=>{const dose=i>=2?'50':'25',text=i===0?` Un traitement par ${name} à 25 mg par jour est documenté.`:i===2?` La dose documentée de ${name} passe de 25 mg à 50 mg par jour.`:` Le traitement par ${name} à ${dose} mg par jour est maintenu.`;return `UPDATE app.clinical_notes SET plan=plan||'${text}',structured=jsonb_set(structured,'{evaluation,medicationEnriched}','true') WHERE consultation_id='${v.id}' AND status='draft' AND lock_after IS NULL AND structured->'evaluation'->>'campaign'='clinical-20261022' AND NOT coalesce((structured->'evaluation'->>'medicationEnriched')::boolean,false);`;}).join('\n')}
 COMMIT;`);added++;
}
if(before!==sql("SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM app.patients p"))throw Error('IdentityChanged');
writeFileSync(path.join(root,'treatment-result.json'),JSON.stringify({patientsWithDocumentedMedicationCourse:added,identityPreserved:true}));
console.log(JSON.stringify({patientsWithDocumentedMedicationCourse:added,identityPreserved:true}));
