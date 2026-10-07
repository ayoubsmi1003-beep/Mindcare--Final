import {execFileSync} from "node:child_process";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import path from "node:path";
const directory=".superpowers/sdd/2026-10-07-documents-editor";
const replay=JSON.parse(readFileSync(path.join(directory,"replay-pass.json"),"utf8"));
const expected=readdirSync("supabase/migrations").filter(f=>/^1(?:2[89]|3[0-9])_document_editor.*\.sql$/.test(f)).sort();
if(expected.length!==12||JSON.stringify(expected)!==JSON.stringify(replay.migrations))throw new Error("DocumentReplayRequired");
function docker(args){return execFileSync("docker",args,{encoding:"utf8",maxBuffer:32*1024*1024});}
const query=sql=>docker(["exec","mc-p3","psql","-U","postgres","-d","mindcare","-tA","-v","ON_ERROR_STOP=1","-c",sql]).trim();
const fingerprintSql="SELECT count(*)::text||':'||md5(coalesce(string_agg(id::text||coalesce(content_hash,'')||rendered_html,'' ORDER BY id),'')) FROM app.documents WHERE source_draft_id IS NULL";
const before=query(fingerprintSql);if(before!==readFileSync(path.join(directory,"pre-documents-fingerprint.txt"),"utf8").trim())throw new Error("DocumentBackupStale");
const versions=new Set(query("SELECT version FROM app.schema_migrations").split("\n"));
for(const file of expected){const version=file.slice(0,-4);if(versions.has(version))continue;docker(["cp",path.resolve("supabase/migrations",file),"mc-p3:/tmp/"+file]);docker(["exec","mc-p3","psql","-U","postgres","-d","mindcare","-v","ON_ERROR_STOP=1","-q","-f","/tmp/"+file]);console.log("APPLIED",version);}
if(query(fingerprintSql)!==before)throw new Error("HistoricalDocumentChanged");
writeFileSync(path.join(directory,"active-migrations-pass.json"),JSON.stringify({migrations:expected,at:new Date().toISOString(),historicalDocumentsUnchanged:true}));
console.log("DOCUMENT ACTIVE MIGRATIONS PASS; ORIGINAL PIECES UNCHANGED");
