import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const run=sql=>{const r=spawnSync('docker',['exec','-i','mc-p3','psql','-U','postgres','-d','mindcare','-X','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error('Search checkpoint SQL failed');return r.stdout;};
const actors=JSON.parse(run("SELECT json_agg(json_build_object('id',id,'role',role)) FROM app.profiles WHERE is_active;"));
const snapshot=()=>actors.map(a=>{
 const start=performance.now();
 const output=run(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.id}',true); SELECT json_build_object('count',count(*),'total',coalesce(max(total_count),0),'fingerprint',md5(coalesce(string_agg(id::text,',' ORDER BY id),''))) FROM app.search_patients(NULL::text,100,0); ROLLBACK;`);
 return {role:a.role,data:JSON.parse(output.split('\n').find(x=>x.startsWith('{'))),ms:Math.round(performance.now()-start)};
});
const before=snapshot();
const policies=JSON.parse(run("SELECT json_agg(json_build_object('name',policyname,'table',tablename,'qual',qual,'check',with_check)) FROM pg_policies WHERE schemaname='app' AND tablename IN ('patients','medications');"));
mkdirSync('.cache/delivery',{recursive:true});
writeFileSync('.cache/delivery/search-policies-before-146.json',JSON.stringify(policies,null,2));
const migration=readFileSync('supabase/migrations/146_search_rls_initplans.sql','utf8');
for(let i=0;i<actors.length;i++){
 const a=actors[i];
 const trial=run(migration.replace(/COMMIT;\s*$/,'')+`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a.id}',true); SELECT json_build_object('count',count(*),'total',coalesce(max(total_count),0),'fingerprint',md5(coalesce(string_agg(id::text,',' ORDER BY id),''))) FROM app.search_patients(NULL::text,100,0); ROLLBACK;`);
 assert.deepEqual(JSON.parse(trial.split('\n').find(x=>x.startsWith('{'))),before[i].data);
}
// No authority change: prove helper equivalence for each actor and every actual
// practitioner reference, including NULL, before changing the live policies.
for(const a of [...actors,{id:'',role:'anonymous'}]){
 const result=run(`BEGIN; SELECT set_config('request.jwt.claim.sub','${a.id}',true); SELECT count(*) FROM (SELECT DISTINCT practitioner_id FROM app.patients UNION SELECT NULL::uuid) refs WHERE app.can_see_clinical(practitioner_id) IS DISTINCT FROM (CASE (SELECT app.current_role()) WHEN 'owner'::app.user_role THEN true WHEN 'practitioner'::app.user_role THEN practitioner_id=(SELECT auth.uid()) ELSE false END); ROLLBACK;`);
 assert.equal(result.split('\n').filter(x=>/^\d+$/.test(x)).at(-1),'0');
}
run(migration);
const after=snapshot();
for(let i=0;i<before.length;i++)assert.deepEqual(after[i].data,before[i].data);
assert.equal(run("SELECT has_function_privilege('anon','app.search_patients(text,integer,integer)','EXECUTE');").trim(),'f');
const report={authorization:'PASS: role helper equivalent including null; scoped fingerprints unchanged; anonymous denied',before:before.map(x=>({role:x.role,ms:x.ms})),after:after.map(x=>({role:x.role,ms:x.ms}))};
writeFileSync('.cache/delivery/search-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
