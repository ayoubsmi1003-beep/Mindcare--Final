/** Disposable synthetic database only. Every fixture and candidate function rolls back. */
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{Client}=require('pg');
const value=process.env.MINDCARE_ALEXA_EVAL_ADMIN_URL;
if(!value)throw Error('ExplicitDisposableDatabaseRequired');
const target=new URL(value);
if(!['postgres:','postgresql:'].includes(target.protocol)||!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/alexa_eval(?:_[a-z0-9_]+)?$/.test(target.pathname)||target.port==='55441')throw Error('DisposableDatabaseRequired');
const db=new Client({connectionString:value}),checks=[];
const owner='a1000000-0000-4000-8000-000000000001',assistant='a1000000-0000-4000-8000-000000000002',other='a1000000-0000-4000-8000-000000000003';
async function actor(id,role='authenticated'){
 await db.query('RESET ROLE');await db.query(role==='anon'?'SET LOCAL ROLE anon':'SET LOCAL ROLE authenticated');
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[id??'',JSON.stringify(id?{sub:id,role:'authenticated'}:{role:'anon'})]);
}
async function status(view='notifications',offset=0,revision=null){return (await db.query('SELECT app.get_alexa_office_status($1,$2,$3) value',[view,offset,revision])).rows[0].value;}
async function rejected(fn,code){await db.query('SAVEPOINT expected_failure');try{await assert.rejects(fn,e=>e.code===code);}finally{await db.query('ROLLBACK TO SAVEPOINT expected_failure');}}
async function check(name,fn){await fn();checks.push({name,status:'PASS'});console.log('PASS '+name);}
await db.connect();
let failure;
try{
 const preflight=(await db.query('SELECT current_database() name,count(*) FILTER(WHERE is_synthetic IS DISTINCT FROM true)::int unsafe FROM app.patients')).rows[0];
 assert.equal(preflight.name,target.pathname.slice(1));assert.equal(preflight.unsafe,0);
 const profiles=(await db.query('SELECT id,cabinet_id,role::text FROM app.profiles WHERE id=ANY($1::uuid[])',[[owner,assistant,other]])).rows;
 assert.equal(profiles.length,3);assert.equal(profiles.find(p=>p.id===owner)?.role,'owner');assert.equal(profiles.find(p=>p.id===assistant)?.role,'assistant');assert.equal(profiles.find(p=>p.id===other)?.role,'practitioner');
 const cabinet=profiles[0].cabinet_id;assert(profiles.every(p=>p.cabinet_id===cabinet));
 const otherCabinet=(await db.query('SELECT id FROM app.cabinets WHERE id<>$1 LIMIT 1',[cabinet])).rows[0]?.id;assert(otherCabinet);
 await db.query('BEGIN');
 if(!(await db.query("SELECT 1 FROM app.schema_migrations WHERE version='169_alexa_office_reads'")).rowCount){
  const migration=await readFile(fileURLToPath(new URL('../supabase/migrations/169_alexa_office_reads.sql',import.meta.url)),'utf8');
  await db.query(migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''));
 }
 if(!(await db.query("SELECT 1 FROM app.schema_migrations WHERE version='170_alexa_reminder_context'")).rowCount){
  const migration=await readFile(fileURLToPath(new URL('../supabase/migrations/170_alexa_reminder_context.sql',import.meta.url)),'utf8');
  await db.query(migration.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''));
 }
 await db.query("INSERT INTO app.notifications(cabinet_id,recipient_id,kind,payload,read_at) SELECT $1,$2,'fixture_'||lpad((n%23)::text,2,'0'),jsonb_build_object('private_fixture','MUST_NEVER_REACH_ALEXA'),CASE WHEN n%4=0 THEN now() END FROM generate_series(1,83)n",[cabinet,owner]);
 await db.query("INSERT INTO app.notifications(cabinet_id,recipient_role,kind,payload) VALUES($1,'assistant','fixture_assistant','{}'),($2,'owner','fixture_other_cabinet','{}')",[cabinet,otherCabinet]);
 const expected=new Map();
 for(const p of profiles)expected.set(p.id,(await db.query('SELECT count(*)::int total,count(*) FILTER(WHERE read_at IS NULL)::int unread,count(DISTINCT kind)::int kinds FROM app.notifications WHERE cabinet_id=$1 AND (recipient_id=$2 OR recipient_role::text=$3)',[cabinet,p.id,p.role])).rows[0]);
 await check('Exact totals beyond fifty notifications and bounded pagination',async()=>{
  await actor(owner);const first=await status(),oracle=expected.get(owner);assert.equal(first.total,oracle.total);assert.equal(first.unread,oracle.unread);assert.equal(first.totalKinds,oracle.kinds);assert.equal(first.kinds.length,20);assert.equal(first.hasMore,true);
  const second=await status('notifications',20,first.revision);assert.equal(second.total,first.total);assert.equal(second.unread,first.unread);assert.equal(second.revision,first.revision);assert.equal(second.hasMore,false);
  const kinds=[...first.kinds,...second.kinds];assert.equal(new Set(kinds.map(k=>k.kind)).size,oracle.kinds);assert.equal(kinds.reduce((n,k)=>n+k.total,0),oracle.total);assert(!JSON.stringify(first).includes('MUST_NEVER_REACH_ALEXA'));assert(!JSON.stringify(first).includes('payload'));
 });
 await check('Assistant and second practitioner retain their exact notification RLS scope',async()=>{
  for(const id of [assistant,other]){await actor(id);const r=await status(),e=expected.get(id);assert.equal(r.total,e.total);assert.equal(r.unread,e.unread);assert(!r.kinds.some(k=>k.kind==='fixture_other_cabinet'||k.kind.startsWith('fixture_0')));}
 });
 await check('Anonymous and missing authenticated identity are denied',async()=>{
  await actor(null,'anon');await rejected(()=>status(),'42501');await actor(null);await rejected(()=>status(),'42501');
 });
 await check('Closed view, bounds and irrelevant system cursor are enforced in SQL',async()=>{
  await actor(owner);for(const args of [['raw_sql',0,null],['notifications',-1,null],['notifications',10001,null],['system',1,null],['notifications',0,'invalid']])await rejected(()=>status(...args),'22023');
 });
 await check('Changed aggregate invalidates a saved notification page',async()=>{
  await actor(owner);const first=await status();await db.query('RESET ROLE');await db.query("INSERT INTO app.notifications(cabinet_id,recipient_id,kind,payload) VALUES($1,$2,'fixture_changed','{}')",[cabinet,owner]);await actor(owner);await rejected(()=>status('notifications',20,first.revision),'40001');
 });
 await check('System environment comes from the recorded deployment row',async()=>{
  await db.query('RESET ROLE');const environment=(await db.query('SELECT environment FROM app.deployment WHERE singleton')).rows[0].environment;await actor(owner);assert.deepEqual(await status('system'),{view:'system',environment});
 });
 await check('Reminder uses this patient even when another patient is scheduled first, without a one-year cutoff',async()=>{
  const patient='a3000000-0000-4000-8000-000000000001',nadia='a3000000-0000-4000-8000-000000000002';
  await db.query('RESET ROLE');
  await db.query("INSERT INTO app.appointments(cabinet_id,practitioner_id,patient_id,starts_at,ends_at,status,source,created_by,is_synthetic) VALUES ($1,$2,$3,'2032-01-03T08:00:00Z','2032-01-03T08:30:00Z','confirmed','doctor',$2,true),($1,$2,$4,'2032-01-03T07:00:00Z','2032-01-03T07:30:00Z','confirmed','doctor',$2,true)",[cabinet,owner,patient,nadia]);
  for(const id of [owner,assistant]){await actor(id);const r=(await db.query("SELECT app.get_alexa_reminder_context($1,'2030-01-01T00:00:00Z') value",[patient])).rows[0].value;assert.equal(r.patientId,patient);assert.equal(r.appointment.patientId,patient);assert.equal(Date.parse(r.appointment.startsAt),Date.parse('2032-01-03T08:00:00Z'));}
  await actor(owner);const empty=(await db.query("SELECT app.get_alexa_reminder_context($1,'2033-01-01T00:00:00Z') value",[patient])).rows[0].value;assert.equal(empty.appointment,null);
 });
 await check('Reminder preserves hidden/absent equivalence and authenticated RLS',async()=>{
  await actor(other);for(const patient of ['a3000000-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff'])await rejected(()=>db.query("SELECT app.get_alexa_reminder_context($1,'2030-01-01T00:00:00Z')",[patient]),'42501');
  await actor(null,'anon');await rejected(()=>db.query("SELECT app.get_alexa_reminder_context('a3000000-0000-4000-8000-000000000001','2030-01-01T00:00:00Z')"),'42501');
  await actor(owner);await rejected(()=>db.query("SELECT app.get_alexa_reminder_context('a3000000-0000-4000-8000-000000000001','infinity')"),'22023');
 });
}catch(error){failure=error;checks.push({name:'Checkpoint failure',status:'FAIL',code:error.code??error.name});}
finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
const report={at:new Date().toISOString(),status:failure?'FAIL':'PASS',database:target.hostname+':'+target.port+target.pathname,rollback:true,checks};
if(process.env.MINDCARE_ALEXA_OFFICE_REPORT)await writeFile(process.env.MINDCARE_ALEXA_OFFICE_REPORT,JSON.stringify(report,null,2));
if(failure)throw failure;
