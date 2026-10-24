"use client";

import {useState,useEffect,useCallback,useRef} from "react";

import {Badge,Bouton,Icone} from "@/components/ui";
import {documentsEditor as t,documentLabels,documentReasons,documentFilters} from "@/i18n/documents-editor";

import type {Draft,DraftPreview,PageManifest,IssuedSnapshot,DocumentKind,Variables,DocumentNode} from "@/shared/documents/types";

import {createDraft,saveDraft,listDrafts,previewDraft,issueDraft,duplicateDraft,archiveDraft,getSnapshot,reviseIssuedDocument} from "@/services/document-drafts";

import {getDocument,listDocuments,listPatientDocuments,markDocumentPrinted,voidDocument,type Document} from "@/services/documents";

import {getPatient,getPatientWorkspace} from "@/services/patients";

import {SelecteurPatient} from "./SelecteurPatient";

import {DocumentDialog} from "./DocumentDialog";

import {DocumentHistory} from "./DocumentHistory";

import {DocumentEditor} from "./DocumentEditor";

import {DocumentFields} from "./DocumentFields";

import {DocumentPreview} from "./DocumentPreview";

import {MedicationRows} from "./MedicationRows";

import {useDocumentDraft} from "./use-document-draft";

import {printDocument,printLegacyDocument} from "./document-printer";

import {documentAssetsReady} from "./document-pagination";

import {buildAutoFillSource,buildInitialContent,buildInitialVariables} from "./document-autofill";

const ISSUED_ZOOMS=[65,75,90,100,110,125] as const;
type IssuedZoom=typeof ISSUED_ZOOMS[number];

function fitIssuedZoom():IssuedZoom{
 return window.innerHeight<820?65:window.innerHeight<1000?75:100;
}

function formatDate(value:string|null|undefined):string{
 if(value===null||value===undefined||value==="")return "";
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return value;
 return new Intl.DateTimeFormat("fr-DZ",{timeZone:"Africa/Algiers",day:"2-digit",month:"2-digit",year:"numeric"}).format(date);
}

function sameContent(a:Draft["content"],b:Draft["content"]):boolean{
 return JSON.stringify(a)===JSON.stringify(b);
}

export function DocumentWorkspace({patientId:initialPatient=null,initialDocumentId=null,initialDraftId=null,initialPrint=false}:{readonly patientId?:string|null;readonly initialDocumentId?:string|null;readonly initialDraftId?:string|null;readonly initialPrint?:boolean}){

 const [patientId,setPatientId]=useState(initialPatient),[patientName,setPatientName]=useState(""),[patientRecord,setPatientRecord]=useState(""),[draftId,setDraftId]=useState<string|null>(initialDraftId),[kind,setKind]=useState<DocumentKind>("bonne_sante_mentale");

 const [search,setSearch]=useState(""),[query,setQuery]=useState(""),[filterKind,setFilterKind]=useState<DocumentKind|null>(null),[filterStatus,setFilterStatus]=useState<"issued"|"voided"|null>(null),listGeneration=useRef(0);

 const [drafts,setDrafts]=useState<readonly Draft[]>([]),[documents,setDocuments]=useState<readonly Document[]>([]),[archived,setArchived]=useState(false);

 const [headerHtml,setHeaderHtml]=useState(""),[fieldValues,setFieldValues]=useState<Variables>({}),[auditPending,setAuditPending]=useState<string|null>(null),[regenerate,setRegenerate]=useState(false);

 const [preview,setPreview]=useState<DraftPreview|null>(null),[manifest,setManifest]=useState<PageManifest|null>(null),[opened,setOpened]=useState<Document|null>(null),[snapshot,setSnapshot]=useState<IssuedSnapshot|null>(null);

 const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[voidReason,setVoidReason]=useState(""),[showVoid,setShowVoid]=useState(false),[issuedZoom,setIssuedZoom]=useState<IssuedZoom>(100);

 const [libraryTab,setLibraryTab]=useState<"drafts"|"issued">("drafts"),[view,setView]=useState<"edit"|"preview">("preview");
 const editing=useDocumentDraft(draftId),initialOpened=useRef<string|null>(null),initialPrintDone=useRef(false),root=useRef<HTMLDivElement>(null),issuedManualZoom=useRef(false);

 useEffect(()=>{const fit=()=>{if(!issuedManualZoom.current)setIssuedZoom(fitIssuedZoom());};fit();window.addEventListener("resize",fit);return()=>window.removeEventListener("resize",fit);},[]);

 const loadedDraft=editing.draft;
 useEffect(()=>{if(!initialDraftId||loadedDraft?.id!==initialDraftId)return;setPatientId(loadedDraft.patientId);setPatientName(loadedDraft.patientName);setKind(loadedDraft.kind);setView("edit");},[initialDraftId,loadedDraft]);
 const isCurrent=editing.isCurrent;
 const acceptPreview=useCallback((value:DraftPreview)=>{setPreview(value);const fields:Record<string,string>={};const walk=(n:DocumentNode)=>{if(n.type==="field")fields[String(n.attrs?.["name"])]=String(n.attrs?.["value"]??"");n.content?.forEach(walk);};walk(value.content);setFieldValues(fields);setHeaderHtml(value.html.split('<main class="doc2-body">')[0]??"");},[]);

 useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer);},[search]);

 const refresh=useCallback(async()=>{const gen=++listGeneration.current;const [a,b]=await Promise.all([listDrafts(patientId,archived),patientId?listPatientDocuments(patientId):listDocuments({query,type:filterKind,status:filterStatus})]);if(gen!==listGeneration.current)return;if(a.ok)setDrafts(a.data);else setError(a.error.message);if(b.ok)setDocuments(b.data.filter(d=>(!filterKind||d.docType===filterKind)&&(!filterStatus||d.status===filterStatus)&&(!patientId||!query||(d.docNumber+" "+documentLabels[d.docType]).toLowerCase().includes(query.toLowerCase()))));else setError(b.error.message);},[patientId,archived,query,filterKind,filterStatus]);

 useEffect(()=>{void refresh();},[refresh]);

 useEffect(()=>{let active=true;if(patientId)void getPatient(patientId).then(r=>{if(active&&r.ok&&r.data){setPatientName(r.data.lastName+" "+r.data.firstName);setPatientRecord(r.data.recordNumber);}});return()=>{active=false;};},[patientId]);

 useEffect(()=>{if(root.current)void documentAssetsReady(root.current.ownerDocument).catch(()=>setError(t.printFailed));},[]);

 useEffect(()=>{if(editing.dirty){setManifest(null);setConfirm(false);}},[editing.dirty,editing.draft?.content,editing.draft?.variables,editing.draft?.documentDate]);

 useEffect(()=>{const draft=editing.draft;if(!draft||draft.id!==draftId||editing.dirty||draft.issuedDocumentId||draft.archivedAt)return;let active=true;const timer=setTimeout(()=>{void previewDraft(draft.id,draft.revision).then(r=>{if(active&&isCurrent(draft.id,draft.revision)){if(r.ok)acceptPreview(r.data);else setError(r.error.message);}});},250);return()=>{active=false;clearTimeout(timer);};},[draftId,editing.draft,editing.dirty,acceptPreview,isCurrent]);

 const openDocument=useCallback(async(id:string)=>{setBusy(true);try{if(editing.dirty&&!await editing.flush())return;const [a,b]=await Promise.all([getDocument(id),getSnapshot(id)]);if(!b.ok){setError(b.error.message);return;}if(a.ok&&a.data){setOpened(a.data);setSnapshot(b.data);setDraftId(null);setPreview(null);}else if(!a.ok)setError(a.error.message);}finally{setBusy(false);}},[editing]);

 useEffect(()=>{if(initialDocumentId&&initialOpened.current!==initialDocumentId){initialOpened.current=initialDocumentId;void openDocument(initialDocumentId);}},[initialDocumentId,openDocument]);

 useEffect(()=>{const guard=(event:MouseEvent)=>{const link=event.target instanceof Element?event.target.closest("a[href]"):null;if(!editing.dirty||!link||event.ctrlKey||event.metaKey)return;event.preventDefault();event.stopPropagation();void editing.flush().then(saved=>{if(saved)window.location.assign(link.getAttribute("href")!);});};document.addEventListener("click",guard,true);return()=>document.removeEventListener("click",guard,true);},[editing]);

 const chooseDraft=async(draft:Draft)=>{if(draft.issuedDocumentId){await openDocument(draft.issuedDocumentId);setLibraryTab("issued");return;}if(editing.dirty&&!await editing.flush())return;setOpened(null);setSnapshot(null);setPreview(null);setManifest(null);setView("preview");setLibraryTab("drafts");setHeaderHtml("");setFieldValues({});setDraftId(draft.id);setPatientId(draft.patientId);setPatientName(draft.patientName);setKind(draft.kind);setError(null);};

 const newDocument=async()=>{if(!patientId)return;if(editing.dirty&&!await editing.flush())return;setBusy(true);setError(null);let warning:string|null=null;try{
  const [pResult,wResult]=await Promise.allSettled([getPatient(patientId),getPatientWorkspace(patientId)]);
  const patient=pResult.status==="fulfilled"&&pResult.value.ok?pResult.value.data:null;
  const workspace=wResult.status==="fulfilled"&&wResult.value.ok?wResult.value.data:null;
  if(pResult.status==="rejected"||(pResult.status==="fulfilled"&&!pResult.value.ok)||wResult.status==="rejected"||(wResult.status==="fulfilled"&&!wResult.value.ok))warning=t.autoFillPartial;
  const source=buildAutoFillSource(patient,workspace);
  const variables=buildInitialVariables(kind,source);
  const created=await createDraft(patientId,kind,variables);
  if(!created.ok){setError(created.error.message);return;}
  if(created.data===null){setError(t.saveFailure);return;}
  let draft=created.data;
  const initialContent=buildInitialContent(kind,draft.content,source);
  if(!sameContent(initialContent,draft.content)){
   const saved=await saveDraft(draft,initialContent,variables,draft.documentDate);
   if(saved.ok)draft=saved.data;
   else warning=t.autoFillPartial;
  }
  await chooseDraft(draft);
  if(warning!==null)setError(warning);
  await refresh();
 }catch{setError(t.saveFailure);}finally{setBusy(false);}};

 const prepare=async()=>{setBusy(true);setError(null);const saved=await editing.flush();if(saved){const r=await previewDraft(saved.id,saved.revision);if(r.ok){if(editing.isCurrent(saved.id,saved.revision))acceptPreview(r.data);}else setError(r.error.message);}setBusy(false);};

 const issue=async()=>{if(!preview||!manifest||editing.dirty)return;setBusy(true);setError(null);const r=await issueDraft(preview,manifest);setBusy(false);if(r.ok){setSnapshot(r.data);setConfirm(false);setLibraryTab("issued");await openDocument(r.data.documentId);await refresh();}else{setError(r.error.message);setConfirm(false);if(r.error.context==="preview-stale")setPreview(null);}};

 const duplicate=async()=>{const id=editing.draft?.id??snapshot?.draftId;if(!id&&!opened)return;if(editing.dirty&&!await editing.flush())return;const r=id?await duplicateDraft(id):await reviseIssuedDocument(opened!.id);if(r.ok&&r.data){await chooseDraft(r.data);await refresh();}else if(!r.ok)setError(r.error.message);};

 const print=useCallback(async()=>{if(!opened)return;setError(null);setBusy(true);try{if(snapshot)await printDocument(snapshot);else if(opened.renderedHtml)await printLegacyDocument(opened.renderedHtml);const r=await markDocumentPrinted(opened.id);if(!r.ok){setError(t.printAuditFailed);setAuditPending(opened.id);}else{setAuditPending(null);await openDocument(opened.id);}}catch{setError(t.printFailed);}finally{setBusy(false);}},[opened,snapshot,openDocument]);
 // Alexa ne peut ouvrir que la pièce exacte qu'elle a relue. L'impression
 // reste le dialogue du navigateur : aucun succès d'imprimante n'est supposé.
 useEffect(()=>{if(!initialPrint||!initialDocumentId||initialPrintDone.current||opened?.id!==initialDocumentId||!snapshot)return;initialPrintDone.current=true;void print();},[initialPrint,initialDocumentId,opened,snapshot,print]);

 const changePatient=(p:{id:string;firstName:string;lastName:string;recordNumber:string})=>{if(busy)return;void(async()=>{if(editing.dirty&&!await editing.flush())return;setPatientId(p.id);setPatientName(p.lastName+" "+p.firstName);setPatientRecord(p.recordNumber);setDraftId(null);setOpened(null);setSnapshot(null);setPreview(null);setHeaderHtml("");setFieldValues({});setError(null);})();};

 const filteredDrafts=drafts.filter(d=>(!filterKind||d.kind===filterKind)&&(!query||(d.title+" "+d.patientName).toLowerCase().includes(query.toLowerCase())));
 const filteredDocuments=documents.filter(d=>(!filterKind||d.docType===filterKind)&&(!filterStatus||d.status===filterStatus)&&(query===""||(d.docNumber+" "+documentLabels[d.docType]+" "+(d.patientNom??"")+" "+(d.patientPrenom??"")).toLowerCase().includes(query.toLowerCase())));

 const draftItem=(draft:Draft)=><button className={draft.id===draftId?"doc2-doc-item is-selected":"doc2-doc-item"} type="button" disabled={busy} key={draft.id} aria-current={draft.id===draftId?"page":undefined} onClick={()=>{void chooseDraft(draft);}}>
  <span className="doc2-doc-icon"><Icone nom="documents" taille={20}/></span>
  <span className="doc2-doc-copy"><strong>{documentLabels[draft.kind]}</strong><small>{draft.patientName} · {t.versionShort}{draft.revision}</small></span>
 </button>;

 const issuedItem=(document:Document)=><button className={document.id===opened?.id?"doc2-doc-item is-selected":"doc2-doc-item"} type="button" disabled={busy} key={document.id} aria-current={document.id===opened?.id?"page":undefined} onClick={()=>{void openDocument(document.id);}}>
  <span className="doc2-doc-icon"><Icone nom="documents" taille={20}/></span>
  <span className="doc2-doc-copy"><strong>{documentLabels[document.docType]}</strong><small>{document.docNumber}</small><small>{document.patientPrenom??""} {document.patientNom??""} · {formatDate(document.issuedAt)}</small></span>
  <span className="doc2-doc-meta"><Badge ton={document.status==="voided"?"attention":"positif"}>{document.status==="voided"?t.voided:t.issuedStatus}</Badge></span>
 </button>;

 return <div ref={root} className="doc2-studio">
  <header className="doc2-studio-head">
   <div className="doc2-patient"><small>{t.patient}</small><strong>{patientName||t.choosePatient}</strong>{patientRecord!==""?<span className="doc2-record">{patientRecord}</span>:null}</div>
   <div className="doc2-create"><label className="doc2-kind"><span className="cache-visuellement">{t.kind}</span><select aria-label={t.kind} value={kind} onChange={e=>setKind(e.target.value as DocumentKind)}>{Object.entries(documentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Bouton rang="principal" taille="compact" disabled={!patientId||busy} onClick={()=>{void newDocument();}}><Icone nom="plus" taille={16}/>{t.newDocument}</Bouton></div>
  </header>

  <details className="doc2-patient-picker" open={!patientId}><summary>{patientId?t.changePatient:t.choosePatient}</summary><SelecteurPatient onChoisir={changePatient}/></details>

  {error||editing.error?<div className="doc2-alert" role="alert"><Icone nom="alerte" taille={20}/><p>{error??editing.error}</p>{editing.error&&!editing.draft?<button type="button" onClick={()=>{void editing.recover(false);}}>{t.retry}</button>:null}</div>:null}

  <div className="doc2-workspace">
   <aside className="doc2-library">
    <div className="doc2-library-head"><div><span className="doc2-eyebrow">{t.library}</span><strong>{drafts.length+documents.length}</strong></div><span className="doc2-library-note">{patientRecord}</span></div>
    <div className="doc2-tabs" role="tablist"><button type="button" role="tab" aria-selected={libraryTab==="drafts"} onClick={()=>setLibraryTab("drafts")}>{t.drafts}<span>{drafts.length}</span></button><button type="button" role="tab" aria-selected={libraryTab==="issued"} onClick={()=>setLibraryTab("issued")}>{t.issuedStatus}<span>{documents.length}</span></button></div>
    <div className="doc2-search"><Icone nom="recherche" taille={16}/><input aria-label={documentFilters.search} placeholder={documentFilters.search} value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <details className="doc2-filters"><summary><Icone nom="chevron" taille={16}/>{t.filters}</summary><select aria-label={documentFilters.allKinds} value={filterKind??""} onChange={e=>setFilterKind(e.target.value?e.target.value as DocumentKind:null)}><option value="">{documentFilters.allKinds}</option>{Object.entries(documentLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><select aria-label={documentFilters.allStatuses} value={filterStatus??""} onChange={e=>setFilterStatus(e.target.value?e.target.value as "issued"|"voided":null)}><option value="">{documentFilters.allStatuses}</option><option value="issued">{t.issuedStatus}</option><option value="voided">{t.voided}</option></select><label className="doc2-check"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>{t.archive}</label></details>
    <div className="doc2-history">{libraryTab==="drafts"?(filteredDrafts.length>0?filteredDrafts.map(draftItem):<div className="doc2-empty-list"><Icone nom="documents" taille={24}/><p>{t.emptyDrafts}</p></div>):(filteredDocuments.length>0?filteredDocuments.map(issuedItem):<div className="doc2-empty-list"><Icone nom="documents" taille={24}/><p>{t.emptyDocuments}</p></div>)}</div>
   </aside>

   <main className="doc2-main">
    {editing.draft&&editing.draft.id===draftId?<>
     <header className="doc2-document-head"><div className="doc2-document-title"><div className="doc2-title-line"><h2>{documentLabels[editing.draft.kind]}</h2><Badge ton="neutre">{t.draft}</Badge></div><span role="status" className="doc2-save-status">{editing.saveLabel}</span><small className="doc2-number-note">{t.draftNumberPending}</small></div><div className="doc2-actions">{editing.dirty||editing.error?<Bouton rang="secondaire" taille="compact" disabled={busy||editing.state.conflict} onClick={()=>{void editing.flush().then(refresh);}}>{t.save}</Bouton>:null}<details className="doc2-action-menu"><summary>{t.more}<Icone nom="chevron" taille={16}/></summary><div><button type="button" disabled={busy} onClick={()=>{void duplicate();}}>{t.duplicate}</button><button type="button" disabled={busy} onClick={()=>{void(async()=>{if(editing.dirty&&!await editing.flush())return;const r=await archiveDraft(editing.draft!.id,!editing.draft!.archivedAt);if(r.ok){setDraftId(null);await refresh();}else setError(r.error.message);})();}}>{editing.draft.archivedAt?t.restore:t.archive}</button><button type="button" disabled={busy||editing.dirty} onClick={()=>setRegenerate(true)}>{t.regenerate}</button><DocumentHistory id={editing.draft.id} onRestore={busy||editing.draft.issuedDocumentId||editing.draft.archivedAt?null:(content,variables,date)=>{editing.setContent(content);editing.setVariables(variables);editing.setDate(date);}}/></div></details><Bouton rang="principal" taille="compact" disabled={busy||!manifest||!preview?.readiness.canIssue||editing.dirty||Boolean(editing.draft.issuedDocumentId)||Boolean(editing.draft.archivedAt)} onClick={()=>{setView("preview");setConfirm(true);}}>{t.issueForPrint}</Bouton></div></header>
     {!editing.draft.issuedDocumentId&&!editing.draft.archivedAt?<div className="doc2-compose" inert={busy}><aside className="doc2-fields">{editing.draft.kind==="ordonnance"?<MedicationRows content={editing.draft.content} onChange={editing.setContent}/>:<DocumentFields draft={editing.draft} onChange={editing.setVariables} onDate={editing.setDate} onTreatmentChange={editing.draft.kind==="certificat_medical"?editing.setContentAndVariables:null}/>}</aside><section className="doc2-paper-area"><div className="doc2-compose-bar">{editing.draft.kind!=="ordonnance"?<div className="doc2-view-switch"><button type="button" aria-pressed={view==="preview"} onClick={()=>{setView("preview");if(!preview)void prepare();}}>{t.preview}</button><button type="button" aria-pressed={view==="edit"} onClick={()=>setView("edit")}>{t.edit}</button></div>:<span className="doc2-eyebrow">{t.prescription}</span>}{manifest!==null?<span className="doc2-page-count">{manifest.pages.length} {t.page.toLowerCase()}</span>:null}</div>
      {editing.draft.kind!=="ordonnance"?<div className={view==="edit"?undefined:"doc2-offscreen"}><DocumentEditor key={editing.draft.id} invalid={editing.invalidContent} headerHtml={headerHtml} fieldValues={{...fieldValues,...Object.fromEntries(Object.entries(editing.draft.variables).filter(([key])=>key!=="jours_lettres").map(([key,value])=>["vars_"+key,value]))}} content={editing.draft.content} onChange={editing.setContent} onError={editing.rejectContent}/></div>:null}
      <div className={view==="preview"||editing.draft.kind==="ordonnance"?undefined:"doc2-offscreen"}>{editing.dirty?<p className="doc2-hint" role="status">{t.previewStale}</p>:null}{preview?<DocumentPreview preview={preview} onLayout={setManifest}/>:<p className="doc2-hint">{editing.dirty?t.previewStale:t.previewLoading}</p>}</div></section></div>:null}
     {editing.state.conflict?<div className="doc2-alert" role="alert"><Icone nom="alerte" taille={20}/><p>{t.recoveryConfirm}</p><button type="button" onClick={()=>{void editing.recover(false);}}>{t.reload}</button><button type="button" onClick={()=>{void editing.recover(true);}}>{t.keepLocal}</button></div>:null}
     {preview?.readiness.reasons.length?<div className="doc2-readiness">{preview.readiness.reasons.map(reason=><p key={reason}><Icone nom="alerte" taille={16}/>{documentReasons[reason]}</p>)}</div>:null}
    </>:null}

    {opened?<>
     <header className="doc2-document-head"><div className="doc2-document-title"><div className="doc2-title-line"><h2>{documentLabels[opened.docType]}</h2><Badge ton={opened.status==="voided"?"attention":"positif"}>{opened.status==="voided"?t.voided:t.issuedStatus}</Badge></div><small className="doc2-number-note">{t.issuedNumber} · <strong>{opened.docNumber}</strong></small>{opened.voidReason?<small className="doc2-hint is-warning">{opened.voidReason}</small>:null}</div><div className="doc2-actions"><details className="doc2-action-menu"><summary>{t.more}<Icone nom="chevron" taille={16}/></summary><div><button type="button" disabled={busy} onClick={()=>{void duplicate();}}>{t.newRevision}</button><button type="button" disabled={busy||opened.status==="voided"} onClick={()=>setShowVoid(true)}>{t.voidDocument}</button></div></details><Bouton rang="principal" taille="compact" disabled={busy||opened.status==="voided"} onClick={()=>{void print();}}>{t.print}</Bouton></div></header>
     {auditPending===opened.id?<div className="doc2-alert" role="alert"><Icone nom="alerte" taille={20}/><p>{t.printAuditFailed}</p><button type="button" onClick={()=>{void markDocumentPrinted(opened.id).then(r=>{if(r.ok){setAuditPending(null);setError(null);void openDocument(opened.id);}else setError(t.printAuditFailed);});}}>{t.auditRetry}</button></div>:null}
     {!snapshot?<p className="doc2-legacy-note">{t.legacyRevisionNotice}</p>:null}
     <div className="doc2-paper-area"><div className="doc2-preview-toolbar doc2-issued-toolbar"><span className="doc2-preview-label">{t.preview}</span><div className="doc2-zoom" role="group" aria-label={t.zoom}>{ISSUED_ZOOMS.map(value=><button type="button" key={value} aria-pressed={issuedZoom===value} onClick={()=>{issuedManualZoom.current=true;setIssuedZoom(value);}}>{value} %</button>)}</div></div><div className="doc2-preview doc2-issued-preview"><div className="doc2-preview-sheet" style={{zoom:issuedZoom/100}} dangerouslySetInnerHTML={{__html:snapshot?.html??'<article class="doc2-page doc2-legacy doc-feuille doc-corps">'+(opened.renderedHtml??"")+'</article>'}}/></div></div>
     <details className="doc2-print-help"><summary>{t.print}</summary><p>{t.printInstructions}</p></details>
    </>:null}

    {!opened&&!draftId?<div className="doc2-empty"><span className="doc2-empty-icon"><Icone nom="documents" taille={24}/></span><h2>{patientId?t.newDocument:t.choosePatient}</h2><p>{patientId?t.startHint:t.choosePatientHint}</p>{patientId?<Bouton rang="principal" taille="compact" disabled={busy} onClick={()=>{void newDocument();}}><Icone nom="plus" taille={16}/>{t.newDocument}</Bouton>:null}</div>:null}
   </main>
  </div>

  {regenerate?<DocumentDialog title={t.regenerate} onDismiss={()=>setRegenerate(false)}><p>{t.regenerateConfirmation}</p><div className="doc2-dialog-actions"><button className="doc2-secondary" type="button" autoFocus onClick={()=>setRegenerate(false)}>{t.close}</button><button className="doc2-primary" type="button" onClick={()=>{setRegenerate(false);void newDocument();}}>{t.regenerate}</button></div></DocumentDialog>:null}

  {confirm?<DocumentDialog title={t.confirmIssue} busy={busy} onDismiss={()=>setConfirm(false)}><p>{t.confirmBody}</p><p className="doc2-dialog-hint">{t.printAfterIssue}</p><div className="doc2-dialog-actions"><button className="doc2-secondary" type="button" autoFocus disabled={busy} onClick={()=>setConfirm(false)}>{t.close}</button><button className="doc2-primary" type="button" disabled={busy} onClick={()=>{void issue();}}>{busy?t.issuing:t.confirmIssue}</button></div></DocumentDialog>:null}

  {showVoid?<DocumentDialog title={t.voidDocument} busy={busy} onDismiss={()=>setShowVoid(false)}><p>{t.voidConfirmation}</p><label>{t.voidReason}<textarea value={voidReason} onChange={e=>setVoidReason(e.target.value)}/></label><div className="doc2-dialog-actions"><button className="doc2-secondary" type="button" autoFocus disabled={busy} onClick={()=>setShowVoid(false)}>{t.close}</button><button className="doc2-primary" type="button" disabled={!voidReason.trim()||busy} onClick={()=>{void(async()=>{if(!opened)return;setBusy(true);const r=await voidDocument(opened.id,voidReason);setBusy(false);if(r.ok){setShowVoid(false);await openDocument(opened.id);await refresh();}else setError(r.error.message);})();}}>{t.voidDocument}</button></div></DocumentDialog>:null}
 </div>;
}
