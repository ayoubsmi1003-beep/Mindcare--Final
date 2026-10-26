import {recordReadMatches} from './alexa-eval-record-meaning.mjs';

const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr');
const compact=value=>fold(value).replace(/\s+/gu,' ').trim();
const payload=read=>{const value=read?.response?.ok===false?null:read?.response?.data??read?.response;return Array.isArray(value)?value[0]??null:value;};
const parseSpec=read=>{try{return JSON.parse(read?.args?.p_spec??'{}');}catch{return {};}};
const emptyAnswer=text=>/\b(?:aucun\w*|aucune|pas renseigne\w*|non renseigne\w*|absent\w*|manquant\w*)\b/u.test(fold(text));
const answerDate=/\b20\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/iu;
const idLike=/\b(?:patient|consultation|note)-[a-f0-9]{6,}\b/iu;
const rowKey=row=>[row?.consultationId,row?.sourceId,row?.area,row?.text,row?.textOffset,row?.textLength];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const answerMentions=(answer,value)=>Boolean(value)&&compact(answer).includes(compact(value));
const countWords=['zero','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf','vingt'];
const showsCount=(answer,total)=>new RegExp('(?:^|\\D)'+total+'(?:\\D|$)','u').test(String(answer??'').normalize('NFKC').replace(/(?<=\p{N})\p{White_Space}+(?=\p{N})/gu,''))||total<countWords.length&&new RegExp('\\b'+countWords[total]+'\\b','u').test(fold(answer));
const consultationRows=raw=>Array.isArray(raw?.consultations)?raw.consultations:[];
const contextRows=queries=>queries.filter(q=>q.name==='get_alexa_clinical_context').map(payload).filter(Boolean);
const citedConsultationIds=sentences=>[...new Set((sentences??[]).flatMap(sentence=>sentence.sources??[]).filter(source=>source.type==='consultation').map(source=>String(source.id)))];

/** Independently checks patient-facing reads against source-table oracle results. */
export function assessPatientDetail(oracle,expected,queries,calls,sentences,answer){
 const failures=[],person=expected?.patient,patientId=person?.patientId;
 const patientRead=queries.find(q=>q.name==='get_patient'&&q.args?.p_id===patientId),profile=payload(patientRead);
 const contextCall=(calls??[]).find(call=>call.name==='get_patient_context'&&call.args?.section===oracle?.section);
 if(!person||!patientRead||!profile||profile.id!==patientId)failures.push('audited-patient-read-missing');
 // An exact patient count is verified by the explicit name search, get_patient,
 // and a patient-scoped consultations gate; reading the full profile adds no
 // evidence for that count and would expose unrelated personal fields.
 const needsContextSection=!(oracle?.section==='profile'&&oracle?.field==='completed_consultations');
 if(needsContextSection&&!contextCall)failures.push('patient-context-section-missing');
 if(oracle?.byName&&!answerMentions(answer,person?.name))failures.push('patient-name-not-presented');
 if(oracle?.byName){
  const nameRead=queries.some(q=>{
   if(q.name!=='search_patients')return false;
    const spec=parseSpec(q),data=payload(q),raw=q.response?.data;
    const terms=typeof q.args?.p_query==='string'?q.args.p_query:[spec.query,spec.patientName].filter(Boolean).join(' ');
    const rows=Array.isArray(raw)?raw.flatMap(row=>Array.isArray(row?.rows)?row.rows:[row]):Array.isArray(data?.rows)?data.rows:data?[data]:[];
    const matches=rows.filter(row=>row?.id===patientId&&(!(row.first_name||row.last_name)||compact(`${row.first_name??''} ${row.last_name??''}`)===compact(person?.name)));
    const rawTotal=data?.total??data?.total_count??rows.length,total=typeof rawTotal==='number'?rawTotal:typeof rawTotal==='string'&&/^\d+$/u.test(rawTotal)?Number(rawTotal):NaN;
    return compact(terms).includes(compact(person?.name))&&Number.isSafeInteger(total)&&total===1&&matches.length===1;
  });
  if(!nameRead)failures.push('patient-name-resolution-not-tested');
 }
 if(idLike.test(answer))failures.push('internal-patient-id-presented');

 if(oracle?.section==='profile'){
  if(compact(`${profile?.first_name??''} ${profile?.last_name??''}`)!==compact(person?.name))failures.push('independent-patient-name-mismatch');
  if((profile?.phone??null)!==(person?.phone??null))failures.push('independent-patient-phone-mismatch');
  if(!answerMentions(answer,person?.name))failures.push('patient-name-not-presented');
  if(oracle.field==='phone'&&person?.phone){if(!compact(answer).includes(compact(person.phone)))failures.push('patient-phone-not-presented');}
  else if(oracle.field==='phone'&&!emptyAnswer(answer))failures.push('missing-patient-phone-not-stated');
  if(oracle.field==='completed_consultations'){
   if(!showsCount(answer,person?.closedCount)||!/consultation|seance/u.test(fold(answer)))failures.push('completed-consultation-count-not-presented');
   const query={mode:'count',status:'closed',patientRef:oracle.patientRef??'primary'},countRead=queries.find(q=>q.name==='query_alexa_records'&&q.args?.p_domain==='consultations'&&recordReadMatches(q,{domain:'consultations',query},{[oracle.patientRef??'primary']:patientId}));
   if(!countRead||payload(countRead)?.total!==person?.closedCount)failures.push('independent-completed-consultation-count-mismatch');
  }
  return failures;
 }

 if(oracle?.section==='notes'){
  const pageRead=queries.find(q=>q.name==='query_alexa_note_sections'&&q.response?.ok!==false),page=payload(pageRead),spec=parseSpec(pageRead),wanted=expected?.notesPage;
  if(!pageRead||!page||!wanted)failures.push('independent-note-page-read-missing');
  else{
   if(spec.patientId!==patientId||spec.area!==oracle.area)failures.push('clinical-note-constraints-not-preserved');
   const rows=(page.rows??[]).map(rowKey),expectedRows=(wanted.rows??[]).map(rowKey);
   if(page.patientId!==patientId||page.total!==wanted.total||page.complete!==wanted.complete||!same(rows,expectedRows))failures.push('independent-clinical-note-data-mismatch');
   if(!wanted.rows?.length&&!emptyAnswer(answer))failures.push('empty-clinical-notes-not-stated');
  }
  return failures;
 }

 if(oracle?.section==='summary'){
  const data=contextRows(queries).find(row=>row.patientId===patientId),recent=expected?.recent??[],actual=consultationRows(data);
  if(!data||actual.length!==recent.length||!same(actual.map(row=>row.id),recent.map(row=>row.id)))failures.push('latest-consultation-set-mismatch');
  for(let index=0;index<Math.min(actual.length,recent.length);index++){
   const got=actual[index],want=recent[index],note=Array.isArray(got.notes)?got.notes[0]:got.notes;
   if((got.rawNotes??null)!==(want.rawNotes??null)||['subjective','objective','assessment','plan'].some(area=>(note?.[area]??null)!==(want.notes?.[area]??null)))failures.push('independent-consultation-note-mismatch');
  }
  if(!actual.length||!sentences?.some(sentence=>sentence.kind==='inference'))failures.push('clinical-summary-not-generated');
  const citations=citedConsultationIds(sentences);
  if(recent.some(row=>!citations.some(id=>id.includes(row.id))))failures.push('summary-source-missing');
  const words=(String(answer??'').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)??[]).length;
  const sentenceCount=(String(answer??'').match(/[.!?]+(?=\s|$)/gu)??[]).length||Number(Boolean(String(answer??'').trim()));
  if(String(answer??'').includes('\n')||words>100||sentenceCount>4)failures.push('clinical-summary-not-concise');
  if(!oracle.includeDate&&answerDate.test(answer))failures.push('unrequested-consultation-dates-presented');
  return failures;
 }

 const data=contextRows(queries).find(row=>row.patientId===patientId),section=oracle?.section;
 if(section==='timeline'){
  const read=queries.find(q=>q.name==='list_patient_timeline'),actual=read?.response?.ok===false?null:read?.response?.data??read?.response,wanted=expected?.timeline;
  if(!read||!Array.isArray(wanted))failures.push('independent-timeline-read-missing');
  else{
   const actualRows=Array.isArray(actual)?actual:actual?.rows??actual?.events??[];
   const ids=rows=>rows.map(row=>row.event_id??row.eventId??row.id);
   if(!same(ids(actualRows),ids(wanted)))failures.push('independent-timeline-data-mismatch');
   if(oracle.order==='chronological'){
    const page=wanted.slice(0,20),displayed=page.length,oldest=page.at(-1),newest=page[0];
    if(!displayed){if(!emptyAnswer(answer))failures.push('empty-clinical-section-not-stated');}
    else{
     const format=value=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Algiers',day:'numeric',month:'long',year:'numeric'}).format(new Date(value));
     const oldestDate=format(oldest.occurred_at),newestDate=format(newest.occurred_at),range=oldestDate===newestDate?`Le ${oldestDate}`:`Du ${oldestDate} au ${newestDate}`;
     const words=(String(answer??'').match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)??[]).length;
     if(!compact(answer).includes(compact(range))||!showsCount(answer,displayed)||!/evenements?/u.test(fold(answer))||!/plus ancien au plus recent/u.test(fold(answer))||String(answer??'').includes('\n')||words>75)failures.push('chronological-timeline-summary-mismatch');
     if(wanted.length>20&&!/cette page couvre[^.!?]*plus recen\w*[^.!?]*suite/iu.test(fold(answer)))failures.push('chronological-timeline-continuation-missing');
    }
   }
  }
  return failures;
 }
 if(!data)failures.push('clinical-context-read-missing');
 const key=section==='diagnoses'?'diagnoses':section==='scales'?'scales':'treatments';
 const wanted=section==='diagnoses'?person?.diagnoses:section==='scales'?person?.scales:person?.treatments;
 const actual=section==='treatments'?data?.treatments?.current:data?.[key];
 if(!Array.isArray(wanted)||!Array.isArray(actual))failures.push('independent-clinical-data-missing');
 else{
  let expectedRows=wanted;
  if(section==='diagnoses'&&oracle.state)expectedRows=wanted.filter(row=>oracle.state==='resolved'?row.resolved:!row.resolved);
  if(section==='treatments'&&oracle.state)expectedRows=wanted.filter(row=>row.status===oracle.state);
  const ids=rows=>rows.map(row=>row.id).sort();
  if(!same(ids(actual),ids(expectedRows)))failures.push('independent-clinical-data-mismatch');
  for(const row of expectedRows){
   const label=row.name??row.label;
   if(label&&!answerMentions(answer,label))failures.push(section==='scales'?'scale-name-not-presented':'clinical-label-not-presented');
  }
  if(!expectedRows.length&&!emptyAnswer(answer))failures.push('empty-clinical-section-not-stated');
 }
 return failures;
}
