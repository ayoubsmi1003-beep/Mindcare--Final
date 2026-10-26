import {z} from "zod";
import {parseDocumentContent} from "@/shared/documents/content";
import type {DocumentContent,DocumentNode,Variables} from "@/shared/documents/types";

const fieldChanges=z.record(z.string().max(80),z.string().trim().min(1).max(4000)).refine(changes=>Object.keys(changes).length>0,"DraftFieldsRequired");

/** Apply only existing variable fields; all non-target document nodes are preserved. */
export function mergeDraftVariableChanges(
 draft:{readonly content:DocumentContent;readonly variables:Variables},
 rawChanges:unknown,
):{readonly content:DocumentContent;readonly variables:Variables}{
 const changes=fieldChanges.parse(rawChanges);
 if(Object.keys(changes).some(key=>!Object.hasOwn(draft.variables,key)))throw new Error("UnknownDraftField");
 const visit=(node:DocumentNode):DocumentNode=>{
  if(node.type==="field"){
   const name=String(node.attrs?.["name"]??"");
   if(Object.hasOwn(changes,name))return {...node,attrs:{...node.attrs,value:changes[name]!}};
  }
  return node.content?{...node,content:node.content.map(visit)}:node;
 };
 const content=parseDocumentContent({...draft.content,content:draft.content.content.map(visit)});
 return {content,variables:{...draft.variables,...changes}};
}
