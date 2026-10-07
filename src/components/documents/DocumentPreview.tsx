"use client";

import {useEffect,useRef,useState} from "react";

import type {DraftPreview,PageManifest} from "@/shared/documents/types";

import {documentsEditor as t} from "@/i18n/documents-editor";

import {paginateDocument,buildDocumentPages} from "./document-pagination";

export function DocumentPreview({preview,onLayout}:{readonly preview:DraftPreview;readonly onLayout:(manifest:PageManifest|null)=>void}){

 const root=useRef<HTMLDivElement>(null),[html,setHtml]=useState(""),[error,setError]=useState(false),[zoom,setZoom]=useState(100);

 useEffect(()=>{let active=true;setHtml("");setError(false);onLayout(null);if(root.current)void paginateDocument(root.current,preview).then(manifest=>{if(active){setHtml(buildDocumentPages(preview,manifest));onLayout(manifest);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[preview,onLayout]);

 return <div><label>{t.zoom} <select value={zoom} onChange={e=>setZoom(Number(e.target.value))}>{[75,100,125].map(value=><option key={value} value={value}>{value} %</option>)}</select></label><div ref={root} className="doc2-preview">{error?<p role="alert">{t.printFailed}</p>:html?<div style={{zoom:zoom/100}} dangerouslySetInnerHTML={{__html:html}}/>:<p>{t.previewLoading}</p>}</div></div>;

}

