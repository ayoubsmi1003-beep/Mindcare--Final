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
export function patientBindings(){return inspectSql("SELECT json_build_object('primary',(SELECT c.patient_id FROM app.consultations c JOIN app.patients p ON p.id=c.patient_id WHERE p.is_active GROUP BY c.patient_id HAVING count(*) BETWEEN 6 AND 10 ORDER BY c.patient_id LIMIT 1),'long',(SELECT patient_id FROM app.consultations GROUP BY patient_id HAVING count(*)>100 ORDER BY patient_id LIMIT 1),'missing',(SELECT id FROM app.patients WHERE id_document_number IS NULL AND is_active ORDER BY id LIMIT 1));")[0];}
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
export function recordOracle(domain,query,bindings,actor){
 return inspectSql(recordOracleSql(domain,query,bindings,actor))[0];
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
export function applicationOracle(query,asOf,actor){
 const cab=`(SELECT cabinet_id FROM app.profiles WHERE id=${literal(actor)}::uuid)`;
 if(query.view==='reception'){
  const day=new Date(Date.parse(asOf)+3600000).toISOString().slice(0,10),lo=`(${literal(day)}::date::timestamp AT TIME ZONE 'Africa/Algiers')`;
  if(!['waiting','requests'].includes(query.queue))throw Error('IndependentApplicationOracleRequired');
  const predicate=query.queue==='waiting'?`status='arrived' AND starts_at>=${lo} AND starts_at<${lo}+interval '1 day'`:`status='requested' AND starts_at>=${lo} AND starts_at<${lo}+interval '60 days'`;
  return {...inspectSql(`SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(id ORDER BY starts_at,id),'[]')) FROM app.appointments WHERE cabinet_id=${cab} AND ${predicate};`)[0],gate:'reception_board',day,queue:query.queue};
 }
 if(query.view==='medication_catalog'){
  const value=inspectSql(`SELECT json_build_object('total',count(*),'ids',coalesce(json_agg(id ORDER BY id),'[]'),'names',coalesce(json_agg(coalesce(source_raw_value,coalesce(brand_name,'')||' '||inn) ORDER BY id),'[]')) FROM app.medications WHERE (cabinet_id IS NULL OR cabinet_id=${cab}) AND is_active IS NOT FALSE AND position(app.immutable_unaccent(lower(${literal(query.query)})) IN normalized_search)>0;`)[0];
  return {...value,gate:'search_medications',query:query.query,method:'independent-candidate-membership-and-bounded-page',pageSize:Math.min(value.total,20)};
 }
 throw Error('IndependentApplicationOracleRequired');
}
