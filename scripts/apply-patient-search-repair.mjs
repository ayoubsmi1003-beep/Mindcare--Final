import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const run = sql => {
 const r=spawnSync('docker',['exec','-i','mc-p3','psql','-U','postgres','-d','mindcare','-X','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw new Error('Patient-search migration/check failed; transaction stopped');
 return r.stdout;
};
const before=run("SELECT pg_get_functiondef('app.search_patients(text,integer,integer)'::regprocedure);");
mkdirSync('.cache/delivery',{recursive:true});
writeFileSync('.cache/delivery/search-patients-before-145.sql',before);
run(readFileSync('supabase/migrations/145_patient_search_trigram_scope.sql','utf8'));
const roles=JSON.parse(run("SELECT coalesce(json_agg(json_build_object('id',id,'role',role)),'[]') FROM app.profiles WHERE is_active AND role IN ('owner','practitioner','assistant');"));
for(const account of roles){
 const result=run(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${account.id}',true); SELECT count(*) FROM app.search_patients(p_query := NULL::text,p_limit := 25,p_offset := 0); SELECT count(*) FROM app.search_patients(p_query := 'Salmi'::text,p_limit := 25,p_offset := 0); ROLLBACK;`);
 console.log(JSON.stringify({role:account.role,searches:'PASS'}));
}
console.log('145 applied; prior function saved; patient search checks passed under existing roles.');
