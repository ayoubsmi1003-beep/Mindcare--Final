#!/usr/bin/env node
// Complete clinic snapshot. Never purge, filter, drop, or migrate the source.
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT=path.join(ROOT,'resources','snapshot');
const CONTAINER=process.env.MC_SNAPSHOT_CONTAINER ?? 'mc-p3';
const SOURCE=process.env.MC_SNAPSHOT_DB ?? 'mindcare';
const tag=randomBytes(6).toString('hex');
const TARGET=`mindcare_snapshot_verify_${tag}`;
let createdTarget=false;
const REMOTE=`/tmp/mindcare-snapshot-${tag}.dump`;
const REMOTE_GATES=`/tmp/mindcare-gates-${tag}.sql`;
const stagedDump=path.join(OUTPUT,`.base-${tag}.dump`);
if(!/^[a-zA-Z0-9_.-]+$/.test(CONTAINER)||!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(SOURCE)||SOURCE===TARGET)
  throw new Error('Source ou cible invalide : aucune commande exécutée.');
mkdirSync(OUTPUT,{recursive:true});
function run(args){
  const result=spawnSync('docker',args,{encoding:'utf8',timeout:1_200_000,maxBuffer:8*1024*1024,windowsHide:true});
  if(result.status!==0){
    // PostgreSQL restore diagnostics may quote row values. Never print them.
    const diagnostics=path.join(ROOT,'.cache','snapshot-private');
    mkdirSync(diagnostics,{recursive:true});
    writeFileSync(path.join(diagnostics,`${tag}.log`),result.stderr ?? '',{mode:0o600});
    throw new Error(`Opération Docker refusée (code ${result.status ?? result.error?.code ?? 'inconnu'}). Diagnostic privé conservé ; aucune base effacée.`);
  }return result.stdout.trim();
}
function sql(base,query){return run(['exec',CONTAINER,'psql','-X','-U','postgres','-d',base,'-At','-v','ON_ERROR_STOP=1','-c',query]);}
function readonly(base,query){return sql(base,`BEGIN READ ONLY; SET LOCAL TIME ZONE 'UTC'; ${query} COMMIT;`).split(/\r?\n/).filter(line=>!['BEGIN','SET','COMMIT',''].includes(line));}
function inventory(base,tables){
  const query=tables.map(table=>`SELECT json_build_object('table','${table}','count',count(*),'fingerprint',md5(coalesce(string_agg(md5(t::text),'' ORDER BY md5(t::text)),''))) FROM ${table} t;`).join('\n');
  return Object.fromEntries(readonly(base,query).map(line=>{const row=JSON.parse(line);return [row.table,{count:row.count,fingerprint:row.fingerprint}];}));
}
async function main(){
  const version=readonly(SOURCE,'SHOW server_version;')[0];
  if(!version?.startsWith('16.'))throw new Error('PostgreSQL 16 requis.');
  const disk=readdirSync(path.join(ROOT,'supabase','migrations')).filter(name=>name.endsWith('.sql')).map(name=>name.slice(0,-4)).sort();
  const applied=readonly(SOURCE,'SELECT version FROM app.schema_migrations ORDER BY version;');
  if(JSON.stringify(disk)!==JSON.stringify(applied))throw new Error('Migrations source et disque incohérentes ; aucune migration appliquée.');
  const tables=readonly(SOURCE,"SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname IN ('app','audit','auth') ORDER BY 1;");
  if(!tables.every(table=>/^(app|audit|auth)\.[a-z_][a-z_0-9]*$/.test(table)))throw new Error('Inventaire de tables invalide.');
  const before=inventory(SOURCE,tables);
  const patients=before['app.patients']?.count;
  if(!Number.isInteger(patients)||patients<1500)throw new Error('Dataset source inattendu.');
  console.log(`[instantané] source ${CONTAINER}/${SOURCE}, ${patients} patients, ${tables.length} tables, ${applied.length} migrations.`);
  run(['exec',CONTAINER,'pg_dump','-U','postgres','-Fc','-f',REMOTE,SOURCE]);
  run(['cp',`${CONTAINER}:${REMOTE}`,stagedDump]);
  const bytes=readFileSync(stagedDump);
  if(bytes.length<1024)throw new Error('Cliché incomplet.');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  // CREATE alone refuses any collision. No existing database is ever dropped.
  sql('postgres',`CREATE DATABASE "${TARGET}" LOCALE_PROVIDER icu ICU_LOCALE 'fr-DZ' TEMPLATE template0 ENCODING 'UTF8';`);
  createdTarget=true;
  console.log(`[instantané] restauration isolée ${TARGET}, propriétaires et privilèges conservés.`);
  run(['exec','-e','PGOPTIONS=-c max_parallel_maintenance_workers=0 -c maintenance_work_mem=16MB -c max_parallel_workers_per_gather=0',
    CONTAINER,'pg_restore','-U','postgres','--exit-on-error','-d',TARGET,REMOTE]);
  run(['cp',path.join(OUTPUT,'gates.sql'),`${CONTAINER}:${REMOTE_GATES}`]);
  run(['exec',CONTAINER,'psql','-X','-U','postgres','-d',TARGET,'-v','ON_ERROR_STOP=1','-q','-f',REMOTE_GATES]);
  const restored=inventory(TARGET,tables),after=inventory(SOURCE,tables);
  const differences=tables.filter(table=>JSON.stringify(before[table])!==JSON.stringify(restored[table])||JSON.stringify(before[table])!==JSON.stringify(after[table]));
  const restoredMigrations=readonly(TARGET,'SELECT version FROM app.schema_migrations ORDER BY version;');
  if(differences.length||JSON.stringify(applied)!==JSON.stringify(restoredMigrations))throw new Error('Comparaison source/restauration divergente. Aucun instantané promu.');
  const manifest={snapshot_version:`snap-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${patients}p`,
    schema_version:`${disk.length}-${disk.at(-1)}`,created_at:new Date().toISOString(),database_version:version,
    source:`${CONTAINER}/${SOURCE}`,patient_count:patients,patients_total_source:patients,fixtures_exclues:0,tables:tables.length,
    counts:Object.fromEntries(tables.map(table=>[table,before[table].count])),migrations:disk,sha256};
  writeFileSync(path.join(OUTPUT,`.manifest-${tag}.json`),JSON.stringify(manifest,null,2));
  renameSync(stagedDump,path.join(OUTPUT,'base.dump'));
  renameSync(path.join(OUTPUT,`.manifest-${tag}.json`),path.join(OUTPUT,'manifest.json'));
  writeFileSync(path.join(OUTPUT,'restore-evidence.json'),JSON.stringify({createdAt:manifest.created_at,source:manifest.source,
    verificationDatabase:`${CONTAINER}/${TARGET}`,before,restored,after,differences,sha256,verdict:'PASS',productionMutations:false,purgePerformed:false},null,2));
  console.log(`[instantané] PASS — ${patients} patients, ${tables.length} tables identiques par comptes et empreintes ; source inchangée.`);
}
main().catch(error=>{console.error(`[instantané] REFUS — ${error.message}`);process.exitCode=1;}).finally(()=>{
  if(!createdTarget)return;
  try{
    sql('postgres',`DROP DATABASE "${TARGET}";`);
    const evidencePath=path.join(OUTPUT,'restore-evidence.json');
    if(requireEvidence(evidencePath)){
      const evidence=JSON.parse(readFileSync(evidencePath,'utf8'));
      if(evidence.verificationDatabase===`${CONTAINER}/${TARGET}`)writeFileSync(evidencePath,JSON.stringify({...evidence,verificationDatabaseRemoved:true},null,2));
    }
    console.log('[instantané] Base de vérification temporaire supprimée après comparaison.');
  }catch(error){
    console.error('[instantané] ÉCHEC — base temporaire à supprimer : '+error.message);
    process.exitCode=1;
  }
});

function requireEvidence(file){try{return readFileSync(file,'utf8').length>0;}catch{return false;}}
