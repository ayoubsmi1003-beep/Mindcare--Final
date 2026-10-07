"use client";
import {useState} from "react";
import {z} from "zod";
import {listDraftRevisions} from "@/services/document-drafts";
import {parseDocumentContent} from "@/shared/documents/content";
import {documentsEditor as t} from "@/i18n/documents-editor";
import type {DocumentContent,Variables} from "@/shared/documents/types";
const revision=z.object({revision:z.number().int().positive(),content:z.unknown().transform(parseDocumentContent),variables:z.record(z.string(),z.string()),documentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),savedAt:z.string()});
export function DocumentHistory({id,onRestore}:{readonly id:string;readonly onRestore:((content:DocumentContent,variables:Variables,date:string)=>void)|null}){
 const [rows,setRows]=useState<readonly z.infer<typeof revision>[]>([]),[error,setError]=useState<string|null>(null);
 return <details onToggle={e=>{if(!e.currentTarget.open)return;void listDraftRevisions(id).then(r=>{if(!r.ok)setError(r.error.message);else {const parsed=z.array(revision).safeParse(r.data);if(parsed.success)setRows(parsed.data);else setError(t.saveFailure);}});}}><summary>{t.history}</summary>{error?<p role="alert">{error}</p>:null}{rows.map(row=><div key={row.revision}>{t.revision} {row.revision} · {row.savedAt}{onRestore?<button type="button" onClick={()=>onRestore(row.content,row.variables,row.documentDate)}>{t.restore}</button>:null}</div>)}</details>;
}
