"use client";

import {useEffect,useRef,useState} from "react";

import {Icone,Squelette} from "@/components/ui";
import type {DraftPreview,PageManifest} from "@/shared/documents/types";

import {documentsEditor as t} from "@/i18n/documents-editor";

import {paginateDocument,buildDocumentPages} from "./document-pagination";

const ZOOMS=[65,75,90,100,110,125] as const;
type Zoom=typeof ZOOMS[number];

function fitZoom():Zoom{
 return window.innerHeight<820?65:window.innerHeight<1000?75:100;
}

export function DocumentPreview({preview,onLayout}:{readonly preview:DraftPreview;readonly onLayout:(manifest:PageManifest|null)=>void}){

 const root=useRef<HTMLDivElement>(null),[html,setHtml]=useState(""),[error,setError]=useState(false),[zoom,setZoom]=useState<Zoom>(100);
 const manualZoom=useRef(false);

 useEffect(()=>{const fit=()=>{if(!manualZoom.current)setZoom(fitZoom());};fit();window.addEventListener("resize",fit);return()=>window.removeEventListener("resize",fit);},[]);
 useEffect(()=>{let active=true;setHtml("");setError(false);onLayout(null);if(root.current)void paginateDocument(root.current,preview).then(manifest=>{if(active){setHtml(buildDocumentPages(preview,manifest));onLayout(manifest);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[preview,onLayout]);

 return <div className="doc2-preview-shell">
  <div className="doc2-preview-toolbar">
   <span className="doc2-preview-label">{t.preview}</span>
   <div className="doc2-zoom" role="group" aria-label={t.zoom}>
    {ZOOMS.map(value=><button type="button" key={value} aria-pressed={zoom===value} onClick={()=>{manualZoom.current=true;setZoom(value);}}>{value} %</button>)}
   </div>
  </div>
  <div ref={root} className="doc2-preview">
   {error?<div className="doc2-preview-state" role="alert"><Icone nom="alerte" taille={24}/><p>{t.printFailed}</p></div>:html?<div className="doc2-preview-sheet" style={{zoom:zoom/100}} dangerouslySetInnerHTML={{__html:html}}/>:<div className="doc2-preview-state"><Squelette lignes={5}/><p>{t.previewLoading}</p></div>}
  </div>
 </div>;

}
