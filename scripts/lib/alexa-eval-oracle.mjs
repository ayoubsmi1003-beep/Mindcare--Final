import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseInspectionRows} from './alexa-eval-inspection-rows.mjs';

const descriptor=()=>{
 const x=JSON.parse(readFileSync('.cache/clinical-evaluation-20261022/isolation.json','utf8'));
 if(x.target!=='mindcare-evaluation-20261022'||x.database!=='alexa_eval_clinical_20261022'||x.port!==55444||x.restorationVerified!==true)throw Error('VerifiedEvaluationCopyRequired');
 return x;
};
export const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export function inspectSql(sql,{timeoutSeconds=30}={}){
 if(!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>1800)throw Error('InvalidInspectionTimeout');
 const x=descriptor();
 let output;
 try{output=execFileSync('docker',['exec','-i',x.target,'psql','-X','-U','postgres','-d',x.database,'-qAt','-R','\x1e','-v','ON_ERROR_STOP=1'],{input:`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='${timeoutSeconds}s';\n`+sql+'\nCOMMIT;',encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});}
 catch{throw Error('EvaluationInspectionUnavailable');} // Never expose captured rows or clinical SQL in process diagnostics.
 return parseInspectionRows(output);
}
export function businessSnapshot({auditThrough}={}){
 const through=auditThrough??auditMark();if(!Number.isSafeInteger(Number(through))||Number(through)<0)throw Error('InvalidAuditBoundary');
 const tables=inspectSql("SELECT coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname IN ('app','auth','audit') AND NOT(schemaname='audit' AND tablename='log');")[0];
 if(!Array.isArray(tables)||!tables.length||tables.some(t=>!/^\w+$/.test(t.schema)||!/^\w+$/.test(t.table)))throw Error('SnapshotInventoryRequired');
 const rows=inspectSql(tables.map(t=>`SELECT json_build_object('table',${literal(t.schema+'.'+t.table)},'count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')),'versions',md5(coalesce(string_agg(r.xmin::text,',' ORDER BY r.xmin::text),''))) FROM "${t.schema}"."${t.table}" r;`).join('\n'),{timeoutSeconds:1800});
 const sequences=inspectSql("SELECT coalesce(json_agg(json_build_object('schema',schemaname,'name',sequencename,'value',last_value) ORDER BY schemaname,sequencename),'[]') FROM pg_sequences WHERE schemaname IN ('app','auth','audit') AND format('%I.%I',schemaname,sequencename) IS DISTINCT FROM pg_get_serial_sequence('audit.log','id');")[0];
 const auditPrefix=inspectSql(`SELECT json_build_object('through',${Number(through)},'count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(r)::text||r.xmin::text),'' ORDER BY id),''))) FROM audit.log r WHERE id<=${Number(through)};`,{timeoutSeconds:1800})[0];
 return {...Object.fromEntries(rows.map(r=>[r.table,{count:r.count,hash:r.hash,versions:r.versions}])),$sequences:sequences,$auditPrefix:auditPrefix};
}
export function auditMark(){return inspectSql("SELECT json_build_object('id',coalesce(max(id),0)) FROM audit.log;")[0].id;}
export function auditChanges(mark){return inspectSql(`SELECT json_build_object('reads',count(*) FILTER(WHERE operation::text='select'),'unexpected',count(*) FILTER(WHERE operation::text<>'select')) FROM audit.log WHERE id>${Number(mark)};`)[0];}
export function sourceInventory(){return inspectSql("SELECT json_build_object('patients',(SELECT count(*) FROM app.patients),'generated',(SELECT count(*) FROM app.clinical_notes WHERE structured->'evaluation'->>'campaign'='clinical-20261022'),'migration',(SELECT max(version) FROM app.schema_migrations),'sources',(SELECT json_agg(json_build_object('id',id,'title',titre,'version',version,'status',statut,'eligible',classification='C4' AND statut='active' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND superseded_by IS NULL AND (review_due_at IS NULL OR review_due_at>now()))) FROM app.knowledge_sources));")[0];}
export function campaignActors(){return inspectSql("SELECT json_object_agg(role,id) FROM (SELECT DISTINCT ON(role) role,id FROM app.profiles WHERE role::text IN ('owner','assistant','practitioner') ORDER BY role,id) x;")[0];}
export function patientBindings(actor,asOf){
 const cabinet=actor?`p.cabinet_id=(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner')`:'true';
 const tomorrow=asOf?dayWindow(shiftDay(algeriaDay(asOf),1)):null;
 const namedAppointment=tomorrow?`AND EXISTS(SELECT 1 FROM app.appointments a WHERE a.patient_id=p.id AND a.status='confirmed' AND a.starts_at>=${literal(tomorrow.from)}::timestamptz AND a.starts_at<${literal(tomorrow.to)}::timestamptz)`:'';
 return inspectSql(`WITH primary_patient AS (
  SELECT p.id,p.first_name,p.last_name FROM app.patients p JOIN app.consultations c ON c.patient_id=p.id
  WHERE p.is_active AND ${cabinet} AND nullif(btrim(p.phone),'') IS NOT NULL
   AND (SELECT count(*) FROM app.patients p2 WHERE p2.cabinet_id=p.cabinet_id AND app.immutable_unaccent(lower(concat_ws(' ',btrim(p2.first_name),btrim(p2.last_name))))=app.immutable_unaccent(lower(concat_ws(' ',btrim(p.first_name),btrim(p.last_name)))))=1
   ${namedAppointment}
  GROUP BY p.id,p.first_name,p.last_name HAVING count(c.id) BETWEEN 6 AND 10
   AND EXISTS(SELECT 1 FROM app.clinical_notes n WHERE n.patient_id=p.id AND (length(coalesce(n.subjective,''))+length(coalesce(n.objective,''))+length(coalesce(n.assessment,''))+length(coalesce(n.plan,'')))>20)
  ORDER BY p.id LIMIT 1
 ) SELECT json_build_object('primary',(SELECT id FROM primary_patient),'primaryName',(SELECT concat_ws(' ',first_name,last_name) FROM primary_patient),
  'long',(SELECT c.patient_id FROM app.consultations c JOIN app.patients p ON p.id=c.patient_id WHERE p.is_active AND ${cabinet} GROUP BY c.patient_id HAVING count(*)>100 ORDER BY c.patient_id LIMIT 1),
  'missing',(SELECT p.id FROM app.patients p WHERE p.id_document_number IS NULL AND p.is_active AND ${cabinet} ORDER BY p.id LIMIT 1));`)[0];
}
const numeric=(expression,c)=>{if(!Number.isSafeInteger(c.value)||c.value<0)throw Error('InvalidOracleOperand');const op={eq:'=',gt:'>',gte:'>=',lt:'<',lte:'<='}[c.op];if(!op)throw Error('InvalidOracleOperator');return `(${expression}) ${op} ${c.value}`;};
function patientPredicate(c,query,asOf){
 const cols={phone:'p.phone',identity_card:'p.id_document_number',birth_date:'p.birth_date',sex:'p.sex'};
 if(cols[c.field]){
  if(c.field==='sex'&&c.op==='eq'&&['M','F'].includes(c.value))return `p.sex::text=${literal(c.value)}`;
  if(!['missing','present'].includes(c.op))throw Error('InvalidOraclePredicate');
  const missing=['phone','identity_card'].includes(c.field)?`nullif(regexp_replace(${cols[c.field]},'[\\s  ﻿]','','g'),'') IS NULL`:`${cols[c.field]} IS NULL`;
  return c.op==='missing'?`(${missing})`:`NOT (${missing})`;
 }
 const period=query.consultationPeriod;
 const axis=period?.axis==='ended_at'?'c.ended_at':'c.started_at';
 const visits=`SELECT count(*) FROM app.consultations c WHERE c.patient_id=p.id AND c.status='closed' AND c.ended_at IS NOT NULL AND c.started_at<=${literal(asOf)}::timestamptz ${period?`AND ${axis}>=${literal(period.from)}::timestamptz AND ${axis}<${literal(period.to)}::timestamptz`:''}`;
 if(c.field==='age')return numeric(`extract(year from age((${literal(asOf)}::timestamptz AT TIME ZONE 'Africa/Algiers')::date,p.birth_date))`,c);
 if(c.field==='completed_consultations')return numeric(`(${visits})`,c);
 if(c.field==='outstanding_balance')return numeric('(SELECT coalesce(sum(amount_dzd),0) FROM app.payments pay WHERE pay.patient_id=p.id AND collected_at IS NULL)',c);
 if(['no_completed_days','no_completed_months'].includes(c.field))return `NOT EXISTS(SELECT 1 FROM app.consultations c WHERE c.patient_id=p.id AND c.status='closed' AND c.ended_at IS NOT NULL AND c.started_at<=${literal(asOf)}::timestamptz AND c.started_at>=${literal(asOf)}::timestamptz - interval '${Number(c.value)} ${c.field.endsWith('days')?'days':'months'}')`;
 if(c.field==='administrative_incomplete')return '(p.birth_date IS NULL OR p.sex IS NULL OR nullif(btrim(p.phone),\'\') IS NULL OR nullif(btrim(p.id_document_number),\'\') IS NULL)';
 throw Error('UnsupportedOraclePredicate');
}
export function patientOracle(query,asOf,actor){
 if(!actor)throw Error('IndependentActorScopeRequired');
 const groups=query.filterGroups??[query.filters??[]];
 const where=[`p.cabinet_id=(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner')`,query.population==='all'?'true':query.population==='archived'?'NOT p.is_active':'p.is_active',`(${groups.map(g=>'('+g.map(c=>patientPredicate(c,query,asOf)).join(' AND ')+(g.length?'':'true')+')').join(' OR ')})`];
 if(query.createdPeriod)where.push(`p.created_at>=${literal(query.createdPeriod.from)}::timestamptz AND p.created_at<${literal(query.createdPeriod.to)}::timestamptz`);
 return inspectSql(`SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(id ORDER BY last_name,first_name,id),'[]'),'names',coalesce(json_agg(first_name||' '||last_name ORDER BY last_name,first_name,id),'[]')) FROM app.patients p WHERE ${where.join(' AND ')};`)[0];
}
export function patientDetailOracle(patientId,oracle,actor){
 if(!actor||!patientId)throw Error('IndependentPatientScopeRequired');
 const cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`;
 return inspectSql(`SELECT json_build_object(
  'patientId',p.id,'name',concat_ws(' ',p.first_name,p.last_name),'phone',p.phone,
  'consultationCount',(SELECT count(*) FROM app.consultations c WHERE c.patient_id=p.id),
  'closedCount',(SELECT count(*) FROM app.consultations c WHERE c.patient_id=p.id AND c.status='closed'),
  'noteCount',(SELECT count(*) FROM app.clinical_notes n WHERE n.patient_id=p.id),
  'latestConsultationIds',(SELECT coalesce(json_agg(x.id ORDER BY x.started_at DESC,x.id DESC),'[]') FROM (SELECT c.id,c.started_at FROM app.consultations c WHERE c.patient_id=p.id ORDER BY c.started_at DESC,c.id DESC LIMIT 20) x),
  'diagnoses',(SELECT coalesce(json_agg(json_build_object('id',d.id,'label',d.label,'resolved',d.resolved_at IS NOT NULL) ORDER BY d.created_at DESC,d.id DESC),'[]') FROM app.diagnoses d WHERE d.patient_id=p.id),
  'scales',(SELECT coalesce(json_agg(json_build_object('id',sa.id,'name',s.name_fr,'score',sa.total_score,'at',sa.administered_at) ORDER BY sa.administered_at DESC,sa.id DESC),'[]') FROM app.scale_administrations sa JOIN app.scales s ON s.id=sa.scale_id WHERE sa.patient_id=p.id),
  'treatments',(SELECT coalesce(json_agg(json_build_object('id',pt.id,'name',coalesce(m.source_raw_value,nullif(btrim(coalesce(m.brand_name,'')||' '||coalesce(m.inn,'')),'')),'status',pt.status::text) ORDER BY pt.updated_at DESC,pt.id DESC),'[]') FROM app.patient_treatments pt LEFT JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p.id)
 ) FROM app.patients p WHERE p.id=${literal(patientId)}::uuid AND p.cabinet_id=${cabinet};`)[0];
}
/** Reads the requested latest note sources independently and deliberately omits signature state. */
export function patientRecentConsultationsOracle(patientId,count,asOf,actor){
 if(!actor||!patientId||!Number.isSafeInteger(count)||count<1||count>10)throw Error('IndependentPatientScopeRequired');
 const cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`;
 return inspectSql(`SELECT coalesce(json_agg(json_build_object('id',x.id,'rawNotes',x.raw_notes,'notes',x.notes) ORDER BY x.started_at DESC,x.id DESC),'[]') FROM (
  SELECT c.id,c.started_at,c.raw_notes,json_build_object('subjective',n.subjective,'objective',n.objective,'assessment',n.assessment,'plan',n.plan) notes
  FROM app.consultations c LEFT JOIN LATERAL (SELECT cn.subjective,cn.objective,cn.assessment,cn.plan FROM app.clinical_notes cn WHERE cn.consultation_id=c.id ORDER BY cn.updated_at DESC,cn.id DESC LIMIT 1) n ON true
  WHERE c.patient_id=${literal(patientId)}::uuid AND c.cabinet_id=${cabinet} AND c.started_at<=${literal(asOf)}::timestamptz
  ORDER BY c.started_at DESC,c.id DESC LIMIT ${count}
 ) x;`)[0];
}
/** Recomputes a bounded note page directly from clinical source tables, omitting signature metadata. */
export function clinicalNotePageOracle(spec,asOf,actor){
 if(!actor||!spec?.patientId)throw Error('IndependentPatientScopeRequired');
 if(spec.query&&String(spec.query).trim())throw Error('IndependentNoteSearchOracleRequired');
 const area=spec.area??'all',status=spec.status??'all',offset=spec.offset??0,textOffset=spec.textOffset??0,cap=spec.maxCharacters??1200;
 const cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`;
 if(!['all','working','subjective','objective','assessment','plan','amendment','structured'].includes(area)||!['all','open','closed'].includes(status)||!Number.isInteger(offset)||offset<0||!Number.isInteger(textOffset)||textOffset<0||!Number.isInteger(cap)||cap<100||cap>1200)throw Error('IndependentNoteSpecUnsupported');
 const consultation=spec.consultationId?`AND c.id=${literal(spec.consultationId)}::uuid`:'';
 const period=spec.from?`AND c.started_at>=${literal(spec.from)}::timestamptz AND c.started_at<${literal(spec.to)}::timestamptz`:'';
 const query=`WITH consultations AS MATERIALIZED (SELECT c.* FROM app.consultations c WHERE c.patient_id=${literal(spec.patientId)}::uuid AND c.cabinet_id=${cabinet} AND c.started_at<=${literal(asOf)}::timestamptz ${consultation} AND (${literal(status)}='all' OR c.status::text=${literal(status)}) ${period}),
 fields AS MATERIALIZED (
  SELECT c.id consultation_id,c.started_at,c.id source_id,'working'::text area,0 priority,c.raw_notes body FROM consultations c
  UNION ALL SELECT c.id,c.started_at,coalesce(n.id,c.id),v.area,v.priority,v.body FROM consultations c LEFT JOIN app.clinical_notes n ON n.consultation_id=c.id CROSS JOIN LATERAL (VALUES('subjective',1,n.subjective),('objective',2,n.objective),('assessment',3,n.assessment),('plan',4,n.plan)) v(area,priority,body)
  UNION ALL SELECT c.id,c.started_at,a.id,'amendment',5,a.body FROM consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id JOIN app.clinical_note_amendments a ON a.note_id=n.id
  UNION ALL SELECT c.id,c.started_at,n.id,'structured',6,n.structured::text FROM consultations c JOIN app.clinical_notes n ON n.consultation_id=c.id WHERE ${literal(area)}='structured'
 ), selected AS MATERIALIZED (SELECT *,row_number() OVER(ORDER BY started_at DESC,consultation_id DESC,priority,source_id)-1 idx FROM fields WHERE (${literal(area)}='all' OR area=${literal(area)})),
 candidates AS MATERIALIZED (SELECT *,CASE WHEN idx=${offset} THEN ${textOffset} ELSE 0 END start_char FROM selected WHERE idx>=${offset} AND idx<${offset+5}),
 page AS MATERIALIZED (SELECT * FROM candidates WHERE idx<=coalesce((SELECT min(idx) FROM candidates WHERE length(coalesce(body,''))-start_char>${cap}),${offset+4})),
 last_row AS (SELECT * FROM page ORDER BY idx DESC LIMIT 1)
 SELECT json_build_object('patientId',${literal(spec.patientId)}::uuid,'total',(SELECT count(*) FROM selected),'rows',coalesce((SELECT json_agg(json_build_object('consultationId',consultation_id,'startedAt',started_at,'sourceId',source_id,'area',area,'text',substring(coalesce(body,'') FROM start_char+1 FOR ${cap}),'textLength',length(coalesce(body,'')),'textOffset',start_char) ORDER BY idx) FROM page),'[]'),'complete',NOT EXISTS(SELECT 1 FROM last_row WHERE length(coalesce(body,''))>start_char+${cap} OR idx<(SELECT count(*)-1 FROM selected)))`;
 return inspectSql(query)[0];
}
/** Rebuilds the timeline from its contributing tables, with actor cabinet scope and no timeline RPC. */
export function patientTimelineOracle(patientId,args,actor){
 if(!actor||!patientId)throw Error('IndependentPatientScopeRequired');
 const cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`,limit=Math.min(Math.max(Number(args.p_limit??20),1),50);
 if(!Number.isInteger(limit))throw Error('IndependentTimelineLimitUnsupported');
 const before=args.p_before_at?`AND (e.occurred_at,e.event_id)<(${literal(args.p_before_at)}::timestamptz,${literal(args.p_before_id)}::uuid)`:'';
 const sql=`WITH events AS (
  SELECT coalesce(c.ended_at,c.started_at) occurred_at,c.id event_id,'consultation'::text event_type,CASE WHEN c.status='closed' THEN 'consultation_close' ELSE 'consultation_ouverte' END::text label_key,jsonb_build_object('status',c.status,'kind',a.kind) detail FROM app.consultations c LEFT JOIN app.appointments a ON a.id=c.appointment_id WHERE c.patient_id=${literal(patientId)}::uuid AND c.cabinet_id=${cabinet}
  UNION ALL SELECT n.signed_at,n.id,'note'::text,'note_signee'::text,jsonb_build_object('consultation_id',n.consultation_id) FROM app.clinical_notes n WHERE n.patient_id=${literal(patientId)}::uuid AND n.cabinet_id=${cabinet} AND n.signed_at IS NOT NULL
  UNION ALL SELECT d.created_at,d.id,'diagnostic'::text,'diagnostic_pose'::text,jsonb_build_object('label',d.label,'code',d.code,'code_system',d.code_system,'is_primary',d.is_primary,'onset_date',d.onset_date) FROM app.diagnoses d WHERE d.patient_id=${literal(patientId)}::uuid AND d.cabinet_id=${cabinet}
  UNION ALL SELECT d.resolved_at::timestamp AT TIME ZONE 'Africa/Algiers',d.id,'diagnostic'::text,'diagnostic_resolu'::text,jsonb_build_object('label',d.label,'code',d.code,'code_system',d.code_system) FROM app.diagnoses d WHERE d.patient_id=${literal(patientId)}::uuid AND d.cabinet_id=${cabinet} AND d.resolved_at IS NOT NULL
  UNION ALL SELECT px.prescribed_at,px.id,'prescription'::text,'prescription'::text,jsonb_build_object('is_handwritten',px.is_handwritten,'nombre_lignes',(SELECT count(*) FROM app.prescription_lines pl WHERE pl.prescription_id=px.id)) FROM app.prescriptions px WHERE px.patient_id=${literal(patientId)}::uuid AND px.cabinet_id=${cabinet}
  UNION ALL SELECT sa.administered_at,sa.id,'echelle'::text,'echelle'::text,jsonb_build_object('scale_code',s.code,'scale_name',s.name_fr,'score',sa.total_score) FROM app.scale_administrations sa JOIN app.scales s ON s.id=sa.scale_id WHERE sa.patient_id=${literal(patientId)}::uuid AND sa.cabinet_id=${cabinet}
  UNION ALL SELECT a.starts_at,a.id,'rdv'::text,'rdv'::text,jsonb_build_object('status',a.status,'kind',a.kind,'source',a.source) FROM app.appointments a WHERE a.patient_id=${literal(patientId)}::uuid AND a.cabinet_id=${cabinet}
  UNION ALL SELECT dc.issued_at,dc.id,'document'::text,'document'::text,jsonb_build_object('doc_type',dc.doc_type,'doc_number',dc.doc_number) FROM app.documents dc WHERE dc.patient_id=${literal(patientId)}::uuid AND dc.cabinet_id=${cabinet}
  UNION ALL SELECT h.occurred_at,h.id,'traitement'::text,CASE h.action WHEN 'started' THEN 'traitement_commence' WHEN 'dose_changed' THEN 'traitement_dose_modifiee' WHEN 'schedule_changed' THEN 'traitement_horaire_modifie' WHEN 'paused' THEN 'traitement_pause' WHEN 'resumed' THEN 'traitement_repris' WHEN 'stopped' THEN 'traitement_arrete' WHEN 'renewed' THEN 'traitement_renouvele' ELSE 'traitement_commence' END::text,jsonb_build_object('treatment_id',h.treatment_id,'action',h.action,'medication_raw',m.source_raw_value,'brand_name',m.brand_name,'previous_values',h.previous_values,'new_values',h.new_values,'reason',h.reason,'consultation_id',h.consultation_id,'version',h.version) FROM app.patient_treatment_history h JOIN app.patient_treatments pt ON pt.id=h.treatment_id JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=${literal(patientId)}::uuid AND pt.cabinet_id=${cabinet}
 ) SELECT coalesce(json_agg(json_build_object('occurred_at',x.occurred_at,'event_id',x.event_id,'event_type',x.event_type,'label_key',x.label_key,'detail',x.detail) ORDER BY x.occurred_at DESC,x.event_id DESC),'[]') FROM (SELECT occurred_at,event_id,event_type,label_key,detail FROM events e WHERE occurred_at IS NOT NULL ${before} ORDER BY occurred_at DESC,event_id DESC LIMIT ${limit}) x;`;
 return inspectSql(sql)[0];
}
export function recordOracle(domain,query,bindings,actor){
 return inspectSql(recordOracleSql(domain,query,bindings,actor))[0];
}
export function recordComparisonOracleSql({patientId,axis,status,from,to},actor){
 if(!actor||!['started_at','ended_at'].includes(axis)||!['all','closed','open'].includes(status)||!from||!to||Date.parse(from)>=Date.parse(to))throw Error('IndependentComparisonOracleRequired');
 const time=`t.${axis}`;
 return `SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(t.id ORDER BY ${time},t.id),'[]')) FROM app.consultations t WHERE t.cabinet_id=(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner') ${patientId?`AND t.patient_id=${literal(patientId)}::uuid`:''} AND ${time}>=${literal(from)}::timestamptz AND ${time}<${literal(to)}::timestamptz AND (${literal(status)}='all' OR t.status::text=${literal(status)});`;
}
/** Independently counts each explicitly named month from the consultation table. */
export function recordComparisonOracle(spec,bindings,actor){
 if(!actor||spec?.kind!=='record_comparison'||spec.domain!=='consultations'||!Array.isArray(spec.query?.periods)||spec.query.periods.length!==2)throw Error('IndependentComparisonOracleRequired');
 const query=spec.query,patientId=query.patientRef?bindings[query.patientRef]:query.patientId??null;
 if(query.patientRef&&!patientId)throw Error('MissingPatientBinding');
 const {axis,status}=query;
 if(!['started_at','ended_at'].includes(axis)||!['all','closed','open'].includes(status))throw Error('IndependentComparisonOracleRequired');
 const periods=query.periods;
 const parseMonth=period=>{
  const match=typeof period?.from==='string'?period.from.match(/^(\d{4})-(\d{2})-01T00:00:00\+01:00$/u):null;
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return null;
  const next=month===12?{year:year+1,month:1}:{year,month:month+1};
  const expectedTo=`${next.year}-${String(next.month).padStart(2,'0')}-01T00:00:00+01:00`;
  return period.to===expectedTo?{year,month}:null;
 };
 const parsed=periods.map(parseMonth);
 const monthOrdinal=month=>month.year*12+month.month;
 if(parsed.some(month=>!month)||periods.some((period,index)=>typeof period.label!=='string'||!period.label.trim()||(index>0&&periods[index-1].to!==period.from))||monthOrdinal(parsed[1])!==monthOrdinal(parsed[0])+1)throw Error('IndependentComparisonOracleRequired');
 return {domain:'consultations',...(patientId?{patientId}:{}),axis,status,periods:periods.map(period=>({...period,...inspectSql(recordComparisonOracleSql({patientId,axis,status,from:period.from,to:period.to},actor))[0]}))};
}
export function recordOracleSql(domain,query,bindings,actor){
 if(!actor)throw Error('IndependentActorScopeRequired');
 const tables={agenda:'appointments',consultations:'consultations',finance:'payments',documents:query.status==='draft'?'document_drafts':'documents'};
 const table=tables[domain];if(!table)throw Error('UnsupportedOracleDomain');
 if(query.status==='compare')throw Error('IndependentComparisonOracleRequired');
 let axis=domain==='agenda'?'starts_at':domain==='consultations'?(query.axis==='ended_at'?'ended_at':'started_at'):domain==='finance'?(query.state==='collected'?'collected_at':'created_at'):query.status==='draft'?'updated_at':'issued_at';
 const cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner')`;
 const where=[`cabinet_id=${cabinet}`];
 if(query.patientRef){const id=bindings[query.patientRef];if(!id)throw Error('MissingPatientBinding');where.push(`patient_id=${literal(id)}::uuid`);}
 if(query.from&&query.to)where.push(`${axis}>=${literal(query.from)}::timestamptz AND ${axis}<${literal(query.to)}::timestamptz`);
 if(domain==='consultations'&&query.status&&query.status!=='all')where.push(query.status==='unsigned'?"EXISTS(SELECT 1 FROM app.clinical_notes n WHERE n.consultation_id=t.id AND n.status='draft')":`status::text=${literal(query.status)}`);
 if(domain==='agenda')where.push(query.statuses?`status::text IN (${query.statuses.map(literal).join(',')})`:"status<>'cancelled'");
 if(domain==='finance'&&query.state&&query.state!=='all')where.push(query.state==='collected'?'collected_at IS NOT NULL':'collected_at IS NULL');
 if(domain==='documents'&&query.status!=='draft')where.push(`status::text=${literal(query.status??'issued')}`);
 if(domain==='documents'&&query.status==='draft')where.push('archived_at IS NULL AND issued_document_id IS NULL');
 if(domain==='documents'&&query.kind)where.push(`doc_type::text=${literal(query.kind)}`);
 const amount=domain==='finance'?",'amount',coalesce(sum(amount_dzd),0),'pendingDzd',coalesce(sum(amount_dzd) FILTER(WHERE collected_at IS NULL),0),'collectedDzd',coalesce(sum(amount_dzd) FILTER(WHERE collected_at IS NOT NULL),0)":'';
 const unpriced=domain==='finance'?`, 'unpriced',(SELECT count(*) FROM app.consultations c WHERE c.cabinet_id=${cabinet}
  AND NOT EXISTS(SELECT 1 FROM app.payments pay WHERE pay.consultation_id=c.id)
  ${query.patientRef?`AND c.patient_id=${literal(bindings[query.patientRef])}::uuid`:''}
  ${query.from&&query.to?`AND c.started_at>=${literal(query.from)}::timestamptz AND c.started_at<${literal(query.to)}::timestamptz`:''})`:'';
 const paymentRows=domain==='finance'&&query.mode==='list'?`, 'payments',coalesce(json_agg(json_build_object('id',id,'patientId',patient_id,'amount',amount_dzd,'at',${axis},'status',CASE WHEN collected_at IS NULL THEN 'pending' ELSE 'collected' END,'label',(SELECT p.first_name||' '||p.last_name FROM app.patients p WHERE p.id=t.patient_id)) ORDER BY ${axis} DESC,id),'[]')`:'';
 const first=domain==='agenda'&&query.mode==='first'?`, 'first',(SELECT json_build_object('id',t.id,'patientId',t.patient_id,'name',(SELECT p.first_name||' '||p.last_name FROM app.patients p WHERE p.id=t.patient_id),'at',t.starts_at,'status',t.status) FROM app.appointments t WHERE ${where.join(' AND ')} ORDER BY starts_at,id LIMIT 1)`:'';
 return `SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(id ORDER BY ${axis} ${domain==='agenda'?'ASC':'DESC'},id),'[]')${amount}${unpriced}${paymentRows}${first}) FROM app.${table} t WHERE ${where.length?where.join(' AND '):'true'};`;
}
export function knowledgeOracle(book,terms){
 const title=book==='dsm'?'DSM-5 — Manuel diagnostique et statistique des troubles mentaux':book==='taylor'?'The Maudsley Prescribing Guidelines in Psychiatry':null;
 if(!title)throw Error('UnreleasedKnowledgeSource');
 return inspectSql(`SELECT json_build_object('sources',coalesce(json_agg(x),'[]')) FROM (SELECT c.id,s.id source_id,s.version,c.section,c.texte FROM app.knowledge_sources s JOIN app.knowledge_chunks c ON c.source_id=s.id WHERE s.titre=${literal(title)} AND s.classification='C4' AND s.statut='active' AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL AND s.superseded_by IS NULL AND (s.review_due_at IS NULL OR s.review_due_at>now()) AND c.statut='active' AND c.document_tsv @@ plainto_tsquery('simple',app.immutable_unaccent(${literal(terms)})) ORDER BY c.id LIMIT 20) x;`)[0];
}
export const evidenceHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function applicationOracle(query,asOf,actor,inspect=inspectSql){
 const cab=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`;
 if(query.view==='cabinet'){
  const row=inspect(`SELECT json_build_object('id',c.id,'name',c.name,'address',c.address,'phone',c.phone) FROM app.cabinets c WHERE c.id=${cab};`)[0];
  return {...row,view:'cabinet',gate:'get_my_cabinet',args:{},requiredFields:['name','address','phone']};
 }
 if(query.view==='practitioner'){
  const row=inspect(`SELECT json_build_object('id',p.id,'full_name',p.full_name,'title',p.title,'speciality_fr',p.speciality_fr,'speciality_ar',p.speciality_ar,'order_number',p.order_number,'phone',p.phone) FROM app.profiles p WHERE p.id=${literal(actor)}::uuid;`)[0];
  return {...row,view:'practitioner',gate:'get_my_profile',args:{},requiredFields:['order_number']};
 }
 if(query.view==='system'){
  const row=inspect("SELECT json_build_object('environment',environment) FROM app.deployment WHERE singleton;")[0],date=new Date(asOf),timezone='Africa/Algiers';
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date),localTime=new Intl.DateTimeFormat('fr-FR',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
  return {...row,view:'system',gate:'get_alexa_office_status',args:{p_view:'system',p_offset:0,p_revision:null},localDate,localTime};
 }
 if(query.view==='notifications'){
  const value=inspect(`SELECT json_build_object('total',coalesce(sum(total),0),'unread',coalesce(sum(unread),0),'totalKinds',count(*)) FROM (SELECT kind,count(*) AS total,count(*) FILTER(WHERE read_at IS NULL) AS unread FROM app.notifications WHERE cabinet_id=${cab} AND (recipient_id=${literal(actor)}::uuid OR recipient_role=(SELECT role FROM app.profiles WHERE id=${literal(actor)}::uuid)) GROUP BY kind) visible_notifications;`)[0];
  return {...value,view:'notifications',gate:'get_alexa_office_status',args:{p_view:'notifications',p_offset:0,p_revision:null}};
 }
 if(query.view==='reception'){
  const day=new Date(Date.parse(asOf)+3600000).toISOString().slice(0,10),lo=`(${literal(day)}::date::timestamp AT TIME ZONE 'Africa/Algiers')`;
  if(!['waiting','requests'].includes(query.queue))throw Error('IndependentApplicationOracleRequired');
  const predicate=query.queue==='waiting'?`status='arrived' AND starts_at>=${lo} AND starts_at<${lo}+interval '1 day'`:`status='requested' AND starts_at>=${lo} AND starts_at<${lo}+interval '60 days'`;
  return {...inspect(`SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(id ORDER BY starts_at,id),'[]')) FROM app.appointments WHERE cabinet_id=${cab} AND ${predicate};`)[0],view:'reception',gate:'reception_board',day,queue:query.queue};
 }
 if(query.view==='medication_catalog'){
  const value=inspect(`SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(id ORDER BY id),'[]'),'names',coalesce(json_agg(coalesce(source_raw_value,coalesce(brand_name,'')||' '||inn) ORDER BY id),'[]')) FROM app.medications WHERE (cabinet_id IS NULL OR cabinet_id=${cab}) AND is_active IS NOT FALSE AND position(app.immutable_unaccent(lower(${literal(query.query)})) IN normalized_search)>0;`)[0];
  return {...value,view:'medication_catalog',gate:'search_medications',query:query.query,method:'independent-candidate-membership-and-bounded-page',pageSize:Math.min(value.total,20)};
 }
 throw Error('IndependentApplicationOracleRequired');
}
const algeriaDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Algiers'}).format(new Date(value));
const shiftDay=(day,offset)=>{const value=new Date(`${day}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);};
const dayWindow=day=>({from:`${day}T00:00:00+01:00`,to:`${shiftDay(day,1)}T00:00:00+01:00`});
const monthWindow=value=>{const day=algeriaDay(value),from=day.slice(0,7)+'-01',parts=from.split('-').map(Number),to=new Date(Date.UTC(parts[0],parts[1],1)).toISOString().slice(0,10);return {from:`${from}T00:00:00+01:00`,to:`${to}T00:00:00+01:00`};};
function mixedAgendaOracle(query,actor){
 const result=recordOracle('agenda',query,{},actor),cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid AND role='owner')`,where=[`a.cabinet_id=${cabinet}`,`a.starts_at>=${literal(query.from)}::timestamptz`,`a.starts_at<${literal(query.to)}::timestamptz`,query.statuses?`a.status::text IN (${query.statuses.map(literal).join(',')})`:"a.status<>'cancelled'"];
 const named=inspectSql(`SELECT coalesce(json_agg(json_build_object('id',x.id,'name',x.name,'status',x.status) ORDER BY x.starts_at,x.id),'[]') FROM (SELECT a.id,concat_ws(' ',p.first_name,p.last_name) name,a.status::text status,a.starts_at FROM app.appointments a LEFT JOIN app.patients p ON p.id=a.patient_id WHERE ${where.join(' AND ')} ORDER BY a.starts_at,a.id LIMIT ${Math.min(20,Math.max(1,Number(query.limit??20)))}) x;`)[0];
 return {...result,namedRows:named};
}
/** Computes mixed patient, agenda, and finance examples from their separate source tables. */
export function mixedAppOracle(spec,asOf,actor,bindings){
 if(!actor)throw Error('IndependentActorScopeRequired');
 const intent=spec.semantics?.intent,checks=[],patient=(query,terms,limit)=>checks.push({kind:'patients',query,result:patientOracle(query,asOf,actor),terms,...(limit?{listLimit:limit}:{})}),record=(domain,query,terms,unit,limit)=>checks.push({kind:'records',domain,query,result:domain==='agenda'?mixedAgendaOracle(query,actor):recordOracle(domain,query,bindings,actor),terms,...(unit?{unit}:{}),...(limit?{listLimit:limit}:{})});
 const tomorrow=dayWindow(shiftDay(algeriaDay(asOf),1)),month=monthWindow(asOf),identity=[{field:'identity_card',op:'missing',value:null}],phone=[{field:'phone',op:'missing',value:null}],adult=[{field:'age',op:'gte',value:18}];
 if(intent==='count_two_patient_populations'){
  patient({mode:'count',filters:identity},['cni','carte d’identité']);patient({mode:'count',filters:phone},['téléphone']);
 }else if(intent==='count_and_list_one_patient_population'){
  patient({mode:'list',filters:identity},['cni','sans carte'],20);
 }else if(intent==='count_and_list_appointments'){
  record('agenda',{...tomorrow,limit:5},['rendez-vous','rdv'],undefined,5);
 }else if(['independent_finance_and_agenda_totals','independent_patient_finance_and_agenda_totals'].includes(intent)){
  if(spec.id==='mixed-app-09')patient({mode:'count',filters:identity},['cni','carte d’identité']);
  record('finance',{mode:'totals',state:'collected',...month},['encaissements','recettes'],'DZD');
  record('agenda',tomorrow,['rendez-vous','rdv']);
 }else if(intent==='agenda_list_and_count'){
  record('agenda',{...tomorrow,statuses:['confirmed'],limit:20},['confirmés','confirmées','rendez-vous'],undefined,20);
  record('agenda',tomorrow,['total','prévus','rendez-vous']);
 }else if(intent==='filtered_patient_count'||intent==='filtered_patient_list_and_count'){
  const names=spec.semantics?.filters??[],filters=[];
  if(names.includes('age_gte_18'))filters.push(...adult);
  if(names.includes('identity_card_missing'))filters.push(...identity);
  if(names.includes('phone_missing'))filters.push(...phone);
  const visit=names.find(name=>/^completed_consultations_gte_\d+$/u.test(name));
  if(visit)filters.push({field:'completed_consultations',op:'gte',value:Number(visit.match(/\d+$/u)[0])});
  patient({mode:intent==='filtered_patient_list_and_count'?'list':'count',filters},names.includes('phone_missing')?['téléphone','patients']:['adulte','cni','patients'],intent==='filtered_patient_list_and_count'?20:undefined);
 }else throw Error('IndependentMixedAppOracleRequired');
 return {intent,checks};
}
const dayBefore=value=>{const d=new Date(`${value}T00:00:00.000Z`);if(!Number.isFinite(d.valueOf()))throw Error('InvalidOracleDate');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
/** Independently recomputes the finance dashboard from source rows, not its RPC. */
export function financeViewOracle(oracle,asOf,actor){
 if(!actor)throw Error('IndependentActorScopeRequired');
 const view=oracle.view,defaultEnd=String(asOf).slice(0,10),from=oracle.from_?String(oracle.from_).slice(0,10):defaultEnd.slice(0,7)+'-01',to=oracle.to?dayBefore(String(oracle.to).slice(0,10)):defaultEnd;
 const fromLit=literal(from),toLit=literal(to),cabinet=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`;
 const sql=`WITH params AS (SELECT ${fromLit}::date AS p_from,${toLit}::date AS p_to),
 months AS (SELECT m::date AS month_start,(m+interval '1 month')::date AS month_end,GREATEST(m::date,p.p_from) AS effective_start,LEAST((m+interval '1 month'-interval '1 day')::date,p.p_to) AS effective_end FROM params p CROSS JOIN LATERAL generate_series(date_trunc('month',p.p_from::timestamp),date_trunc('month',p.p_to::timestamp),interval '1 month') m),
 one_time AS (SELECT COALESCE(SUM(c.montant_dzd),0)::numeric AS amount FROM app.charges c,params p WHERE c.cabinet_id=${cabinet} AND c.actif AND c.type='ponctuelle' AND c.date_charge BETWEEN p.p_from AND p.p_to),
 recurring AS (SELECT COALESCE(SUM((CASE c.frequence WHEN 'mensuelle' THEN c.montant_dzd::numeric WHEN 'trimestrielle' THEN c.montant_dzd::numeric/3 WHEN 'annuelle' THEN c.montant_dzd::numeric/12 ELSE 0 END)*((m.effective_end-GREATEST(m.effective_start,c.date_charge)+1)::numeric/(m.month_end-m.month_start)::numeric)),0)::numeric AS amount FROM months m JOIN app.charges c ON c.cabinet_id=${cabinet} AND c.actif AND c.type='recurrente' AND c.date_charge<=m.effective_end WHERE m.effective_end>=m.effective_start),
 categories AS (SELECT cle,round(SUM(amount))::bigint AS amount FROM (SELECT c.categorie::text AS cle,SUM(c.montant_dzd)::numeric AS amount FROM app.charges c,params p WHERE c.cabinet_id=${cabinet} AND c.actif AND c.type='ponctuelle' AND c.date_charge BETWEEN p.p_from AND p.p_to GROUP BY 1 UNION ALL SELECT c.categorie::text AS cle,SUM((CASE c.frequence WHEN 'mensuelle' THEN c.montant_dzd::numeric WHEN 'trimestrielle' THEN c.montant_dzd::numeric/3 WHEN 'annuelle' THEN c.montant_dzd::numeric/12 ELSE 0 END)*((m.effective_end-GREATEST(m.effective_start,c.date_charge)+1)::numeric/(m.month_end-m.month_start)::numeric))::numeric FROM months m JOIN app.charges c ON c.cabinet_id=${cabinet} AND c.actif AND c.type='recurrente' AND c.date_charge<=m.effective_end WHERE m.effective_end>=m.effective_start GROUP BY 1) x GROUP BY cle),
payments AS (SELECT COALESCE(SUM(pay.amount_dzd) FILTER(WHERE pay.created_at>=(prm.p_from::timestamp AT TIME ZONE 'Africa/Algiers') AND pay.created_at<((prm.p_to+1)::timestamp AT TIME ZONE 'Africa/Algiers')),0)::bigint AS created_amount,COUNT(*) FILTER(WHERE pay.created_at>=(prm.p_from::timestamp AT TIME ZONE 'Africa/Algiers') AND pay.created_at<((prm.p_to+1)::timestamp AT TIME ZONE 'Africa/Algiers'))::bigint AS created_count,COALESCE(SUM(pay.amount_dzd) FILTER(WHERE pay.collected_at>=(prm.p_from::timestamp AT TIME ZONE 'Africa/Algiers') AND pay.collected_at<((prm.p_to+1)::timestamp AT TIME ZONE 'Africa/Algiers')),0)::bigint AS collected_amount,COUNT(*) FILTER(WHERE pay.collected_at>=(prm.p_from::timestamp AT TIME ZONE 'Africa/Algiers') AND pay.collected_at<((prm.p_to+1)::timestamp AT TIME ZONE 'Africa/Algiers'))::bigint AS collected_count,COALESCE(SUM(pay.amount_dzd) FILTER(WHERE pay.collected_at IS NULL),0)::bigint AS outstanding_amount,COUNT(*) FILTER(WHERE pay.collected_at IS NULL)::bigint AS outstanding_count FROM app.payments pay CROSS JOIN params prm WHERE pay.cabinet_id=${cabinet}),
 unpriced AS (SELECT COUNT(*)::bigint AS count FROM app.consultations c WHERE c.cabinet_id=${cabinet} AND c.status='closed' AND NOT EXISTS(SELECT 1 FROM app.payments p WHERE p.consultation_id=c.id)),
 charge_rows AS (SELECT COALESCE(json_agg(json_build_object('id',c.id,'name',c.intitule,'amount',c.montant_dzd,'category',c.categorie::text,'type',c.type::text,'frequency',c.frequence::text,'date',c.date_charge::text) ORDER BY c.type,c.montant_dzd DESC,c.intitule),'[]'::json) AS rows FROM app.charges c WHERE c.cabinet_id=${cabinet} AND c.actif)
 SELECT json_build_object('view',${literal(view)},'from',${fromLit},'to',${toLit},'recurringMonthly',(SELECT round(COALESCE(SUM(CASE c.frequence WHEN 'mensuelle' THEN c.montant_dzd::numeric WHEN 'trimestrielle' THEN c.montant_dzd::numeric/3 WHEN 'annuelle' THEN c.montant_dzd::numeric/12 ELSE 0 END),0))::bigint FROM app.charges c WHERE c.cabinet_id=${cabinet} AND c.actif AND c.type='recurrente'),'punctualPeriod',(SELECT amount::bigint FROM one_time),'recurringRows',(SELECT COALESCE(json_agg(r),'[]'::json) FROM (SELECT json_build_object('id',c.id,'name',c.intitule,'amount',c.montant_dzd,'category',c.categorie::text,'frequency',c.frequence::text) AS r FROM app.charges c WHERE c.cabinet_id=${cabinet} AND c.actif AND c.type='recurrente' ORDER BY c.intitule) r),'allChargeRows',(SELECT rows FROM charge_rows),'chargeTotal',round((SELECT amount FROM one_time)+(SELECT amount FROM recurring))::bigint,'chargeCategories',(SELECT COALESCE(json_agg(json_build_object('category',cle,'amount',amount,'part_pct',CASE WHEN round((SELECT amount FROM one_time)+(SELECT amount FROM recurring))=0 THEN 0 ELSE round(100.0*amount/round((SELECT amount FROM one_time)+(SELECT amount FROM recurring)),1) END) ORDER BY amount DESC,cle),'[]'::json) FROM categories),'createdAmount',(SELECT created_amount FROM payments),'createdCount',(SELECT created_count FROM payments),'collectedAmount',(SELECT collected_amount FROM payments),'collectedCount',(SELECT collected_count FROM payments),'outstandingAmount',(SELECT outstanding_amount FROM payments),'outstandingCount',(SELECT outstanding_count FROM payments),'unpricedCount',(SELECT count FROM unpriced),'net',((SELECT collected_amount FROM payments)-round((SELECT amount FROM one_time)+(SELECT amount FROM recurring))::bigint));`;
 const expected=inspectSql(sql)[0];
 return {...expected,gateOptions:view==='charges'||view==='recurring_charges'?['get_charges_list']:view==='compare_dates'||view==='unpriced'?['query_alexa_records','get_finance_overview']:['get_finance_overview']};
}
