import {useState,useRef} from "react";
import {createRoot} from "react-dom/client";
import {DocumentEditor} from "@/components/documents/DocumentEditor";
import {buildDocumentPages,paginateDocument,documentAssetsReady} from "@/components/documents/document-pagination";
import {sanitizeDocumentPaste} from "@/components/documents/document-paste";
import type {DraftPreview,DocumentContent,DocumentNode} from "@/shared/documents/types";
import {parsePreviewResponse} from "@/services/document-drafts";
import "@/styles/tokens.css";

const response=await fetch("/__document_fixture");
const raw:unknown=await response.json();
const preview:DraftPreview=parsePreviewResponse(raw);
function Harness(){
 const [content,setContent]=useState<DocumentContent>(preview.content),latest=useRef(content);latest.current=content;
 const fields:Record<string,string>={};const walk=(n:DocumentNode)=>{if(n.type==="field")fields[String(n.attrs?.["name"])]=String(n.attrs?.["value"]??"");n.content?.forEach(walk);};walk(preview.content);
 Object.assign(window,{documentVisual:{content:()=>latest.current,sanitize:sanitizeDocumentPaste,layout:async(long=false)=>{
  const root=document.getElementById("pages")!;
  const next={...preview,content:long?{type:"doc" as const,content:Array.from({length:24},()=>({type:"paragraph" as const,content:[{type:"text" as const,text:"Paragraphe de contrôle synthétique. ".repeat(8)}]}))}:{...latest.current,content:latest.current.content.slice(0,2)}};
  const manifest=await paginateDocument(root,next);root.innerHTML=buildDocumentPages(next,manifest);await documentAssetsReady(document,"v2");
  return {manifest,pages:Array.from(root.querySelectorAll("article")).map(page=>{
   const rect=(selector:string)=>{const r=page.querySelector(selector)?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null;};
   return {bottom:page.getBoundingClientRect().bottom,body:rect(".doc2-body"),footer:rect(".doc2-letter-footer"),signature:rect(".doc2-signature"),watermark:rect(".doc2-watermark"),number:rect(".doc2-page-number")};
  })};
 }}});
 return <><DocumentEditor rendererVersion="v2" content={content} fieldValues={fields} headerHtml={preview.html.split('<main class="doc2-body">')[0]??""} onChange={setContent} onError={message=>{throw new Error(message);}}/><div id="pages"/></>;
}
await documentAssetsReady(document,"v2");
createRoot(document.getElementById("root")!).render(<Harness/>);
