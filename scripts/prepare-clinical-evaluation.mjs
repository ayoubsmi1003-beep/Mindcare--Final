// Local evaluation copy only. Source operations are read-only; no source migrations.
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
const root=path.resolve('.cache/clinical-evaluation-20261022');
mkdirSync(root,{recursive:true});
const run=(args)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
const source='mc-p3',target='mindcare-evaluation-20261022',database='alexa_eval_clinical_20261022';
const sql=(container,db,text)=>run(['exec',container,'psql','-X','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1','-c',text]).trim();
if(source===target||!database.startsWith('alexa_eval_'))throw Error('IsolationRequired');
const inventory=()=>JSON.parse(sql(source,'mindcare',`BEGIN READ ONLY; SELECT json_build_object('patients',count(*),'identityHash',md5(string_agg(to_jsonb(p)::text,'' ORDER BY id))) FROM app.patients p; COMMIT;`).split('\n').find(l=>l.startsWith('{')));
const before=inventory();
if(before.patients!==1558)throw Error('SourcePopulationChanged');
if(!existsSync(path.join(root,'source.dump'))){
 run(['exec',source,'pg_dump','-U','postgres','-Fc','-f','/tmp/mindcare-evaluation-20261022.dump','mindcare']);
 run(['cp',`${source}:/tmp/mindcare-evaluation-20261022.dump`,path.join(root,'source.dump')]);
 run(['exec',source,'pg_dumpall','-U','postgres','--roles-only','-f','/tmp/mindcare-evaluation-roles-20261022.sql']);
 run(['cp',`${source}:/tmp/mindcare-evaluation-roles-20261022.sql`,path.join(root,'roles.sql')]);
 writeFileSync(path.join(root,'source-inventory.json'),JSON.stringify(before));
}
const containers=run(['ps','-a','--format','{{.Names}}']).split(/\r?\n/);
if(!containers.includes(target)){
 const password=randomBytes(32).toString('hex');
 run(['run','-d','--name',target,'-p','127.0.0.1:55444:5432','-e',`POSTGRES_PASSWORD=${password}`,'pgvector/pgvector:0.8.6-pg16']);
}
let ready=false;for(let i=0;i<40;i++){try{sql(target,'postgres','SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
if(!ready)throw Error('EvaluationDatabaseUnavailable');
if(sql(target,'postgres',`SELECT count(*) FROM pg_database WHERE datname='${database}'`)==='0'){
 run(['cp',path.join(root,'roles.sql'),`${target}:/tmp/roles.sql`]);
 // Existing bootstrap postgres role is the sole expected duplicate.
 run(['exec',target,'psql','-X','-U','postgres','-d','postgres','-q','-f','/tmp/roles.sql']);
 sql(target,'postgres',`CREATE DATABASE ${database} TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'fr-DZ' ENCODING 'UTF8'`);
 run(['cp',path.join(root,'source.dump'),`${target}:/tmp/source.dump`]);
 run(['exec','-e','PGOPTIONS=-c max_parallel_maintenance_workers=0 -c maintenance_work_mem=16MB',target,'pg_restore','-U','postgres','--exit-on-error','-d',database,'/tmp/source.dump']);
}
const restored=JSON.parse(sql(target,database,`SELECT json_build_object('patients',count(*),'identityHash',md5(string_agg(to_jsonb(p)::text,'' ORDER BY id))) FROM app.patients p`));
const after=inventory();
const snapshot=JSON.parse(readFileSync(path.join(root,'source-inventory.json'),'utf8'));
if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(snapshot)!==JSON.stringify(restored))throw Error('IdentityVerificationFailed');
writeFileSync(path.join(root,'isolation.json'),JSON.stringify({source,target,database,port:55444,patients:before.patients,identityPreserved:true,sourceStableDuringVerification:true,sourceChangedSinceSnapshot:JSON.stringify(snapshot)!==JSON.stringify(before),restorationVerified:true},null,2));
console.log(JSON.stringify({database,port:55444,patients:before.patients,identityPreserved:true,restorationVerified:true}));
