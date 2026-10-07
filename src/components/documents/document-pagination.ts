import type {DocumentNode,DraftPreview,PageManifest,PageSlice} from "@/shared/documents/types";
import {nodeText} from "@/shared/documents/content";
import {codepointSlice,validatePageManifest,orderedListStart} from "@/shared/documents/pagination-contract";
function sliceNode(node:DocumentNode,from=0,to=Number.MAX_SAFE_INTEGER):Node|null{
 const length=Array.from(nodeText(node)).length;
 if(length>0&&(to<=0||from>=length))return null;
 if(node.type==="text"||node.type==="field"){let result:Node=document.createTextNode(codepointSlice(nodeText(node),from,to));for(const mark of node.marks??[]){const wrapper=document.createElement(mark.type==="bold"?"strong":mark.type==="italic"?"em":"u");wrapper.append(result);result=wrapper;}if(node.type==="field"){const span=document.createElement("span");span.dataset.field=String(node.attrs?.["name"]);span.append(result);result=span;}return result;}
 if(node.type==="hardBreak")return document.createElement("br");
 if(node.type==="pageBreak")return null;
 const element=document.createElement(node.type==="paragraph"?"p":node.type==="bulletList"?"ul":node.type==="orderedList"?"ol":node.type==="listItem"?"li":"div");
 if(node.type==="paragraph"){element.dir=String(node.attrs?.["dir"]??"auto");element.style.textAlign=String(node.attrs?.["textAlign"]??"justify");}
 if(node.type==="medication"){element.className="doc2-medication";const lines=codepointSlice(nodeText(node),from,to).split("\n");lines.forEach((line,i)=>{if(i)element.append(document.createElement("br"));element.append(document.createTextNode(line));});return element;}
 let offset=0;
 for(const child of node.content??[]){const len=Array.from(nodeText(child)).length;const rendered=len===0&&(offset<from||offset>to)?null:sliceNode(child,from-offset,to-offset);if(rendered)element.append(rendered);offset+=len;}
 if(node.type==="orderedList")element.setAttribute("start",String(orderedListStart(node,from)));
 if(node.type==="listItem"&&!element.textContent?.trim())return null;
 if(node.type==="paragraph"&&!element.childNodes.length)element.append(document.createElement("br"));
 return element;
}
function previewParts(preview:DraftPreview){const parsed=new DOMParser().parseFromString(preview.html,"text/html");return {header:parsed.querySelector(".doc2-header")?.outerHTML??parsed.querySelector("header")?.outerHTML??"",title:parsed.querySelector("h1")?.outerHTML??"",titleText:parsed.querySelector("h1")?.textContent??"",patient:Array.from(parsed.querySelectorAll(".doc2-patient p")).slice(1,3).map(p=>(p.textContent??"").split(":").slice(1).join(":").trim()).join(" ")};}
export function buildDocumentPages(preview:DraftPreview,manifest:PageManifest):string{
 validatePageManifest(preview.content,manifest,preview);const parts=previewParts(preview);const root=document.createElement("div");
 manifest.pages.forEach((slices,index)=>{const page=document.createElement("article");page.className="doc2-page";
 if(index===0)page.innerHTML=parts.header+parts.title;else {const continuation=document.createElement("div");continuation.className="doc2-continuation";continuation.textContent=parts.titleText+" · "+parts.patient;page.append(continuation);}
 const body=document.createElement("main");body.className="doc2-body";for(const slice of slices){const node=preview.content.content[slice.path[0]!];if(node){const fragment=sliceNode(node,slice.from,slice.to);if(fragment)body.append(fragment);}}page.append(body);
 if(index===manifest.pages.length-1){const signature=document.createElement("footer");signature.className="doc2-signature";signature.textContent="Signature et cachet";page.append(signature);}
 const number=document.createElement("div");number.className="doc2-page-number";number.textContent=(index+1)+" / "+manifest.pages.length;page.append(number);root.append(page);});
 return root.innerHTML;
}
export async function documentAssetsReady(doc:Document):Promise<void>{
 let link=doc.querySelector<HTMLLinkElement>('link[data-document-assets]');
 if(!link){link=doc.createElement("link");link.rel="stylesheet";link.href="/documents/v1/document.css";link.dataset.documentAssets="true";doc.head.append(link);}
 if(!link.sheet)await new Promise<void>((resolve,reject)=>{link.addEventListener("load",()=>resolve(),{once:true});link.addEventListener("error",()=>reject(new Error("DocumentStylesMissing")),{once:true});});
 await Promise.all([doc.fonts.load('400 10.5pt "DocumentSans"',"Texte عربي"),doc.fonts.load('600 10.5pt "DocumentSans"',"Texte عربي")]);await doc.fonts.ready;
 if(!doc.fonts.check('400 10.5pt "DocumentSans"',"Texte عربي"))throw new Error("DocumentFontsMissing");
}
export async function paginateDocument(root:HTMLElement,preview:DraftPreview):Promise<PageManifest>{
 await documentAssetsReady(root.ownerDocument);
 const measure=document.createElement("article");measure.className="doc2-page doc2-measure";measure.setAttribute("aria-hidden","true");root.append(measure);
 const parts=previewParts(preview),pages:PageSlice[][]=[[]];let pageIndex=0;
 const setup=()=>{measure.innerHTML=pageIndex===0?parts.header+parts.title:'<div class="doc2-continuation"></div>';const body=document.createElement("main");body.className="doc2-body";measure.append(body);return body;};
 let body=setup();
 const fits=(fragment:Node|null)=>{if(fragment)body.append(fragment);const bottom=body.getBoundingClientRect().bottom;const allowed=measure.getBoundingClientRect().bottom-24*96/25.4;const fit=bottom<=allowed+0.1;if(fragment)fragment.parentNode?.removeChild(fragment);return fit;};
 const next=()=>{if(!pages[pageIndex]!.length)throw new Error("DocumentBlockCannotFit");pages.push([]);pageIndex++;if(pageIndex>=100)throw new Error("DocumentPageLimit");body=setup();};
 try{for(let index=0;index<preview.content.content.length;index++){const node=preview.content.content[index]!,len=Array.from(nodeText(node)).length;let from=0;
 if(node.type==="pageBreak"){pages[pageIndex]!.push({path:[index],from:0,to:0});if(index<preview.content.content.length-1&&pages[pageIndex]!.length>1)next();continue;}
 do{let to=len;if(!fits(sliceNode(node,from,len))){let lo=from,hi=len;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(fits(sliceNode(node,from,mid)))lo=mid;else hi=mid-1;}to=lo;
 if(to===from){next();continue;}
 // Prefer a word boundary while still allowing an oversized unbroken word to wrap.
 const chars=Array.from(nodeText(node));let boundary=to;while(boundary>from&&boundary>to-40&&!/\s/u.test(chars[boundary-1]??""))boundary--;if(boundary>from&&boundary>to-40)to=boundary;
 }
 const slice={path:[index],from,to};pages[pageIndex]!.push(slice);const fragment=sliceNode(node,from,to);if(fragment)body.append(fragment);from=to;if(from<len)next();
 }while(from<len);
 }
 const manifest={rendererVersion:preview.rendererVersion,contentHash:preview.contentHash,pages};validatePageManifest(preview.content,manifest,preview);return manifest;
 }finally{measure.remove();}
}
