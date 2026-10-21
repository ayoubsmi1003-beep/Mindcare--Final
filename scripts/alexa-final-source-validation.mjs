/** Verify actual browser citations against the unchanged approved public snapshot. */
import {readFileSync,writeFileSync} from 'node:fs';import pg from 'pg';
const root='.cache/alexa',report=JSON.parse(readFileSync(`${root}/final-browser-report.json`,'utf8'));
const references=report.cases.flatMap(c=>c.turns.flatMap(t=>t.events.flatMap(e=>(e.sources??[]).filter(s=>s.type==='knowledge').map(s=>({...s,scenario:c.id})))));
const db=new pg.Client({connectionString:'postgresql://mindcare_app@127.0.0.1:55443/postgres'});await db.connect();
try{await db.query('BEGIN READ ONLY');await db.query('SET LOCAL ROLE authenticated');
 const rows=(await db.query("SELECT c.id,s.version,s.titre FROM app.knowledge_chunks c JOIN app.knowledge_sources s ON s.id=c.source_id WHERE c.id=ANY($1::text[]) AND s.titre=ANY($2::text[]) AND s.classification='C4' AND s.statut='active' AND s.approved_at IS NOT NULL AND s.approved_by IS NOT NULL AND s.superseded_by IS NULL AND (s.review_due_at IS NULL OR s.review_due_at>now())",[[...new Set(references.map(s=>s.id))],['DSM-5 — Manuel diagnostique et statistique des troubles mentaux','The Maudsley Prescribing Guidelines in Psychiatry']])).rows;
 const failures=references.filter(s=>!rows.some(row=>row.id===s.id&&row.version===s.version)).map(s=>({scenario:s.scenario,id:s.id,reason:'citation-not-in-current-approved-two-book-version'}));
 const result={status:references.length?(failures.length?'FAIL':'PASS'):'NOT RUN',citations:references.length,distinctChunks:rows.length,failures,quoteAccuracy:'NOT RUN',medicationDoseAccuracy:'NOT RUN',clinicalAcceptance:'NOT RUN'};
 await db.query('ROLLBACK');writeFileSync(`${root}/final-source-validation.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await db.end();}
