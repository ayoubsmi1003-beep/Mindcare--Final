import {execFileSync} from "node:child_process";
import {readdirSync,writeFileSync,readFileSync} from "node:fs";
import path from "node:path";
const target="mindcare_documents_replay_v3_20261007";
function docker(args,options={}){return execFileSync("docker",args,{encoding:"utf8",maxBuffer:32*1024*1024,...options});}
function query(db,sql){return docker(["exec","mc-p3","psql","-U","postgres","-d",db,"-tA","-v","ON_ERROR_STOP=1","-c",sql]);}
function literal(value){return "convert_from(decode('"+Buffer.from(value).toString("base64")+"','base64'),'UTF8')";}
docker(["exec","mc-p3","createdb","-U","postgres",target]);
docker(["exec","mc-p3","psql","-U","postgres","-d",target,"-v","ON_ERROR_STOP=1","-q","-f","/tmp/mindcare-documents-schema-20261007.sql"]);
const templates=JSON.parse(query("mindcare","SELECT coalesce(jsonb_agg(jsonb_build_object('type',doc_type,'version',version,'title',title_fr,'body',body_html)),'[]') FROM app.document_templates t WHERE is_active AND doc_type::text<>'ordonnance' AND version=(SELECT max(version) FROM app.document_templates x WHERE x.cabinet_id=t.cabinet_id AND x.doc_type=t.doc_type)"));
const cabinet="b0000000-0000-4000-8000-000000000001";
query(target,"INSERT INTO app.cabinets(id,name,address,phone) VALUES('"+cabinet+"','Replay synthetic cabinet','Synthetic address','0000000000')");
for(const t of templates)query(target,"INSERT INTO app.document_templates(cabinet_id,doc_type,version,title_fr,header_html,body_html,is_active) VALUES('"+cabinet+"',"+literal(t.type)+"::app.doc_type,"+Number(t.version)+","+literal(t.title)+",'',"+literal(t.body)+",true)");
const migrations=readdirSync("supabase/migrations").filter(f=>/^1(?:2[89]|3[0-9])_document_editor.*\.sql$/.test(f)).sort();
if(migrations.length!==12)throw new Error("DocumentMigrationInventoryMismatch");
for(const file of migrations){docker(["cp",path.resolve("supabase/migrations",file),"mc-p3:/tmp/"+file]);docker(["exec","mc-p3","psql","-U","postgres","-d",target,"-v","ON_ERROR_STOP=1","-q","-f","/tmp/"+file]);}
for(const checkpoint of ["document-editor","document-issue-editor","document-header","document-prescription","document-medication-limit","document-revision","document-fragments"]){const file="checkpoint-"+checkpoint+".sql";docker(["cp",path.resolve("scripts",file),"mc-p3:/tmp/"+file]);const output=docker(["exec","mc-p3","psql","-U","postgres","-d",target,"-v","ON_ERROR_STOP=1","-q","-f","/tmp/"+file]);if(!output.includes(" PASS"))throw new Error("DocumentCheckpointMissingPass");}
writeFileSync(".superpowers/sdd/2026-10-07-documents-editor/replay-pass.json",JSON.stringify({target,migrations,at:new Date().toISOString()}));
console.log("DOCUMENT MIGRATION BASELINE REPLAY PASS");
