import {describe,it,expect} from "vitest";
import {runInNewContext} from "node:vm";
import {extensionMarkerScript} from "@/shared/hydration/extension-marker";
describe("extension marker compatibility before hydration",()=>{
 it("removes only the injected marker, including later DOM additions",()=>{
 const attrs=new Map([["bis_skin_checked","1"],["bis_register","extension-value"],["data-patient-id","keep"],["dir","rtl"]]);
 const element={nodeType:1,removeAttribute:(name:string)=>attrs.delete(name),querySelectorAll:()=>[]};
 let callback:((records:Array<{type:string;target:typeof element;addedNodes:typeof element[]}>)=>void)|undefined;
 let options:unknown;
 class Observer{constructor(fn:typeof callback){callback=fn;}observe(_root:unknown,value:unknown){options=value;}}
 runInNewContext(extensionMarkerScript,{document:{documentElement:{},querySelectorAll:()=>[element]},MutationObserver:Observer});
 expect(attrs.has("bis_skin_checked")).toBe(false);expect(attrs.has("bis_register")).toBe(false);expect(attrs.get("data-patient-id")).toBe("keep");expect(attrs.get("dir")).toBe("rtl");
 attrs.set("bis_register","extension-value");callback!([{type:"attributes",target:element,addedNodes:[]}]);expect(attrs.has("bis_register")).toBe(false);
 attrs.set("bis_skin_checked","1");callback!([{type:"childList",target:element,addedNodes:[element]}]);expect(attrs.has("bis_skin_checked")).toBe(false);
 expect(options).toMatchObject({attributeFilter:["bis_skin_checked", "bis_register"],subtree:true});
 });
});
