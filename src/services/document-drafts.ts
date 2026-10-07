import { z } from "zod";

import { db } from "./db";

import { ok, err, type Result } from "./result";

import { toAppError } from "./errors";

import { documentsEditor, documentReasons } from "@/i18n/documents-editor";

import { parseDocumentContent } from "@/shared/documents/content";

import type { Draft, DraftPreview, IssuedSnapshot, DocumentContent, DocumentKind, Variables, PageManifest } from "@/shared/documents/types";

const kind=z.enum(["bonne_sante_mentale","suivi_medical","certificat_medical","justification","ordonnance"]);

const reason=z.enum(["patient-sex-missing","patient-birth-missing","header-incomplete","required-field","medication-invalid","draft-conflict","preview-stale","layout-invalid"]);

const content=z.unknown().transform(parseDocumentContent);

const civilDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const hash=z.string().regex(/^[a-f0-9]{64}$/);

const draftSchema=z.object({id:z.string().uuid(),patientId:z.string().uuid(),kind,templateId:z.string().uuid(),templateVersion:z.number().int().positive(),content,variables:z.record(z.string(),z.string()),revision:z.number().int().positive(),documentDate:civilDate,rendererVersion:z.string().min(1),issuedDocumentId:z.string().uuid().nullable(),archivedAt:z.string().nullable(),title:z.string(),patientName:z.string()});

const previewSchema=z.object({draftId:z.string().uuid(),revision:z.number().int().positive(),contentHash:hash,identityVersion:hash,rendererVersion:z.string().min(1),html:z.string(),content,readiness:z.object({canIssue:z.boolean(),reasons:z.array(reason)})});

const manifestSchema=z.object({rendererVersion:z.string().min(1),contentHash:hash,pages:z.array(z.array(z.object({path:z.array(z.number().int().nonnegative()).length(1),from:z.number().int().nonnegative(),to:z.number().int().nonnegative()})).min(1)).min(1).max(100),revision:z.number().int().positive().optional()});

const issuedSchema=z.object({documentId:z.string().uuid(),draftId:z.string().uuid(),revision:z.coerce.number().int().positive(),contentHash:hash,rendererVersion:z.string().min(1),html:z.string(),manifest:manifestSchema,docNumber:z.string().min(1)});

export function parseDraftResponse(value:unknown):Draft{return draftSchema.parse(value);}

export function parsePreviewResponse(value:unknown):DraftPreview{return previewSchema.parse(value);}

export function parseIssuedResponse(value:unknown):IssuedSnapshot{return issuedSchema.parse(value);}

function business(value:unknown){const r=z.object({reason}).safeParse(value);return r.success?{code:"regle-metier" as const,message:documentReasons[r.data.reason],context:r.data.reason}:null;}

async function response<T>(call:Promise<Result<readonly unknown[]>>,parse:(v:unknown)=>T):Promise<Result<T|null>>{

 try{const result=await call;if(!result.ok)return err(result.error);const first=result.data[0];if(first===undefined||first===null)return ok(null);const refusal=business(first);if(refusal)return err(refusal);return ok(parse(first));}

 catch(cause){return err({...toAppError(cause),message:documentsEditor.saveFailure});}

}

async function required<T>(call:Promise<Result<T|null>>):Promise<Result<T>>{const r=await call;return !r.ok?r:r.data===null?err({code:"introuvable",message:documentsEditor.saveFailure}):ok(r.data);}

export function createDraft(patientId:string,type:DocumentKind,variables:Variables):Promise<Result<Draft|null>>{return response(db().rpc<unknown>("create_editable_document_draft",{p_patient_id:patientId,p_type:type,p_variables:JSON.stringify(variables)}),parseDraftResponse);}

export function getDraft(id:string):Promise<Result<Draft|null>>{return response(db().rpc<unknown>("get_editable_document_draft",{p_id:id}),parseDraftResponse);}

export async function listDrafts(patientId:string|null=null,archived=false):Promise<Result<readonly Draft[]>>{

 try{const r=await db().rpc<unknown>("list_editable_document_drafts",{p_patient_id:patientId,p_archived:archived});return r.ok?ok(r.data.map(parseDraftResponse)):err(r.error);}catch(cause){return err(toAppError(cause));}

}

export function saveDraft(draft:Draft,nextContent:DocumentContent,variables:Variables,date:string):Promise<Result<Draft>>{

 try{parseDocumentContent(nextContent);civilDate.parse(date);return required(response(db().rpc<unknown>("save_editable_document_draft",{p_id:draft.id,p_revision:draft.revision,p_content:JSON.stringify(nextContent),p_variables:JSON.stringify(variables),p_date:date}),parseDraftResponse));}

 catch(cause){return Promise.resolve(err({...toAppError(cause),message:documentsEditor.invalidContent}));}

}

export function archiveDraft(id:string,archived=true){return response(db().rpc<unknown>("archive_editable_document_draft",{p_id:id,p_archived:archived}),parseDraftResponse);}

export function duplicateDraft(id:string){return response(db().rpc<unknown>("duplicate_editable_document_draft",{p_id:id}),parseDraftResponse);}

export function previewDraft(id:string,revision:number){return required(response(db().rpc<unknown>("preview_editable_document_draft",{p_id:id,p_revision:revision}),parsePreviewResponse));}

export function issueDraft(preview:DraftPreview,manifest:PageManifest):Promise<Result<IssuedSnapshot>>{try{return required(response(db().rpc<unknown>("issue_editable_document_draft",{p_id:preview.draftId,p_revision:preview.revision,p_content_hash:preview.contentHash,p_identity_version:preview.identityVersion,p_manifest:JSON.stringify(manifestSchema.parse(manifest))}),parseIssuedResponse));}catch(cause){return Promise.resolve(err({...toAppError(cause),message:documentReasons["layout-invalid"]}));}}

export function getSnapshot(id:string){return response(db().rpc<unknown>("get_editable_document_snapshot",{p_id:id}),parseIssuedResponse);}

export async function listDraftRevisions(id:string):Promise<Result<readonly unknown[]>>{return db().rpc<unknown>("list_document_draft_revisions",{p_id:id});}


export function reviseIssuedDocument(id:string){return response(db().rpc<unknown>("revise_issued_document",{p_id:id}),parseDraftResponse);}
