import type { TypeDocument } from "@/services/documents";
export type DocumentKind = TypeDocument | "ordonnance";
export type Variables = Readonly<Record<string,string>>;
export interface DocumentNode {
  readonly type: "doc" | "paragraph" | "text" | "field" | "hardBreak" | "pageBreak" | "bulletList" | "orderedList" | "listItem" | "medication";
  readonly text?: string;
  readonly attrs?: Readonly<Record<string,string | number | null>>;
  readonly marks?: readonly {readonly type:"bold" | "italic" | "underline"}[];
  readonly content?: readonly DocumentNode[];
}
export interface DocumentContent extends DocumentNode {readonly type:"doc";readonly content:readonly DocumentNode[]}
export type DocumentReason = "patient-sex-missing" | "patient-birth-missing" | "header-incomplete" | "required-field" | "medication-invalid" | "draft-conflict" | "preview-stale" | "layout-invalid";
export interface Draft {
  readonly id:string;readonly patientId:string;readonly kind:DocumentKind;readonly templateId:string;readonly templateVersion:number;
  readonly content:DocumentContent;readonly variables:Variables;readonly revision:number;readonly documentDate:string;readonly rendererVersion:string;
  readonly issuedDocumentId:string|null;readonly archivedAt:string|null;readonly title:string;readonly patientName:string;
}
export interface DraftPreview {
  readonly draftId:string;readonly revision:number;readonly contentHash:string;readonly rendererVersion:string;readonly html:string;
  readonly readiness:{readonly canIssue:boolean;readonly reasons:readonly DocumentReason[]};readonly identityVersion:string;
}
export interface PageSlice {readonly path:readonly number[];readonly from:number;readonly to:number}
export interface PageManifest {readonly rendererVersion:string;readonly contentHash:string;readonly pages:readonly (readonly PageSlice[])[]}
export interface IssuedSnapshot {readonly documentId:string;readonly draftId:string;readonly revision:number;readonly contentHash:string;readonly rendererVersion:string;readonly html:string;readonly manifest:PageManifest;readonly docNumber:string}
