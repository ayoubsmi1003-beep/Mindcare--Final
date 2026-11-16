// Isolated source verification only: never accepts a database URL or existing container.
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=`mindcare_sourcefix_synthetic_${randomBytes(6).toString('hex')}`;
const database='mindcare_sourcefix_synthetic';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
const sql=input=>docker(['exec','-i',name,'psql','-X','-U','postgres','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],input);
let created=false;
let requested=false;
try {
 requested=true;
 docker(['run','--detach','--name',name,'--label','com.mindcare.synthetic-sourcefix=1','--env','POSTGRES_PASSWORD=synthetic_test_only','--env',`POSTGRES_DB=${database}`,'pgvector/pgvector:0.8.6-pg16']);created=true;
 const info=JSON.parse(docker(['inspect',name]))[0];
 assert.equal(info.Config.Labels['com.mindcare.synthetic-sourcefix'],'1');
 assert.equal(info.Name,`/${name}`);
 assert.ok(info.Mounts.every(m=>m.Type==='volume'&&/^[a-f0-9]{64}$/.test(m.Name)));
 assert.equal(info.HostConfig.Binds,null);
 let ready=false;
 for(let i=0;i<120;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d',database]);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
 assert.ok(ready,'synthetic PostgreSQL startup');
 assert.equal(sql("SELECT current_database()||'|'||count(*) FROM information_schema.tables WHERE table_schema='app';").trim(),`${database}|0`);
 const read=f=>readFileSync(path.join(root,f),'utf8').replace(/^\uFEFF/,'');
 const files=['supabase/bootstrap/000_platform_compat.sql'];
 for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if(file.startsWith('015_'))files.push('supabase/bootstrap/005_scales_fixed_ids.sql');
  files.push(`supabase/migrations/${file}`);
  if(file.startsWith('073_'))files.push('supabase/bootstrap/005b_medications_fingerprints.sql');
 }
 sql('SET client_min_messages=warning;\n'+files.map(read).join('\n'));
 console.log(`PASS migrations: ${files.length-3}, isolated PostgreSQL 16`);
 const checkpoints=['checkpoint-document-editor.sql','checkpoint-document-issue-editor.sql','checkpoint-document-fragments.sql','checkpoint-document-revision.sql'];
 for(const file of checkpoints){
  const source=read(`scripts/${file}`);
  // These frozen checkpoints explicitly assert the v1 rendering contract.
  const legacy=file!=='checkpoint-document-editor.sql';
  sql(legacy?source.replace('BEGIN;',"BEGIN;\nALTER TABLE app.document_drafts ALTER COLUMN renderer_version SET DEFAULT 'v1';"):source);
  console.log(`PASS ${file}${legacy?' (historical v1)':''}`);
 }
 const prelude=read('scripts/checkpoint-document-editor.sql').split('SELECT app.create_editable_document_draft')[0];
 const documents=sql(prelude+read('scripts/checkpoint-sourcefix-documents-v2.sql'));
 const prescriptionPreview=JSON.parse(documents.split(/\r?\n/).find(l=>l.startsWith('PRESCRIPTION_PREVIEW:')).slice('PRESCRIPTION_PREVIEW:'.length));
 const cache=path.join(root,'.cache');mkdirSync(cache,{recursive:true});
 writeFileSync(path.join(cache,'document-prescription-preview.json'),JSON.stringify({synthetic:true,preview:prescriptionPreview}));
 console.log('PASS v2 document issuance, professional identity and immutable snapshot');
 sql(prelude+read('scripts/checkpoint-sourcefix-diagnoses.sql'));
 console.log('PASS diagnosis gates and historical metadata');
 sql(prelude+read('scripts/checkpoint-sourcefix-catalogue.sql'));
 console.log('PASS full catalogue, pagination and controlled identity transfer');
 // The preview is deliberately synthetic and only a local visual-test input.
 const previewSql=prelude+`SELECT app.create_editable_document_draft('d2000000-0000-4000-8000-000000000001','justification','{"date_consultation":"14/11/2026"}') AS created \\gset\nSELECT 'PREVIEW:'||app.preview_editable_document_draft((:'created'::jsonb->>'id')::uuid,1)::text;\nROLLBACK;`;
 const preview=JSON.parse(sql(previewSql).split(/\r?\n/).find(l=>l.startsWith('PREVIEW:')).slice(8));
 assert.equal(preview.rendererVersion,'v2');
 writeFileSync(path.join(cache,'document-visual-preview.json'),JSON.stringify({synthetic:true,preview}));
 console.log('PASS v2 SQL preview; fixtures rolled back');
} finally {
 if(requested){
  let info;
  try{info=JSON.parse(docker(['inspect',name]))[0];}catch(error){if(created||error.code==='ETIMEDOUT')throw error;}
  if(info){assert.equal(info.Config.Labels['com.mindcare.synthetic-sourcefix'],'1');assert.equal(info.Name,`/${name}`);docker(['rm','--force','--volumes',name]);}
 }
}
