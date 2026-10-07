import type { DocumentContent, DocumentNode, Variables } from "./types";
const inline = new Set(["text","field","hardBreak"]);
const blocks = new Set(["paragraph","bulletList","orderedList","medication","pageBreak"]);
const medicationKeys = ["rowId","medicationId","source","designation","strength","posology","quantity","frequency","duration","administration","instructions"];
function record(input:unknown):Record<string,unknown> {
  if(input===null || typeof input!=="object" || Array.isArray(input))throw new Error("DocumentObjectRequired");
  return input as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,allowed:readonly string[]):void {
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw new Error("DocumentAttributeRejected");
}
/** Closed schema. No HTML/URL/style-bearing nodes can enter persistent content. */
export function parseDocumentContent(input:unknown):DocumentContent {
  const encoded=JSON.stringify(input);
  if(encoded===undefined || new TextEncoder().encode(encoded).length>200*1024)throw new Error("DocumentSizeExceeded");
  let count=0,medications=0;
  const walk=(inputNode:unknown,depth:number,parent:string):void=>{
    if(depth>12)throw new Error("DocumentDepthExceeded");
    const node=record(inputNode);
    keys(node,["type","text","attrs","marks","content"]);
    const type=node["type"];
    if(typeof type!=="string")throw new Error("DocumentTypeRequired");
    if(parent==="root" ? type!=="doc" : parent==="doc" ? !blocks.has(type) : parent==="paragraph" ? !inline.has(type) : parent==="bulletList" || parent==="orderedList" ? type!=="listItem" : parent==="listItem" ? !["paragraph","bulletList","orderedList"].includes(type) : true)throw new Error("DocumentStructureRejected");
    if(blocks.has(type) && ++count>500)throw new Error("DocumentBlocksExceeded");
    const attrs=node["attrs"]===undefined?{}:record(node["attrs"]);
    if(type==="paragraph"){
      keys(attrs,["textAlign","dir"]);
      if(attrs["textAlign"]!==undefined && !["left","center","right","justify"].includes(String(attrs["textAlign"])))throw new Error("DocumentAlignmentRejected");
      if(attrs["dir"]!==undefined && !["ltr","rtl","auto"].includes(String(attrs["dir"])))throw new Error("DocumentDirectionRejected");
    }else if(type==="orderedList"){
      keys(attrs,["start"]);
      if(attrs["start"]!==undefined && (!Number.isInteger(attrs["start"]) || Number(attrs["start"])<1 || Number(attrs["start"])>10000))throw new Error("DocumentListRejected");
    }else if(type==="field"){
      keys(attrs,["name","value"]);
      if(typeof attrs["name"]!=="string" || !/^[a-z][a-z0-9_]{0,63}$/.test(attrs["name"]) || typeof attrs["value"]!=="string")throw new Error("DocumentFieldRejected");
    }else if(type==="medication"){
      if(++medications>50)throw new Error("DocumentMedicationsExceeded");
      keys(attrs,medicationKeys);
      for(const key of medicationKeys){
        if(key==="medicationId" && attrs[key]===null)continue;
        if(typeof attrs[key]!=="string" || String(attrs[key]).length>4000)throw new Error("DocumentMedicationRejected");
      }
      if(!["catalogue","free-text"].includes(String(attrs["source"])))throw new Error("DocumentMedicationSourceRejected");
      if(attrs["source"]==="catalogue" && (typeof attrs["medicationId"]!=="string" || !/^[0-9a-f-]{36}$/i.test(attrs["medicationId"])))throw new Error("DocumentMedicationIdRequired");
    }else keys(attrs,[]);
    if(type==="text"){
      if(typeof node["text"]!=="string" || node["text"].length===0)throw new Error("DocumentTextRequired");
      if(node["content"]!==undefined)throw new Error("DocumentTextChildrenRejected");
    }else if(node["text"]!==undefined)throw new Error("DocumentTextRejected");
    if(node["marks"]!==undefined){
      if(type!=="text" || !Array.isArray(node["marks"]) || node["marks"].length>3)throw new Error("DocumentMarksRejected");
      const seen=new Set<string>();
      for(const mark of node["marks"]){const m=record(mark);keys(m,["type"]);const mt=m["type"];if(typeof mt!=="string" || !["bold","italic","underline"].includes(mt) || seen.has(mt))throw new Error("DocumentMarkRejected");seen.add(mt);}
    }
    if(["doc","paragraph","bulletList","orderedList","listItem"].includes(type)){
      const children=node["content"]??[];
      if(!Array.isArray(children))throw new Error("DocumentChildrenRequired");
      for(const child of children)walk(child,depth+1,type);
      if(["bulletList","orderedList","listItem"].includes(type) && children.length===0)throw new Error("DocumentListEmpty");
    }else if(node["content"]!==undefined)throw new Error("DocumentLeafChildrenRejected");
  };
  walk(input,0,"root");
  // Root content is required even for an empty draft, preserving the public type.
  const root=record(input);if(!Array.isArray(root["content"]))throw new Error("DocumentRootContentRequired");
  return input as DocumentContent;
}
export function resolveFields(content:DocumentContent,variables:Variables):DocumentContent {
  const visit=(node:DocumentNode):DocumentNode=>{
    if(node.type==="field"){
      const name=String(node.attrs?.["name"]??"");
      return {...node,attrs:{name,value:variables[name]??String(node.attrs?.["value"]??"")}};
    }
    return node.content?{...node,content:node.content.map(visit)}:node;
  };
  return parseDocumentContent({...content,content:content.content.map(visit)});
}
export function nodeText(node:DocumentNode):string {
  if(node.type==="text")return node.text??"";
  if(node.type==="field")return String(node.attrs?.["value"]??"");
  if(node.type==="hardBreak")return "\n";
  if(node.type==="medication")return ["designation","strength","posology","quantity","frequency","duration","administration","instructions"].map(k=>String(node.attrs?.[k]??"")).filter(Boolean).join("\n");
  return (node.content??[]).map(nodeText).join("");
}
