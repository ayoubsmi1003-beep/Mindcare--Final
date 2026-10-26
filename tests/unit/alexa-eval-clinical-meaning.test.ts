import {expect,it} from 'vitest';
import {assessPatientDetail} from '../../scripts/lib/alexa-eval-clinical-meaning.mjs';

const patient={patientId:'patient-1',name:'Nadia Test',phone:'0600000000',diagnoses:[],scales:[],treatments:[]};
const patientRead={name:'get_patient',args:{p_id:patient.patientId},response:{ok:true,data:[{id:patient.patientId,first_name:'Nadia',last_name:'Test',phone:patient.phone}]}};
const contextCall={name:'get_patient_context',args:{section:'profile'}};

it('checks that a name and phone answer comes from the audited patient profile',()=>{
 const failures=assessPatientDetail({section:'profile',field:'phone'},{patient},[patientRead],[contextCall],[],'Nadia Test a pour numéro 0600000000.');
 expect(failures).toEqual([]);
 expect(assessPatientDetail({section:'profile',field:'phone'},{patient},[patientRead],[contextCall],[],'Le numéro est 0550999999.')).toContain('patient-phone-not-presented');
});

it('requires full-name resolution and checks completed consultation counts',()=>{
 const namedSearch={name:'search_patients',args:{p_spec:JSON.stringify({mode:'list',query:'Nadia Test'})},response:{ok:true,data:[{total:1,rows:[{id:patient.patientId}]}]}};
  const directNameSearch={name:'search_patients',args:{p_query:'Nadia Test',p_limit:20,p_offset:0},response:{ok:true,data:[{id:patient.patientId,first_name:'Nadia',last_name:'Test'}]}};
 const context=[{name:'query_consultations',args:{mode:'count'}}];
 const consultRead={name:'query_alexa_records',args:{p_domain:'consultations',p_spec:JSON.stringify({mode:'count',status:'closed',patientId:patient.patientId})},response:{ok:true,data:[{total:6}]}};
 expect(assessPatientDetail({section:'profile',field:'completed_consultations',byName:true},{patient:{...patient,closedCount:6}},[namedSearch,patientRead,consultRead],context,[],'Nadia Test compte six consultations terminées.')).toEqual([]);
  expect(assessPatientDetail({section:'profile',field:'completed_consultations',byName:true},{patient:{...patient,closedCount:6}},[directNameSearch,patientRead,consultRead],context,[],'Nadia Test compte six consultations terminées.')).toEqual([]);
  expect(assessPatientDetail({section:'profile',field:'completed_consultations',byName:true},{patient:{...patient,closedCount:6}},[{...directNameSearch,args:{...directNameSearch.args,p_query:'Nadia'}} ,patientRead,consultRead],context,[],'Nadia Test compte six consultations terminées.')).toContain('patient-name-resolution-not-tested');
 expect(assessPatientDetail({section:'profile',field:'completed_consultations',byName:true},{patient:{...patient,closedCount:6}},[patientRead],context,[],'Nadia Test compte six consultations terminées.')).toContain('patient-name-resolution-not-tested');
 expect(assessPatientDetail({section:'profile',field:'completed_consultations',byName:true},{patient:{...patient,closedCount:6}},[namedSearch,patientRead],context,[],'Nadia Test compte six consultations terminées.')).toContain('independent-completed-consultation-count-mismatch');
});
it('accepts PostgreSQL bigint totals serialized as decimal strings for exact-name resolution',()=>{
 const search={name:'search_patients',args:{p_query:'Nadia Test',p_limit:20,p_offset:0},response:{ok:true,data:[{total:'1',rows:[{id:patient.patientId,first_name:'Nadia',last_name:'Test'}]}]}};
 const failures=assessPatientDetail({section:'profile',field:'phone',byName:true},{patient},[search,patientRead],[contextCall],[],'Nadia Test a pour numéro 0600000000.');
 expect(failures).toEqual([]);
});

it('matches requested note text and area while ignoring signature metadata',()=>{
 const expected={patient,notesPage:{patientId:patient.patientId,total:1,complete:true,rows:[{consultationId:'consult-1',sourceId:'note-1',area:'subjective',text:'La patiente décrit une amélioration.',textOffset:0,textLength:35}]}};
 const query={name:'query_alexa_note_sections',args:{p_spec:JSON.stringify({patientId:patient.patientId,area:'subjective'})},response:{ok:true,data:[{patientId:patient.patientId,total:1,complete:true,rows:[{consultationId:'consult-1',sourceId:'note-1',area:'subjective',text:'La patiente décrit une amélioration.',textOffset:0,textLength:35,signedAt:'2026-10-01T09:00:00Z'}]}]}};
 const calls=[{name:'get_patient_context',args:{section:'notes',area:'subjective'}}];
 expect(assessPatientDetail({section:'notes',area:'subjective'},expected,[patientRead,query],calls,[],'La note Subjectif indique une amélioration rapportée par la patiente.')).toEqual([]);
 const wrongArea={...query,args:{p_spec:JSON.stringify({patientId:patient.patientId,area:'assessment'})}};
 expect(assessPatientDetail({section:'notes',area:'subjective'},expected,[patientRead,wrongArea],calls,[],'La note indique une amélioration.')).toContain('clinical-note-constraints-not-preserved');
});

it('requires the requested recent consultations to match the independent note oracle and cited sources',()=>{
 const recent=[{id:'consult-2',rawNotes:'Sommeil amélioré.',notes:{subjective:'Sommeil amélioré.',objective:'',assessment:'Évolution favorable.',plan:'Poursuivre le suivi.'}},{id:'consult-1',rawNotes:'Anxiété persistante.',notes:{subjective:'Anxiété persistante.',objective:'',assessment:'Anxiété à surveiller.',plan:'Réévaluation prévue.'}}];
 const expected={patient,recent};
 const query={name:'get_alexa_clinical_context',args:{p_patient_id:patient.patientId,p_limit:2},response:{ok:true,data:[{patientId:patient.patientId,consultations:recent.map(row=>({...row,startedAt:'2026-10-01T09:00:00Z',notes:[{...row.notes,signedAt:'2026-10-01T10:00:00Z'}]}))}]}};
 const queryConsultations=query.response.data[0]!.consultations;
 const calls=[{name:'get_patient_context',args:{section:'summary',count:2}}];
 const sentences=[{kind:'inference',text:'Les deux dernières consultations décrivent une amélioration du sommeil, avec une anxiété qui reste à surveiller.',sources:[{type:'consultation',id:'consult-2'},{type:'consultation',id:'consult-1'}]}];
 const summaryText=sentences[0]!.text;
 expect(assessPatientDetail({section:'summary',scope:'two' },expected,[patientRead,query],calls,sentences,summaryText)).toEqual([]);
 expect(assessPatientDetail({section:'summary',scope:'two',byName:true},expected,[patientRead,query],calls,sentences,summaryText)).toContain('patient-name-not-presented');
 expect(assessPatientDetail({section:'summary',scope:'two' },expected,[patientRead,{...query,response:{ok:true,data:[{patientId:patient.patientId,consultations:queryConsultations.slice(0,1)}]}}],calls,sentences,summaryText)).toContain('latest-consultation-set-mismatch');
 expect(assessPatientDetail({section:'summary',scope:'two' },expected,[patientRead,query],calls,[{...sentences[0]!,sources:[{type:'consultation',id:'consult-2'}]}],summaryText)).toContain('summary-source-missing');
});

it('does not turn an empty scale section into an invented result',()=>{
 const expected={patient,clinicalContext:{patientId:patient.patientId,scales:[]}};
 const query={name:'get_alexa_clinical_context',args:{p_patient_id:patient.patientId},response:{ok:true,data:[{patientId:patient.patientId,scales:[]}]}};
 const calls=[{name:'get_patient_context',args:{section:'scales'}}];
 expect(assessPatientDetail({section:'scales'},expected,[patientRead,query],calls,[],'Aucune échelle n’est renseignée dans le dossier.')).toEqual([]);
 expect(assessPatientDetail({section:'scales'},expected,[patientRead,{...query,response:{ok:true,data:[{patientId:patient.patientId,scales:[{id:'made-up',name:'Échelle inconnue'}]}]}}],calls,[],'Une échelle PHQ-9 est renseignée.')).toContain('independent-clinical-data-mismatch');
});

it('qualifies a concise chronological timeline summary against the oldest and newest independent events',()=>{
 const timeline=[
  {occurred_at:'2026-10-02T09:00:00+01:00',event_id:'event-new',event_type:'consultation',label_key:'consultation_close',detail:{}},
  {occurred_at:'2026-10-01T09:00:00+01:00',event_id:'event-old',event_type:'consultation',label_key:'consultation_close',detail:{}},
 ];
 const expected={patient,timeline};
 const query={name:'list_patient_timeline',args:{p_id:patient.patientId,p_limit:21},response:{ok:true,data:timeline}};
 const calls=[{name:'get_patient_context',args:{section:'timeline',count:20}}];
 const answer='Du 1 octobre 2026 au 2 octobre 2026, la chronologie comprend 2 consultations. Les 2 événements sont présentés du plus ancien au plus récent.';
 expect(assessPatientDetail({section:'timeline',order:'chronological'},expected,[patientRead,query],calls,[],answer)).toEqual([]);
 expect(assessPatientDetail({section:'timeline',order:'chronological'},expected,[patientRead,query],calls,[],answer.replace('1 octobre 2026 au 2 octobre 2026','2 octobre 2026 au 1 octobre 2026'))).toContain('chronological-timeline-summary-mismatch');
 expect(assessPatientDetail({section:'timeline',order:'chronological'},expected,[patientRead,query],calls,[],'')).toContain('chronological-timeline-summary-mismatch');
});

it('checks current treatments in the nested clinical context shape',()=>{
 const expected={patient};
 const query={name:'get_alexa_clinical_context',args:{p_patient_id:patient.patientId},response:{ok:true,data:[{patientId:patient.patientId,treatments:{current:[],history:[]}}]}};
 const calls=[{name:'get_patient_context',args:{section:'treatments'}}];
 expect(assessPatientDetail({section:'treatments',state:'paused'},expected,[patientRead,query],calls,[],'Aucun traitement suspendu n’est documenté.')).toEqual([]);
});
