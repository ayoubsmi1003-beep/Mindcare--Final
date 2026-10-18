import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
import {Client} from 'pg';
const connection=process.env.MINDCARE_ALEXA_EVAL_ADMIN_URL;if(!connection)throw Error('ExplicitDisposableAdminUrlRequired');
const target=new URL(connection);if(!['127.0.0.1','localhost'].includes(target.hostname)||!/^\/alexa_eval(?:_[a-z0-9_]+)?$/.test(target.pathname)||target.port==='55441')throw Error('DisposableDatabaseRequired');
const fixture=JSON.parse(readFileSync(new URL('../tests/eval/alexa-agent-fixture.json',import.meta.url),'utf8'));
const c=new Client({connectionString:connection});await c.connect();
if((await c.query('SELECT count(*)::int n FROM app.patients WHERE is_synthetic IS DISTINCT FROM true')).rows[0].n){await c.end();throw Error('NonSyntheticPatientsRefuseTests');}
const results=[];const test=async(name,fn)=>{const started=Date.now();try{await fn();results.push({name,status:'PASS',ms:Date.now()-started});console.log('PASS '+name);}catch(e){results.push({name,status:'FAIL',code:e.code,message:e.message});console.log('FAIL '+name+' '+e.code+' '+e.message);await c.query('ROLLBACK');process.exitCode=1;}};
const asActor=async(actor,fn)=>{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);try{return await fn();}finally{await c.query('ROLLBACK');}};
const search=async spec=>(await c.query('SELECT app.search_patients(p_spec=>$1,p_as_of=>$2) value',[JSON.stringify(spec),fixture.asOf])).rows[0].value;
const records=async(domain,spec)=>(await c.query('SELECT app.query_alexa_records($1,$2,$3) value',[domain,JSON.stringify(spec),fixture.asOf])).rows[0].value;
await test('21: one snapshot, four independently expected metrics, unknown age and never attended',()=>asActor(fixture.owner,async()=>{
const r=await search({mode:'metrics',metrics:['active','missing_identity_card','children','not_seen_6m']});
assert.deepEqual(r.metrics,{active:32,missing_identity_card:25,children:1,not_seen_6m:24,unknown_age:1,never_seen:24});assert.equal(r.complete,true);assert.equal(r.rows.length,0);
}));
await test('Mode-specific arguments: a count cannot silently ignore a supplied metrics operation',()=>asActor(fixture.owner,async()=>{await assert.rejects(search({mode:'count',metrics:['children']}),e=>e.code==='22023');}));
const filters=[{field:'age',op:'gte',value:18},{field:'completed_consultations',op:'gte',value:3},{field:'outstanding_balance',op:'gt',value:0},{field:'no_completed_days',op:'eq',value:90}];
await test('22: every AND predicate, exactly-three visits, no multiplied balances, ties and inactive exclusion',()=>asActor(fixture.owner,async()=>{
const r=await search({mode:'list',filters,sort:'outstanding_desc'});assert.equal(r.total,3);assert.deepEqual(r.rows.map(x=>x.id),fixture.expected.compound);assert.deepEqual(r.rows.map(x=>x.outstanding_balance),[2000,1500,1500]);assert.deepEqual(r.conditions,filters);
}));
await test('Exact total is independent of a partial first page; next page retains snapshot definition',()=>asActor(fixture.owner,async()=>{
const spec={mode:'list',filters:[{field:'identity_card',op:'missing',value:null}]};const first=await search(spec);assert.equal(first.total,25);assert.equal(first.rows.length,20);
const second=await search({...spec,offset:20,revision:first.revision});assert.equal(second.total,25);assert.equal(second.rows.length,5);assert.equal(second.revision,first.revision);assert.equal(new Set([...first.rows,...second.rows].map(p=>p.id)).size,25);
const expectedIds=[1,2,7,...Array.from({length:22},(_,i)=>20+i)].map(n=>'ed000000-0000-4000-8000-'+String(n).padStart(12,'0')).sort();assert.deepEqual([...first.rows,...second.rows].map(p=>p.id).sort(),expectedIds);
}));
await test('Missing text includes tab/newline-only values; present invalid text is separate',()=>asActor(fixture.owner,async()=>{
 const id='ed000000-0000-4000-8000-000000000003';
 for(const value of ['\t \n','\u00a0\t']){
  await c.query('RESET ROLE');await c.query('UPDATE app.patients SET id_document_number=$1 WHERE id=$2 AND is_synthetic',[value,id]);await c.query('SET LOCAL ROLE authenticated');
  const r=await search({mode:'count',filters:[{field:'identity_card',op:'missing',value:null}]});assert.equal(r.total,26);
 }
 await c.query('RESET ROLE');await c.query('UPDATE app.patients SET id_document_number=$1 WHERE id=$2 AND is_synthetic',['invalid-but-present',id]);await c.query('SET LOCAL ROLE authenticated');
 assert.equal((await search({mode:'count',filters:[{field:'identity_card',op:'missing',value:null}]})).total,25);
}));
await test('Record-number lookup is exact and does not match EVAL-10 or EVAL-11',()=>asActor(fixture.owner,async()=>{
 const r=await search({mode:'list',query:'EVAL-1'});assert.equal(r.total,1);assert.deepEqual(r.rows.map(p=>p.id),['ed000000-0000-4000-8000-000000000001']);
}));
await test('Legacy missing-identity count follows the same whitespace policy',()=>asActor(fixture.owner,async()=>{
 await c.query('RESET ROLE');await c.query('UPDATE app.patients SET id_document_number=$1 WHERE id=$2 AND is_synthetic',['\t \n','ed000000-0000-4000-8000-000000000003']);await c.query('SET LOCAL ROLE authenticated');
 const r=(await c.query('SELECT app.search_patients(NULL,0,0,$1) value',['identity_card'])).rows[0].value;assert.equal(r.total_count,26);
}));
await test('Changed pages fail explicitly instead of silently continuing an old result',()=>asActor(fixture.owner,async()=>{
const spec={mode:'list',filters:[{field:'identity_card',op:'missing',value:null}]};const first=await search(spec);
await c.query('RESET ROLE');await c.query('UPDATE app.patients SET id_document_number=$1 WHERE id=$2',['changed',fixture.expected.compound[1]]);await c.query('SET LOCAL ROLE authenticated');
await assert.rejects(search({...spec,offset:20,revision:first.revision}),e=>e.code==='40001');
}));
await test('23: tomorrow agenda references and administrative gaps without an update',()=>asActor(fixture.owner,async()=>{
const next=new Date(fixture.asOf);next.setUTCDate(next.getUTCDate()+1);const end=new Date(next);end.setUTCDate(end.getUTCDate()+1);
const a=await records('agenda',{from:next.toISOString().slice(0,10)+'T00:00:00+01:00',to:end.toISOString().slice(0,10)+'T00:00:00+01:00'});assert.equal(a.total,2);assert.deepEqual(a.rows.map(r=>r.patientId).sort(),[...fixture.expected.agendaPatients].sort());
const r=await search({mode:'review',patientIds:a.rows.map(r=>r.patientId),filters:[{field:'administrative_incomplete',op:'eq',value:true}]});assert.equal(r.total,2);assert.deepEqual(r.rows[0].missing,['identity_card']);assert.deepEqual(r.rows[1].missing,['phone','identity_card','sex']);
}));
await test('Visible administrative population is readable by reception',()=>asActor(fixture.assistant,async()=>{assert.equal((await search({mode:'count'})).total,32);}));
await test('Reception cannot interpret hidden clinical attendance as zero',()=>asActor(fixture.assistant,async()=>{await assert.rejects(search({mode:'metrics',metrics:['not_seen_6m']}),e=>e.code==='42501');}));
await test('Reception cannot query historical clinical/financial records',()=>asActor(fixture.assistant,async()=>{await assert.rejects(records('consultations',{mode:'count'}),e=>e.code==='42501');}));
await test('A second practitioner cannot treat hidden history as a complete population',()=>asActor(fixture.other,async()=>{assert.equal((await search({mode:'count'})).total,0);await assert.rejects(search({mode:'list',filters,sort:'outstanding_desc'}),e=>e.code==='42501');}));
await test('A material filter from another domain is rejected rather than ignored',()=>asActor(fixture.owner,async()=>{await assert.rejects(records('consultations',{mode:'count',state:'collected'}),e=>e.code==='22023');}));
await test('Arbitrary SQL/unknown filter names are rejected',()=>asActor(fixture.owner,async()=>{await assert.rejects(search({mode:'count',filters:[{field:'id; SELECT 1',op:'eq',value:1}]}),e=>e.code==='22023');}));
await test('Closed records and unpriced consultations remain separately counted',()=>asActor(fixture.owner,async()=>{
const r=await records('consultations',{mode:'count'});assert.equal(r.total,26);assert.equal(r.rows.length,0);const f=await records('finance',{mode:'totals'});assert.equal(f.totals.unpriced,3);assert.equal(f.totals.pendingDzd,17000);
}));
await test('Stable request identity claims once; replay cannot cross actor, text or context',()=>asActor(fixture.owner,async()=>{
const conv=(await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id,id=crypto.randomUUID(),context=JSON.stringify({patientId:null,page:'/jarvis'});
const claim=async(text='Synthetic request')=>(await c.query('SELECT app.claim_alexa_turn($1,$2,$3,$4) r',[conv,id,text,context])).rows[0].r;
assert.equal((await claim()).state,'claimed');assert.equal((await claim()).state,'pending');assert.equal((await claim('Changed request')).state,'conflict');
await c.query("SELECT app.complete_jarvis_turn($1,$2,'patient','Verified answer',NULL,'complet',$3)",[conv,id,JSON.stringify({events:[{type:'done',speechAllowed:true}]})]);assert.equal((await claim()).state,'replay');
await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.other]);assert.equal((await claim()).state,'unavailable');
}));
await test('Confirmed editable draft: no unconfirmed effect, one instance on replay, exact readback',()=>asActor(fixture.owner,async()=>{
// Approved template content is reference data. Copy it only to this synthetic cabinet.
await c.query('RESET ROLE');await c.query("INSERT INTO app.document_templates(cabinet_id,doc_type,version,title_fr,header_html,body_html,footer_html,is_active,content_json) SELECT $1,doc_type,version,title_fr,header_html,body_html,footer_html,is_active,content_json FROM app.document_templates WHERE doc_type='certificat_medical' AND is_active AND cabinet_id<>$1 ORDER BY version DESC LIMIT 1",[fixture.cabinet]);await c.query('SET LOCAL ROLE authenticated');
const conv=(await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id,id=crypto.randomUUID(),args=JSON.stringify({patient_id:fixture.expected.compound[1],document_type:'certificat_medical',variables:'{}'});
const propose=async()=>(await c.query("SELECT app.propose_jarvis_action($1,'Prepare synthetic draft','create_editable_document_draft',$2,$3) id",[conv,args,id])).rows[0].id;
assert.equal(await propose(),id);assert.equal(await propose(),id);await c.query('SAVEPOINT before_unconfirmed');await assert.rejects(c.query('SELECT app.execute_jarvis_action($1)',[id]));await c.query('ROLLBACK TO SAVEPOINT before_unconfirmed');
await c.query('SELECT app.confirm_jarvis_action($1)',[id]);const draft=(await c.query('SELECT app.execute_jarvis_action($1) id',[id])).rows[0].id;assert.ok(draft);
const value=(await c.query('SELECT app.get_editable_document_draft($1) r',[draft])).rows[0].r;assert.equal(value.patientId,fixture.expected.compound[1]);assert.equal(value.kind,'certificat_medical');assert.equal(value.issuedDocumentId,null);
assert.equal((await c.query('SELECT app.execute_jarvis_action($1) id',[id])).rows[0].id,draft);
assert.deepEqual((await c.query('SELECT app.get_alexa_action_outcome($1) value',[id])).rows[0].value,{state:'executed',tool:'create_editable_document_draft',affectedId:draft});
await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.other]);assert.equal((await c.query('SELECT app.get_alexa_action_outcome($1) value',[id])).rows[0].value,null);
}));
await test('Abandoned claims become explicit interruptions, then replay a persisted terminal outcome',()=>asActor(fixture.owner,async()=>{
 const conv=(await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id,id=crypto.randomUUID(),text='Demande synthétique interrompue',ctx='{"patientId":null,"page":"/jarvis"}';
 const claim=async()=>(await c.query('SELECT app.claim_alexa_turn($1,$2,$3,$4) r',[conv,id,text,ctx])).rows[0].r;
 assert.equal((await claim()).state,'claimed');assert.equal((await claim()).state,'pending');
 await c.query('RESET ROLE');await c.query("UPDATE app.jarvis_messages SET created_at=now()-interval '421 seconds' WHERE client_turn_id=$1 AND role='humain'",[id]);await c.query('SET LOCAL ROLE authenticated');assert.equal((await claim()).state,'interrupted');
 await c.query("SELECT app.complete_jarvis_turn(p_conversation_id=>$1,p_client_turn_id=>$2,p_chemin=>'patient',p_contenu=>'Interrompu',p_statut=>'interrompu',p_outil=>$3)",[conv,id,JSON.stringify({version:1,events:[{type:'done',status:'failed',speechAllowed:false}]})]);assert.equal((await claim()).state,'replay');
}));
if(process.argv.includes('--rich-patients')){
 const rich=JSON.parse(readFileSync(new URL('../tests/eval/alexa-rich-patients-fixture.json',import.meta.url),'utf8'));
 const richSearch=async spec=>(await c.query('SELECT app.search_patients(p_spec=>$1,p_as_of=>$2) value',[JSON.stringify(spec),rich.asOf])).rows[0].value;
 const richRecords=async(domain,spec)=>(await c.query('SELECT app.query_alexa_records($1,$2,$3) value',[domain,JSON.stringify(spec),rich.asOf])).rows[0].value;
 const notes=async spec=>(await c.query('SELECT app.query_alexa_note_sections($1,$2) value',[JSON.stringify(spec),rich.asOf])).rows[0].value;
 await test('Rich: both named profiles exist with exact synthetic identity/contact values',()=>asActor(rich.actors.owner,async()=>{
  for(const [key,first,last]of [['ayoub','Ayoub','Salmi'],['nadia','Nadia','Belkacem']]){
   const rows=(await c.query('SELECT to_jsonb(p) value FROM app.get_patient($1) p',[rich.patients[key]])).rows;assert.equal(rows.length,1);
   const p=rows[0].value;assert.equal(p.first_name,first);assert.equal(p.last_name,last);assert.equal(p.is_synthetic,true);assert.match(p.record_number,/^ALEXA-FICTIF-/);assert.match(p.notes_admin,/FICTIF/);
   assert.equal(p.phone,key==='ayoub'?'0000000001':'        ');
  }
 }));
 await test('Rich: independent metrics, missing identity membership and missing phone membership',()=>asActor(rich.actors.owner,async()=>{
  assert.deepEqual((await richSearch({mode:'metrics',metrics:['active','missing_identity_card','children','not_seen_6m']})).metrics,rich.oracle.metrics);
  for(const [field,ids]of [['identity_card',rich.oracle.missingIdentity],['phone',rich.oracle.missingPhone]]){const r=await richSearch({mode:'list',filters:[{field,op:'missing',value:null}]});assert.equal(r.total,1);assert.deepEqual(r.rows.map(p=>p.id),ids);}
 }));
 await test('Rich: consultation list, exact total, status and order agree',()=>asActor(rich.actors.owner,async()=>{
  const all=await richRecords('consultations',{patientId:rich.patients.ayoub,mode:'list',status:'all'});assert.equal(all.total,4);assert.deepEqual(all.rows.map(r=>r.id),rich.oracle.allAyoub);
  const closed=await richRecords('consultations',{patientId:rich.patients.ayoub,mode:'list',status:'closed'});assert.equal(closed.total,3);assert.deepEqual(closed.rows.map(r=>r.id),rich.oracle.closedAyoub);assert.ok(closed.rows.every(r=>r.status==='closed'));
  assert.equal((await richRecords('consultations',{patientId:rich.patients.ayoub,mode:'count',status:'closed'})).total,3);
 }));
 await test('Rich: exact original working-note search and negative search',()=>asActor(rich.actors.owner,async()=>{
  const spec={patientId:rich.patients.ayoub,area:'working',query:rich.oracle.workingSearch.query};
  const r=await notes(spec);assert.equal(r.total,1);assert.equal(r.complete,true);assert.equal(r.rows[0].sourceId,rich.oracle.workingSearch.sourceId);assert.equal(r.rows[0].consultationId,rich.oracle.workingSearch.consultationId);assert.equal(r.rows[0].text,rich.oracle.workingSearch.text);
  const absent=await notes({...spec,query:'repere_negatif_introuvable_123'});assert.equal(absent.total,0);assert.deepEqual(absent.rows,[]);assert.equal(absent.complete,true);
 }));
 await test('Rich: every SOAP field is attributed to the exact note and original value',()=>asActor(rich.actors.owner,async()=>{
  const consultationId=rich.oracle.workingSearch.consultationId,noteId=rich.records.clinical_notes[0].id;
  for(const [area,text]of Object.entries(rich.oracle.soapAyoubFirst)){const r=await notes({patientId:rich.patients.ayoub,consultationId,area});assert.equal(r.total,1);assert.equal(r.complete,true);assert.equal(r.rows[0].sourceId,noteId);assert.equal(r.rows[0].area,area);assert.equal(r.rows[0].status,'draft');assert.equal(r.rows[0].text,text);}
 }));
 await test('Rich: all consultation note areas and amendment survive paginated reading',()=>asActor(rich.actors.owner,async()=>{
  let spec={patientId:rich.patients.ayoub},rows=[],revision;
  for(let page=0;page<8;page++){const r=await notes(spec);revision??=r.revision;assert.equal(r.revision,revision);assert.equal(r.total,21);rows.push(...r.rows);if(r.complete)break;assert.ok(r.next);spec={patientId:rich.patients.ayoub,...r.next,revision};}
  assert.equal(rows.length,21);assert.equal(new Set(rows.map(r=>r.consultationId+':'+r.area+':'+r.sourceId)).size,21);assert.equal(rows.filter(r=>r.area==='amendment').length,1);
 }));
 await test('Rich: diagnoses, treatment states/instructions and scale scores are actual recorded values',()=>asActor(rich.actors.owner,async()=>{
  const r=(await c.query('SELECT app.get_alexa_clinical_context($1,5,NULL,NULL) value',[rich.patients.ayoub])).rows[0].value;
  assert.ok(r,'RichClinicalFixtureMissing');assert.deepEqual(r.diagnoses.map(d=>d.id),rich.oracle.diagnosesAyoub);assert.equal(r.diagnoses[0].primary,true);assert.equal(r.diagnoses[2].resolvedAt,'2026-09-01');
  assert.deepEqual([...r.treatments.current.map(t=>t.id)].sort(),[...rich.oracle.treatmentsAyoub].sort());assert.deepEqual(r.treatments.current.map(t=>t.status).sort(),['active','stopped']);assert.ok(r.treatments.current.some(t=>t.instructions==='Consigne ALPHA de test : aucune prise réelle.'));assert.equal(r.treatments.history.length,3);assert.equal(r.treatments.historyComplete,true);
  assert.deepEqual(r.scales.map(s=>s.score),[7,3]);assert.equal(r.scales[0].interpretation,'Interprétation FICTIVE 1 — non médicale.');
 }));
 await test('Rich: exhausted available consultation history is complete even below the requested limit',()=>asActor(rich.actors.owner,async()=>{
  const r=(await c.query('SELECT app.get_alexa_clinical_context($1,5,NULL,NULL) value',[rich.patients.ayoub])).rows[0].value;assert.equal(r.consultations.length,3);assert.equal(r.coverage.hasMore,false);assert.equal(r.coverage.complete,true);
 }));
 await test('Rich: monthly cash receipts, expenses and net match independent values',()=>asActor(rich.actors.owner,async()=>{
  const r=(await c.query('SELECT app.get_finance_overview(p_period_start=>$1::date,p_period_end=>$2::date) value',['2026-10-01','2026-10-31'])).rows[0].value;
  assert.equal(r.pulse.revenu_periode,1000);assert.equal(r.pulse.charges_periode,250);assert.equal(r.pulse.resultat_net_periode,750);assert.equal(r.pulse.impayes_total,1500);
 }));
 await test('Rich: issued document and editable unissued draft are distinct and exact',()=>asActor(rich.actors.owner,async()=>{
  const issued=await richRecords('documents',{patientId:rich.patients.ayoub,status:'issued'});assert.equal(issued.total,1);assert.equal(issued.rows[0].id,rich.oracle.issuedDocumentAyoub.id);
  const drafts=await richRecords('documents',{patientId:rich.patients.ayoub,status:'draft'});assert.equal(drafts.total,1);assert.equal(drafts.rows[0].id,rich.oracle.draftAyoub);
  const draft=(await c.query('SELECT app.get_editable_document_draft($1) value',[rich.oracle.draftAyoub])).rows[0].value;assert.equal(draft.patientId,rich.patients.ayoub);assert.equal(draft.kind,'justification');assert.equal(draft.issuedDocumentId,null);assert.ok(JSON.stringify(draft.content).includes('BROUILLON FICTIF 1'));
 }));
 await test('Rich: tomorrow agenda preserves exact membership and chronological order',()=>asActor(rich.actors.owner,async()=>{
  const r=await richRecords('agenda',{from:'2026-10-16T00:00:00+01:00',to:'2026-10-17T00:00:00+01:00'});assert.equal(r.total,2);assert.deepEqual(r.rows.map(a=>a.id),rich.oracle.tomorrowAppointments);
 }));
 await test('Rich: known pending amounts and unpriced consultations are separate',()=>asActor(rich.actors.owner,async()=>{
  const r=await richRecords('finance',{mode:'totals'});assert.equal(r.totals.pendingDzd,1500);assert.equal(r.totals.collectedDzd,1000);assert.equal(r.totals.unpriced,3);
 }));
 await test('Rich: reception never receives clinical content',()=>asActor(rich.actors.assistant,async()=>{assert.equal((await c.query('SELECT app.current_role()::text value')).rows[0].value,'assistant');await assert.rejects(notes({patientId:rich.patients.ayoub}),e=>e.code==='42501');}));
}

await test('History reload resumes the most recently active conversation rather than newest creation',()=>asActor(fixture.owner,async()=>{
 const older=(await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id,newer=(await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id;
 await c.query('RESET ROLE');await c.query("UPDATE app.jarvis_conversations SET started_at=now()-interval '2 days',last_message_at=now()-interval '2 days' WHERE id=$1",[older]);await c.query("UPDATE app.jarvis_conversations SET started_at=now()-interval '1 day',last_message_at=now()-interval '1 day' WHERE id=$1",[newer]);await c.query('SET LOCAL ROLE authenticated');
 await c.query('SELECT app.append_jarvis_turn($1,$2,$3)',[older,crypto.randomUUID(),'FICTIF continuity probe']);
 const history=(await c.query('SELECT app.get_jarvis_history(50) value')).rows[0].value;assert.equal(history.conversationId,older);assert.ok(history.messages.some(m=>m.contenu==='FICTIF continuity probe'));
}));
await test('History activity ties use creation then UUID as deterministic tie breakers',()=>asActor(fixture.owner,async()=>{
 const ids=[];for(let i=0;i<2;i++)ids.push((await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id);
 await c.query('RESET ROLE');await c.query("UPDATE app.jarvis_conversations SET last_message_at=now()+interval '1 day',started_at=now() WHERE id=ANY($1::uuid[])",[ids]);await c.query('SET LOCAL ROLE authenticated');
 assert.equal((await c.query('SELECT app.get_jarvis_history(1) value')).rows[0].value.conversationId,[...ids].sort().at(-1));
 await c.query('RESET ROLE');await c.query("UPDATE app.jarvis_conversations SET started_at=now()+interval '1 minute' WHERE id=$1",[ids[0]]);await c.query('SET LOCAL ROLE authenticated');
 assert.equal((await c.query('SELECT app.get_jarvis_history(1) value')).rows[0].value.conversationId,ids[0]);
}));
await test('History activity ordering never reveals another actor conversation or messages',()=>asActor(fixture.owner,async()=>{
 const id=(await c.query('SELECT app.start_jarvis_conversation() id')).rows[0].id;await c.query('SELECT app.append_jarvis_turn($1,$2,$3)',[id,crypto.randomUUID(),'FICTIF private history probe']);
 await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.other]);const history=(await c.query('SELECT app.get_jarvis_history(50) value')).rows[0].value;assert.notEqual(history.conversationId,id);assert.ok(!history.messages.some(m=>m.contenu==='FICTIF private history probe'));
}));
await c.end();mkdirSync('.eval-out/alexa-agent',{recursive:true});writeFileSync('.eval-out/alexa-agent/sql-checks.json',JSON.stringify(results,null,2));


