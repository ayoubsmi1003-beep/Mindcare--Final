"use client";

import {useState,useEffect,useCallback,useRef} from "react";

import {documentsEditor as t,documentLabels,documentReasons,documentFilters} from "@/i18n/documents-editor";

import type {Draft,DraftPreview,PageManifest,IssuedSnapshot,DocumentKind,Variables,DocumentNode} from "@/shared/documents/types";

import {createDraft,listDrafts,previewDraft,issueDraft,duplicateDraft,archiveDraft,getSnapshot,reviseIssuedDocument} from "@/services/document-drafts";

import {getDocument,listDocuments,listPatientDocuments,markDocumentPrinted,voidDocument,type Document} from "@/services/documents";

import {getPatient} from "@/services/patients";

import {SelecteurPatient} from "./SelecteurPatient";

import {DocumentHistory} from "./DocumentHistory";

import {DocumentEditor} from "./DocumentEditor";

import {DocumentFields} from "./DocumentFields";

import {DocumentPreview} from "./DocumentPreview";

import {MedicationRows} from "./MedicationRows";

import {useDocumentDraft} from "./use-document-draft";

import {printDocument,printLegacyDocument} from "./document-printer";

import {documentAssetsReady} from "./document-pagination";

export function DocumentWorkspace({patientId:initialPatient=null,initialDocumentId=null}:{readonly patientId?:string|null;readonly initialDocumentId?:string|null}){

 const [patientId,setPatientId]=useState(initialPatient),[patientName,setPatientName]=useState(""),[draftId,setDraftId]=useState<string|null>(null),[kind,setKind]=useState<DocumentKind>("bonne_sante_mentale");

 const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[filterKind,setFilterKind]=useState<DocumentKind|null>(null),[filterStatus,setFilterStatus]=useState<"issued"|"voided"|null>(null),listGeneration=useRef(0);

 const [drafts,setDrafts]=useState<readonly Draft[]>([]),[documents,setDocuments]=useState<readonly Document[]>([]),[archived,setArchived]=useState(false);

 const [headerHtml,setHeaderHtml]=useState(""),[fieldValues,setFieldValues]=useState<Variables>({}),[auditPending,setAuditPending]=useState<string|null>(null),[regenerate,setRegenerate]=useState(false);

 const [preview,setPreview]=useState<DraftPreview|null>(null),[manifest,setManifest]=useState<PageManifest|null>(null),[opened,setOpened]=useState<Document|null>(null),[snapshot,setSnapshot]=useState<IssuedSnapshot|null>(null);

 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[voidReason,setVoidReason]=useState(""),[showVoid,setShowVoid]=useState(false);

 const [libraryTab,setLibraryTab]=useState<"drafts"|"issued">("drafts"),[view,setView]=useState<"edit"|"preview">("preview");
 const editing=useDocumentDraft(draftId),initialOpened=useRef<string|null>(null),root=useRef<HTMLDivElement>(null);

 const isCurrent=editing.isCurrent;
 const acceptPreview=useCallback((value:DraftPreview)=>{setPreview(value);const fields:Record<string,string>={};const walk=(n:DocumentNode)=>{if(n.type==="field")fields[String(n.attrs?.["name"])]=String(n.attrs?.["value"]??"");n.content?.forEach(walk);};walk(value.content);setFieldValues(fields);setHeaderHtml(value.html.split('<main class="doc2-body">')[0]??"");},[]);

 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer);},[search]);

 const refresh=useCallback(async()=>{const gen=++listGeneration.current;const [a,b]=await Promise.all([listDrafts(patientId,archived),patientId?listPatientDocuments(patientId):listDocuments({query,type:filterKind,status:filterStatus})]);if(gen!==listGeneration.current)return;if(a.ok)setDrafts(a.data);else setError(a.error.message);if(b.ok)setDocuments(b.data.filter(d=>(!filterKind||d.docType===filterKind)&&(!filterStatus||d.status===filterStatus)&&(!patientId||!query||(d.docNumber+" "+documentLabels[d.docType]).toLowerCase().includes(query.toLowerCase()))));else setError(b.error.message);},[patientId,archived,query,filterKind,filterStatus]);

 useEffect(()=>{void refresh();},[refresh]);

 useEffect(()=>{let active=true;if(patientId)void getPatient(patientId).then(r=>{if(active&&r.ok&&r.data)setPatientName(r.data.lastName+" "+r.data.firstName);});return()=>{active=false;};},[patientId]);

 useEffect(()=>{if(root.current)void documentAssetsReady(root.current.ownerDocument).catch(()=>setError(t.printFailed));},[]);

 useEffect(()=>{if(editing.dirty){setManifest(null);setConfirm(false);}},[editing.dirty,editing.draft?.content,editing.draft?.variables,editing.draft?.documentDate]);

 useEffect(()=>{const draft=editing.draft;if(!draft||draft.id!==draftId||editing.dirty||draft.issuedDocumentId||draft.archivedAt)return;let active=true;const timer=setTimeout(()=>{void previewDraft(draft.id,draft.revision).then(r=>{if(active&&isCurrent(draft.id,draft.revision)){if(r.ok)acceptPreview(r.data);else setError(r.error.message);}});},250);return()=>{active=false;clearTimeout(timer);};},[draftId,editing.draft,editing.dirty,acceptPreview,isCurrent]);

 const openDocument=useCallback(async(id:string)=>{setBusy(true);try{if(editing.dirty&&!await editing.flush())return;const [a,b]=await Promise.all([getDocument(id),getSnapshot(id)]);if(!b.ok){setError(b.error.message);return;}if(a.ok&&a.data){setOpened(a.data);setSnapshot(b.data);setDraftId(null);setPreview(null);}else if(!a.ok)setError(a.error.message);}finally{setBusy(false);}},[editing]);

 useEffect(()=>{if(initialDocumentId&&initialOpened.current!==initialDocumentId){initialOpened.current=initialDocumentId;void openDocument(initialDocumentId);}},[initialDocumentId,openDocument]);

 useEffect(()=>{const guard=(event:MouseEvent)=>{const link=event.target instanceof Element?event.target.closest("a[href]"):null;if(!editing.dirty||!link||event.ctrlKey||event.metaKey)return;event.preventDefault();event.stopPropagation();void editing.flush().then(saved=>{if(saved)window.location.assign(link.getAttribute("href")!);});};document.addEventListener("click",guard,true);return()=>document.removeEventListener("click",guard,true);},[editing]);

 const chooseDraft=async(draft:Draft)=>{if(draft.issuedDocumentId){await openDocument(draft.issuedDocumentId);setLibraryTab("issued");return;}if(editing.dirty&&!await editing.flush())return;setOpened(null);setSnapshot(null);setPreview(null);setManifest(null);setView("preview");setLibraryTab("drafts");setHeaderHtml("");setFieldValues({});setDraftId(draft.id);setPatientId(draft.patientId);setPatientName(draft.patientName);setKind(draft.kind);setError(null);};

 const newDocument=async()=>{if(!patientId)return;if(editing.dirty&&!await editing.flush())return;setBusy(true);const p=await getPatient(patientId);const birth=p.ok&&p.data?.birthDate?p.data.birthDate.split("-").reverse().join("/"):"";const variables=kind==="bonne_sante_mentale"?{id_document_number:"",mairie:""}:kind==="suivi_medical"?{jours:"",jours_lettres:"",date_debut:""}:kind==="certificat_medical"?{date_naissance:birth,traitement_1:"",traitement_2:""}:kind==="justification"?{date_consultation:""}:{};const r=await createDraft(patientId,kind,variables);setBusy(false);if(r.ok&&r.data){await chooseDraft(r.data);await refresh();}else if(!r.ok)setError(r.error.message);};

 const prepare=async()=>{setBusy(true);setError(null);const saved=await editing.flush();if(saved){const r=await previewDraft(saved.id,saved.revision);if(r.ok){if(editing.isCurrent(saved.id,saved.revision))acceptPreview(r.data);}else setError(r.error.message);}setBusy(false);};

 const issue=async()=>{if(!preview||!manifest||editing.dirty)return;setBusy(true);setError(null);const r=await issueDraft(preview,manifest);setBusy(false);if(r.ok){setSnapshot(r.data);setConfirm(false);await openDocument(r.data.documentId);await refresh();}else {setError(r.error.message);setConfirm(false);if(r.error.context==="preview-stale")setPreview(null);}};

 const duplicate=async()=>{const id=editing.draft?.id??snapshot?.draftId;if(!id&&!opened)return;if(editing.dirty&&!await editing.flush())return;const r=id?await duplicateDraft(id):await reviseIssuedDocument(opened!.id);if(r.ok&&r.data){await chooseDraft(r.data);await refresh();}else if(!r.ok)setError(r.error.message);};

 const print=async()=>{if(!opened)return;setError(null);setBusy(true);try{if(snapshot)await printDocument(snapshot);else if(opened.renderedHtml)await printLegacyDocument(opened.renderedHtml);const r=await markDocumentPrinted(opened.id);if(!r.ok){setError(t.printAuditFailed);setAuditPending(opened.id);}else {setAuditPending(null);await openDocument(opened.id);}}catch{setError(t.printFailed);}finally{setBusy(false);}};

 return <div ref={root} className="doc2-studio">
 <header className="doc2-studio-head"><div className="doc2-patient"><small>{t.patient}</small><strong>{patientName||t.choosePatient}</strong></div><div className="doc2-create"><select aria-label={t.kind} value={kind} onChange={e=>setKind(e.target.value as DocumentKind)}>{Object.entries(documentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button className="doc2-primary" type="button" disabled={!patientId||busy} onClick={()=>{void newDocument();}}>+ {t.newDocument}</button></div></header>
 <details className="doc2-patient-picker" open={!patientId}><summary>{patientId?t.changePatient:t.choosePatient}</summary><SelecteurPatient onChoisir={p=>{if(busy)return;void (async()=>{if(editing.dirty&&!await editing.flush())return;setPatientId(p.id);setPatientName(p.lastName+" "+p.firstName);setDraftId(null);setOpened(null);setPreview(null);setHeaderHtml("");setFieldValues({});})();}}/></details>
 {error||editing.error?<p role="alert" className="text-critical">{error??editing.error}</p>:null}
 {editing.error&&!editing.draft?<button type="button" onClick={()=>{void editing.recover(false);}}>{t.retry}</button>:null}
 <div className="doc2-workspace"><aside className="doc2-library"><div className="doc2-library-title">{t.library}</div><div className="doc2-tabs"><button type="button" aria-pressed={libraryTab==="drafts"} onClick={()=>setLibraryTab("drafts")}>{t.drafts}</button><button type="button" aria-pressed={libraryTab==="issued"} onClick={()=>setLibraryTab("issued")}>{t.issuedStatus}</button></div><input aria-label={documentFilters.search} placeholder={documentFilters.search} value={search} onChange={e=>setSearch(e.target.value)}/><details className="doc2-filters"><summary>{t.filters}</summary><select aria-label={documentFilters.allKinds} value={filterKind??""} onChange={e=>setFilterKind(e.target.value?e.target.value as DocumentKind:null)}><option value="">{documentFilters.allKinds}</option>{Object.entries(documentLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><select aria-label={documentFilters.allStatuses} value={filterStatus??""} onChange={e=>setFilterStatus(e.target.value?e.target.value as "issued"|"voided":null)}><option value="">{documentFilters.allStatuses}</option><option value="issued">{t.issuedStatus}</option><option value="voided">{t.voided}</option></select><label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>{t.archive}</label></details>
 <div className="doc2-history">{libraryTab==="drafts"?(drafts.length?drafts.filter(d=>(!filterKind||d.kind===filterKind)&&(!query||(d.title+" "+d.patientName).toLowerCase().includes(query.toLowerCase()))).map(d=><button className={d.id===draftId?"is-selected":""} type="button" disabled={busy} key={d.id} onClick={()=>{void chooseDraft(d);}}><strong>{documentLabels[d.kind]}</strong><small>{d.patientName} · {t.revision} {d.revision}{d.issuedDocumentId?" · "+t.issuedStatus:""}</small></button>):<p>{t.emptyDrafts}</p>):documents.length?documents.map(d=><button className={d.id===opened?.id?"is-selected":""} type="button" disabled={busy} key={d.id} onClick={()=>{void openDocument(d.id);}}><strong>{documentLabels[d.docType]}</strong><small>{d.docNumber} · {d.status==="voided"?t.voided:t.issuedStatus}</small></button>):<p>{t.emptyDocuments}</p>}</div></aside>
 <main className="doc2-main">{editing.draft&&editing.draft.id===draftId?<><header className="doc2-document-head"><div><h2>{documentLabels[editing.draft.kind]}</h2><span role="status" className="doc2-save-status">{editing.saveLabel}</span></div><div className="doc2-actions">{editing.dirty||editing.error?<button type="button" disabled={busy||editing.state.conflict} onClick={()=>{void editing.flush().then(refresh);}}>{t.save}</button>:null}<details className="doc2-action-menu"><summary>{t.more}</summary><div><button type="button" disabled={busy} onClick={()=>{void duplicate();}}>{t.duplicate}</button><button type="button" disabled={busy} onClick={()=>{void (async()=>{if(editing.dirty&&!await editing.flush())return;const r=await archiveDraft(editing.draft!.id,!editing.draft!.archivedAt);if(r.ok){setDraftId(null);await refresh();}else setError(r.error.message);})();}}>{editing.draft.archivedAt?t.restore:t.archive}</button><button type="button" disabled={busy||editing.dirty} onClick={()=>setRegenerate(true)}>{t.regenerate}</button><DocumentHistory id={editing.draft.id} onRestore={busy||editing.draft.issuedDocumentId||editing.draft.archivedAt?null:(content,variables,date)=>{editing.setContent(content);editing.setVariables(variables);editing.setDate(date);}}/></div></details><button className="doc2-primary" type="button" disabled={busy||!manifest||!preview?.readiness.canIssue||editing.dirty||Boolean(editing.draft.issuedDocumentId)||Boolean(editing.draft.archivedAt)} onClick={()=>{setView("preview");setConfirm(true);}}>{t.issue} →</button></div></header>
 {!editing.draft.issuedDocumentId&&!editing.draft.archivedAt?<div className="doc2-compose" inert={busy}><aside className="doc2-fields">{editing.draft.kind==="ordonnance"?<MedicationRows content={editing.draft.content} onChange={editing.setContent}/>:<DocumentFields draft={editing.draft} onChange={editing.setVariables} onDate={editing.setDate}/>}</aside><section className="doc2-paper-area">{editing.draft.kind!=="ordonnance"?<div className="doc2-view-switch"><button type="button" aria-pressed={view==="preview"} onClick={()=>{setView("preview");if(!preview)void prepare();}}>{t.preview}</button><button type="button" aria-pressed={view==="edit"} onClick={()=>setView("edit")}>{t.edit}</button></div>:null}
 {editing.draft.kind!=="ordonnance"?<div className={view==="edit"?undefined:"doc2-offscreen"}><DocumentEditor key={editing.draft.id} invalid={editing.invalidContent} headerHtml={headerHtml} fieldValues={{...fieldValues,...Object.fromEntries(Object.entries(editing.draft.variables).filter(([key])=>key!=="jours_lettres").map(([key,value])=>["vars_"+key,value]))}} content={editing.draft.content} onChange={editing.setContent} onError={editing.rejectContent}/></div>:null}
 <div className={view==="preview"||editing.draft.kind==="ordonnance"?undefined:"doc2-offscreen"}>{editing.dirty?<p className="doc2-hint" role="status">{t.previewStale}</p>:null}{preview?<DocumentPreview preview={preview} onLayout={setManifest}/>:<p className="doc2-hint">{editing.dirty?t.previewStale:t.previewLoading}</p>}</div></section></div>:null}
 {editing.state.conflict?<div role="alert"><p>{t.recoveryConfirm}</p><button type="button" onClick={()=>{void editing.recover(false);}}>{t.reload}</button><button type="button" onClick={()=>{void editing.recover(true);}}>{t.keepLocal}</button></div>:null}
 {preview?.readiness.reasons.length?<div className="doc2-readiness">{preview.readiness.reasons.map(reason=><p key={reason}>{documentReasons[reason]}</p>)}</div>:null}</>:null}
 {opened?<><header className="doc2-document-head"><div><h2>{documentLabels[opened.docType]}</h2><small>{opened.docNumber} · {opened.status==="voided"?t.voided:t.issuedStatus}</small></div><div className="doc2-actions"><details className="doc2-action-menu"><summary>{t.more}</summary><div><button type="button" disabled={busy} onClick={()=>{void duplicate();}}>{t.newRevision}</button><button type="button" disabled={busy||opened.status==="voided"} onClick={()=>setShowVoid(true)}>{t.voidDocument}</button></div></details><button className="doc2-primary" type="button" disabled={busy||opened.status==="voided"} onClick={()=>{void print();}}>{t.print}</button></div></header>{opened.voidReason?<p>{opened.voidReason}</p>:null}{auditPending===opened.id?<button type="button" onClick={()=>{void markDocumentPrinted(opened.id).then(r=>{if(r.ok){setAuditPending(null);setError(null);void openDocument(opened.id);}else setError(t.printAuditFailed);});}}>{t.auditRetry}</button>:null}{!snapshot?<p>{t.legacyRevisionNotice}</p>:null}<div className="doc2-paper-area"><div className="doc2-preview" dangerouslySetInnerHTML={{__html:snapshot?.html??'<article class="doc2-page doc2-legacy doc-feuille doc-corps">'+(opened.renderedHtml??"")+'</article>'}}/></div><details className="doc2-print-help"><summary>{t.print}</summary><p>{t.printInstructions}</p></details></>:null}
 {!opened&&!draftId?<div className="doc2-empty"><div className="doc2-empty-icon">▤</div><h2>{t.newDocument}</h2><p>{t.startHint}</p></div>:null}</main></div>

 {regenerate?<div role="dialog" aria-modal="true" aria-label={t.regenerate} className="doc2-confirm"><p>{t.regenerateConfirmation}</p><button type="button" onClick={()=>{setRegenerate(false);void newDocument();}}>{t.regenerate}</button><button type="button" onClick={()=>setRegenerate(false)}>{t.close}</button></div>:null}

 {confirm?<div role="dialog" aria-modal="true" aria-label={t.confirmIssue} className="doc2-confirm"><h2>{t.confirmIssue}</h2><p>{t.confirmBody}</p><button type="button" disabled={busy} onClick={()=>{void issue();}}>{t.confirmIssue}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)}>{t.close}</button></div>:null}

 {showVoid?<div role="dialog" aria-modal="true" aria-label={t.voidDocument} className="doc2-confirm"><p>{t.voidConfirmation}</p><label>{t.voidReason}<textarea value={voidReason} onChange={e=>setVoidReason(e.target.value)}/></label><button type="button" disabled={!voidReason.trim()||busy} onClick={()=>{void (async()=>{if(!opened)return;setBusy(true);const r=await voidDocument(opened.id,voidReason);setBusy(false);if(r.ok){setShowVoid(false);await openDocument(opened.id);await refresh();}else setError(r.error.message);})();}}>{t.voidDocument}</button><button type="button" onClick={()=>setShowVoid(false)}>{t.close}</button></div>:null}</div>;

}

