// Local, protected checkpoint of the explicitly isolated evaluation database.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cpSync,copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const root=process.cwd(),privateRoot=path.join(root,'.cache','clinical-evaluation-20261022');
const isolation=JSON.parse(readFileSync(path.join(privateRoot,'isolation.json'),'utf8'));
if(!isolation.restorationVerified||isolation.target!=='mindcare-evaluation-20261022'||isolation.database!=='alexa_eval_clinical_20261022'||isolation.port!==55444)throw Error('VerifiedEvaluationRequired');
const destination=process.argv[2];
if(!destination||!path.isAbsolute(destination)||!path.resolve(destination).startsWith('G:\\MindCare-saved-versions\\')||existsSync(destination))throw Error('NewCheckpointDestinationRequired');
const run=(command,args,env=process.env)=>execFileSync(command,args,{cwd:root,env,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});
const sourceCommit=run('git',['rev-parse','HEAD']).trim();
mkdirSync(destination,{recursive:true});
// Apply the evaluation folder's existing protected ACL before writing any data.
run('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Set-Acl -LiteralPath $env:MINDCARE_CHECKPOINT_DESTINATION -AclObject (Get-Acl -LiteralPath $env:MINDCARE_CHECKPOINT_ACL_SOURCE)"],{...process.env,PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',MINDCARE_CHECKPOINT_DESTINATION:destination,MINDCARE_CHECKPOINT_ACL_SOURCE:privateRoot});
const dump='/tmp/mindcare-saved-checkpoint.dump',roles='/tmp/mindcare-saved-checkpoint-roles.sql';
run('docker',['exec',isolation.target,'pg_dump','-U','postgres','-Fc','-f',dump,isolation.database]);
run('docker',['exec',isolation.target,'pg_restore','--list',dump]);
run('docker',['cp',`${isolation.target}:${dump}`,path.join(destination,'evaluation.dump')]);
run('docker',['exec',isolation.target,'pg_dumpall','-U','postgres','--roles-only','-f',roles]);
run('docker',['cp',`${isolation.target}:${roles}`,path.join(destination,'roles.sql')]);
// Exercise the new archive in a fresh disposable database. Record its counts
// separately: live operational tables can change after pg_dump's snapshot.
const tableQueries=run('docker',['exec',isolation.target,'psql','-X','-U','postgres','-d',isolation.database,'-At','-c',"SELECT format('SELECT %L AS relation, count(*)::bigint AS rows FROM %I.%I',schemaname||'.'||tablename,schemaname,tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') AND schemaname NOT LIKE 'pg_%' ORDER BY schemaname,tablename;"]).trim().split('\n').filter(Boolean);
if(!tableQueries.length)throw Error('CheckpointTablesMissing');
const countsSql=`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY relation),'[]') FROM (${tableQueries.join(' UNION ALL ')}) t;`;
const counts=database=>run('docker',['exec',isolation.target,'psql','-X','-U','postgres','-d',database,'-At','-c',countsSql]).trim();
const verificationDatabase=`alexa_checkpoint_verify_${Date.now()}`;
let created=false,restoredCounts;
try{
  run('docker',['exec',isolation.target,'createdb','-U','postgres',verificationDatabase]);created=true;
  run('docker',['exec',isolation.target,'pg_restore','-U','postgres','--exit-on-error','-d',verificationDatabase,dump]);
  restoredCounts=counts(verificationDatabase);
}finally{
  if(created)run('docker',['exec',isolation.target,'dropdb','-U','postgres',verificationDatabase]);
}
writeFileSync(path.join(destination,'restored-table-counts.json'),restoredCounts+'\n');
const rootFiles=run('git',['ls-tree',sourceCommit]).split('\n').filter(line=>/^\d+ blob /u.test(line)).map(line=>line.split('\t')[1]).filter(name=>name&&(name==='.env.example'||!name.startsWith('.env')));
run('git',['archive','--format=zip',`--output=${path.join(destination,'source.zip')}`,sourceCommit,'--',...rootFiles,'src','scripts','supabase','tests','electron','public','docs/RUNTIME-CONFIGURATION.md']);
const assets=JSON.parse(readFileSync(path.join(privateRoot,'ssd-model-cache.json'),'utf8'));
const model='MiniCPM-V-4_7-1B-Q4_K_M.gguf',expected='588c6c94c82f756b86dba35c42ed9ba9ec187d65824eb52f039c347df563e63d';
const modelRoot=path.join(destination,'minicpm');mkdirSync(modelRoot);
for(const name of [model,'llama-b11429.zip','runtime-b11429'])cpSync(path.join(assets.root,name),path.join(modelRoot,name),{recursive:true,errorOnExist:true});
const hash=async file=>{const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');};
if(await hash(path.join(modelRoot,model))!==expected)throw Error('CheckpointModelMismatch');
const evidence=path.join(destination,'evidence');mkdirSync(evidence);
for(const name of ['isolation.json','historical-analysis-backfill.json','primary-v27-seven-assessed.json','short-summary-browser.json','short-summary-reloaded.png','pilot-analysis.json','pilot-analysis-browser.json','pilot-analysis-reloaded.png','case-browser-report.json','case-reloaded.png','long-case-browser-report.json','long-case-reloaded.png']){
  const file=path.join(privateRoot,name);if(existsSync(file))copyFileSync(file,path.join(evidence,name));
}
copyFileSync(path.join(root,'docs','reports','2026-10-22-evaluation-execution.md'),path.join(evidence,'execution.md'));
const narrativeVersion=readFileSync(path.join(root,'src','shared','alexa','clinical.ts'),'utf8').match(/SESSION_NARRATIVE_VERSION\s*=\s*["']([^"']+)/u)?.[1];
const caseNarrativeVersion=readFileSync(path.join(root,'src','server','alexa','clinical-narrative.ts'),'utf8').match(/CASE_NARRATIVE_VERSION\s*=\s*["']([^"']+)/u)?.[1];
const dumpSha256=await hash(path.join(destination,'evaluation.dump'));
if(dumpSha256!==run('docker',['exec',isolation.target,'sha256sum',dump]).trim().split(/\s+/u)[0])throw Error('CheckpointDumpMismatch');
const manifest={createdAt:new Date().toISOString(),sourceCommit,narrativeVersion,caseNarrativeVersion,model,modelSha256:expected,runtime:'b11429',evaluation:{database:isolation.database,port:55444,applicationPort:3006,connectTimeoutMs:30000,nativeAgentEnabled:true,modelThreads:1,gpuLayers:0,contextTokens:4096},dumpSha256,sourceSha256:await hash(path.join(destination,'source.zip')),restoreVerified:true,restoredTableCount:tableQueries.length,originalDatabaseUntouched:true};
writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
writeFileSync(path.join(destination,'RESTORE.txt'),'Protected local evaluation checkpoint. Never restore into the cabinet database.\nApplication source snapshot: source.zip, exact commit in manifest.json. Full source history and knowledge files remain in the canonical Git checkout. Database: evaluation.dump (PostgreSQL custom archive) and roles.sql.\nRestore only into a new isolated PostgreSQL instance/database. MiniCPM assets are in minicpm/; the provider retains ACL and integrity checks.\nNo .env, browser cookies or transient model bearer token is copied. Server credentials must be configured separately.\n');
console.log(JSON.stringify({checkpoint:destination,sourceCommit,narrativeVersion,model,archiveReadable:true}));
