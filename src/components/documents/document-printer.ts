import type {IssuedSnapshot} from "@/shared/documents/types";
import {documentAssetsReady} from "./document-pagination";
export async function printHtml(html:string):Promise<{dialogOpened:boolean}>{
 const frame=document.createElement("iframe");frame.title="Document";frame.style.position="fixed";frame.style.left="-2000px";frame.style.width="148mm";frame.style.height="210mm";document.body.append(frame);
 try{const doc=frame.contentDocument,win=frame.contentWindow;if(!doc||!win)throw new Error("DocumentPrintUnavailable");
 doc.open();doc.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Document</title></head><body>'+html+'</body></html>');doc.close();
 await documentAssetsReady(doc);await new Promise<void>(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>resolve())));
 win.addEventListener("afterprint",()=>frame.remove(),{once:true});window.addEventListener("pagehide",()=>frame.remove(),{once:true});win.focus();win.print();return {dialogOpened:true};
 }catch(error){frame.remove();throw error;}
}
export function printDocument(snapshot:IssuedSnapshot){return printHtml(snapshot.html);}
export function printLegacyDocument(html:string){if(html.includes("{{"))return Promise.reject(new Error("DocumentUnresolved"));return printHtml('<article class="doc2-page doc2-legacy doc-feuille doc-corps">'+html+'</article>');}
