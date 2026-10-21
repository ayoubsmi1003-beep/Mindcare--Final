import { spawnSync } from 'node:child_process';
import pg from 'pg';
process.loadEnvFile('.env');
const admin = spawnSync('docker', ['exec', 'mc-p3', 'psql', '-U', 'postgres', '-d', 'mindcare', '-Atc', "SELECT json_build_object('id',u.id) FROM auth.users u JOIN app.profiles p ON p.id=u.id WHERE p.role='owner' AND p.is_active ORDER BY u.created_at LIMIT 1"], {encoding:'utf8'});
if(admin.status!==0) throw new Error('Local account lookup failed');
const account=JSON.parse(admin.stdout.trim());
const client=new pg.Client({connectionString:process.env.MINDCARE_DATABASE_URL});
await client.connect();
try {
 await client.query('BEGIN');
 await client.query('SET LOCAL ROLE authenticated');
 await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[account.id]);
 for(let round=0;round<3;round++) for(const [name,sql,args] of [
  ['patients-list','SELECT * FROM app.search_patients(p_query := $1,p_limit := $2,p_offset := $3)',[null,25,0]],
  ['patients-search','SELECT * FROM app.search_patients(p_query := $1,p_limit := $2,p_offset := $3)',['Salmi',25,0]],
  ['medications','SELECT * FROM app.search_medications(p_query := $1,p_limit := $2)',['doliprane',20]],
 ]) {
  await client.query('SAVEPOINT probe');const start=performance.now();
  try { const r=await client.query(sql,args);console.log(JSON.stringify({name,round,ms:Math.round(performance.now()-start),rows:r.rowCount})); }
  catch(e){console.log(JSON.stringify({name,code:e.code}));await client.query('ROLLBACK TO SAVEPOINT probe');}
 }
 await client.query('ROLLBACK');
}finally{await client.end();}
