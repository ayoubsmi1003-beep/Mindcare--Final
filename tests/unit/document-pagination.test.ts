import {orderedListStart} from "@/shared/documents/pagination-contract";
import {describe,it,expect} from "vitest";
import {validatePageManifest,codepointSlice} from "@/shared/documents/pagination-contract";
const content={type:"doc" as const,content:[{type:"paragraph" as const,content:[{type:"text" as const,text:"عربي A😀B"}]}]};
const manifest={rendererVersion:"v1",contentHash:"a",pages:[[{path:[0],from:0,to:6}],[{path:[0],from:6,to:8}]]};
describe("Unicode page coverage",()=>{
 it("keeps an inline field when its relative start is negative",()=>{expect(codepointSlice("Médecin spécialiste",-10,999)).toBe("Médecin spécialiste");});
 it("partitions mixed text without losing surrogate pairs",()=>{validatePageManifest(content,manifest);expect(codepointSlice("عربي A😀B",6,8)).toBe("😀B");});
 it("rejects overlap, gaps, another block and incomplete endings",()=>{for(const from of [5,7])expect(()=>validatePageManifest(content,{...manifest,pages:[manifest.pages[0]!,[{path:[0],from,to:8}]]})).toThrow();expect(()=>validatePageManifest(content,{...manifest,pages:[manifest.pages[0]!]})).toThrow();});
 it("requires the preview hash and renderer",()=>{expect(()=>validatePageManifest(content,manifest,{contentHash:"b",rendererVersion:"v1"})).toThrow();});
});

it("ordered list fragments advance only past preceding items",()=>{expect(orderedListStart({type:"orderedList",attrs:{start:4},content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"one"}]}]},{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"two"}]}]},{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"three"}]}]}]},0)).toBe(4);expect(orderedListStart({type:"orderedList",content:[{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"one"}]}]},{type:"listItem",content:[{type:"paragraph",content:[{type:"text",text:"two"}]}]}]},3)).toBe(2);});
