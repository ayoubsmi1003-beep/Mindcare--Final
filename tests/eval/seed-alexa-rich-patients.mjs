/** Explicit isolated fixture mode only. All clinical content is fictional and not medically validated. */
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export async function seedRichAlexaPatients(client,fixture){
 const target=client.connectionParameters;
 if(target.host!=='127.0.0.1'||Number(target.port)!==55449||target.database!=='alexa_eval')throw Error('RichFixtureRequiresIsolatedDatabase');
 if((await client.query('SELECT count(*)::int n FROM app.patients WHERE is_synthetic IS DISTINCT FROM true')).rows[0].n)throw Error('NonSyntheticPatientsRefuseSeed');
 const tables=['patients','appointments','consultations','clinical_notes','clinical_note_amendments','diagnoses','medications','patient_treatments','patient_treatment_history','scales','scale_administrations','payments','charges','documents','document_drafts','document_draft_revisions'];
 const patientIds=new Set(Object.values(fixture.patients)),actorIds=new Set(Object.values(fixture.actors));
 if(fixture.version!==1||patientIds.size!==2||actorIds.size!==3)throw Error('UnexpectedRichFixture');
 for(const [table,rows]of Object.entries(fixture.records)){
  if(!tables.includes(table)||!Array.isArray(rows))throw Error('UnknownFixtureTable');
  for(const row of rows){
   if(row.cabinet_id&&row.cabinet_id!==fixture.cabinet.id)throw Error('FixtureCabinetMismatch');
   if(row.patient_id&&!patientIds.has(row.patient_id))throw Error('FixturePatientMismatch');
   if(row.practitioner_id&&!actorIds.has(row.practitioner_id))throw Error('FixtureActorMismatch');
   if('is_synthetic' in row&&row.is_synthetic!==true)throw Error('NonSyntheticFixtureRecord');
  }
 }
 const before=(await client.query('SELECT cabinet_id::text,count(*)::int n FROM app.patients WHERE cabinet_id<>$1 GROUP BY cabinet_id ORDER BY cabinet_id',[fixture.cabinet.id])).rows;
 await client.query('BEGIN');
 try{
  await client.query('INSERT INTO app.cabinets(id,name,address,phone) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[fixture.cabinet.id,fixture.cabinet.name,fixture.cabinet.address,fixture.cabinet.phone]);
  for(const [key,role]of [['owner','owner'],['assistant','assistant'],['other','practitioner']]){
   const actor=fixture.actors[key],fullName='FICTIF Alexa '+key;
   await client.query("INSERT INTO auth.users(id,email,encrypted_password,raw_user_meta_data) VALUES($1,$2,crypt('AlexaFixture-LocalOnly-2026',gen_salt('bf')),$3) ON CONFLICT DO NOTHING",[actor,'alexa-rich-'+key+'@evaluation.invalid',JSON.stringify({full_name:fullName})]);
   await client.query('INSERT INTO app.profiles(id,cabinet_id,role,full_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[actor,fixture.cabinet.id,role,fullName]);
   const p=(await client.query('SELECT cabinet_id,role::text FROM app.profiles WHERE id=$1',[actor])).rows[0];
   assert.equal(p?.cabinet_id,fixture.cabinet.id);assert.equal(p.role,role);
  }
  const versions=new Map();
  for(const template of fixture.templates){
   await client.query("INSERT INTO app.document_templates(id,cabinet_id,doc_type,version,title_fr,header_html,body_html,footer_html,is_active,content_json) SELECT $1,$2,doc_type,version,title_fr,header_html,body_html,footer_html,is_active,content_json FROM app.document_templates WHERE doc_type=$3 AND is_active AND content_json IS NOT NULL AND cabinet_id<>$2 ORDER BY version DESC,id LIMIT 1 ON CONFLICT DO NOTHING",[template.id,fixture.cabinet.id,template.kind]);
   const value=(await client.query('SELECT cabinet_id,doc_type::text,version FROM app.document_templates WHERE id=$1',[template.id])).rows[0];
   assert.equal(value?.cabinet_id,fixture.cabinet.id,'ApprovedDocumentTemplateRequired');assert.equal(value.doc_type,template.kind);versions.set(template.id,value.version);
  }
  for(const table of tables)for(const input of fixture.records[table]){
   const row={...input};if(row.template_id)row.template_version=versions.get(row.template_id);
   const columns=Object.keys(row);if(columns.some(k=>!/^[a-z_]+$/u.test(k)))throw Error('InvalidFixtureColumn');
   const values=columns.map(k=>row[k]!==null&&typeof row[k]==='object'?JSON.stringify(row[k]):row[k]);
   await client.query('INSERT INTO app.'+table+'('+columns.join(',')+') VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+') ON CONFLICT DO NOTHING',values);
  }
  for(const patient of fixture.records.patients){const stored=(await client.query('SELECT cabinet_id,is_synthetic,first_name,last_name FROM app.patients WHERE id=$1',[patient.id])).rows[0];assert.equal(stored?.cabinet_id,fixture.cabinet.id);assert.equal(stored.is_synthetic,true);assert.equal(stored.first_name,patient.first_name);assert.equal(stored.last_name,patient.last_name);}
  assert.deepEqual((await client.query('SELECT cabinet_id::text,count(*)::int n FROM app.patients WHERE cabinet_id<>$1 GROUP BY cabinet_id ORDER BY cabinet_id',[fixture.cabinet.id])).rows,before);
  await client.query('COMMIT');
  return {version:fixture.version,fixtureSha256:createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),scope:'Isolated alexa_eval only; existing cabinets unchanged',counts:Object.fromEntries(Object.entries(fixture.records).map(([table,rows])=>[table,rows.length])),patientIds:[...patientIds]};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
