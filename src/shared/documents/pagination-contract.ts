import type {DocumentContent,DocumentNode,PageManifest} from "./types";
import {nodeText} from "./content";
export function codepointSlice(text:string,from:number,to:number){return Array.from(text).slice(Math.max(0,from),Math.max(0,to)).join("");}
export function validatePageManifest(content:DocumentContent,manifest:PageManifest,preview?:{contentHash:string;rendererVersion:string}):void{
 if(preview&&(preview.contentHash!==manifest.contentHash||preview.rendererVersion!==manifest.rendererVersion))throw new Error("DocumentLayoutStale");
 if(manifest.pages.length<1||manifest.pages.length>100)throw new Error("DocumentPageLimit");
 let block=0,offset=0;
 for(const page of manifest.pages){if(!page.length)throw new Error("DocumentBlankPage");for(const slice of page){
 const node=content.content[block],len=node?Array.from(nodeText(node)).length:-1;
 if(slice.path.length!==1||slice.path[0]!==block||slice.from!==offset||!Number.isInteger(slice.to)||slice.to<offset||slice.to>len||(slice.to===offset&&len>0))throw new Error("DocumentCoverageInvalid");
 if(slice.to===len){block++;offset=0;}else offset=slice.to;
 }}
 if(block!==content.content.length||offset!==0)throw new Error("DocumentCoverageIncomplete");
}

export function orderedListStart(node:DocumentNode,from:number):number {
 let offset=0,skipped=0;
 for(const child of node.content??[]){const length=Array.from(nodeText(child)).length;if(offset+length<=from)skipped++;else break;offset+=length;}
 return Number(node.attrs?.["start"]??1)+skipped;
}
