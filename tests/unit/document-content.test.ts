import { describe, it, expect } from "vitest";
import { parseDocumentContent, resolveFields } from "@/shared/documents/content";
const paragraph = (text: string) => ({type:"paragraph", content:[{type:"text", text}]});
const doc = (...content: unknown[]) => ({type:"doc", content});
describe("clinical document closed content", () => {
  it("preserves French Arabic and astral Unicode with formatting", () => {
    const input = doc({type:"paragraph", attrs:{textAlign:"right",dir:"rtl"}, content:[{type:"text",text:"Été — العربية 🧠",marks:[{type:"bold"},{type:"underline"}]}]});
    expect(parseDocumentContent(input)).toEqual(input);
  });
  it.each(["script","link","image","iframe","video"])("rejects resource or executable node %s", type => {
    expect(() => parseDocumentContent(doc({type,attrs:{src:"https://invalid.example"}}))).toThrow();
  });
  it.each([{style:"color:red"},{color:"green"},{dir:"evil"},{textAlign:"inherit"},{src:"https://invalid.example"}])("rejects unapproved paragraph attributes %o", attrs => {
    expect(() => parseDocumentContent(doc({type:"paragraph",attrs,content:[]}))).toThrow();
  });
  it("rejects URLs and unknown attributes in marks", () => {
    expect(() => parseDocumentContent(doc({type:"paragraph",content:[{type:"text",text:"x",marks:[{type:"bold",attrs:{href:"https://invalid.example"}}]}]}))).toThrow();
  });
  it("accepts basic lists and explicit page break", () => {
    const input=doc({type:"orderedList",attrs:{start:2},content:[{type:"listItem",content:[paragraph("Texte")]}]},{type:"pageBreak"});
    expect(parseDocumentContent(input)).toEqual(input);
  });
  it("limits UTF8 bytes without truncating Arabic", () => {
    expect(() => parseDocumentContent(doc(paragraph("ع".repeat(110000))))).toThrow();
  });
  it("limits blocks and nesting", () => {
    expect(() => parseDocumentContent(doc(...Array.from({length:501},()=>paragraph("x"))))).toThrow();
    let nested:unknown=paragraph("x");
    for(let i=0;i<13;i++)nested={type:"bulletList",content:[{type:"listItem",content:[nested]}]};
    expect(() => parseDocumentContent(doc(nested))).toThrow();
  });
  it("rejects invalid child structure and document keys", () => {
    expect(() => parseDocumentContent({type:"doc",content:[{type:"text",text:"x"}]})).toThrow();
    expect(() => parseDocumentContent({...doc(paragraph("x")),html:"<script/>"})).toThrow();
  });
  it("updates bound fields without rewriting manual text", () => {
    const input=parseDocumentContent(doc({type:"paragraph",content:[{type:"text",text:"Mot choisi : "},{type:"field",attrs:{name:"nom",value:"Ancien"}},{type:"text",text:". Ancien manuel."}]}));
    expect(resolveFields(input,{nom:"Nouveau"})).toEqual(doc({type:"paragraph",content:[{type:"text",text:"Mot choisi : "},{type:"field",attrs:{name:"nom",value:"Nouveau"}},{type:"text",text:". Ancien manuel."}]}));
    expect(input.content[0]).toEqual({type:"paragraph",content:[{type:"text",text:"Mot choisi : "},{type:"field",attrs:{name:"nom",value:"Ancien"}},{type:"text",text:". Ancien manuel."}]});
  });
});
