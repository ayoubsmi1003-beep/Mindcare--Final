import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
import {documentAssetPath} from "@/components/documents/document-renderer";

describe("versioned document assets",()=>{
 it("selects only an explicitly supported immutable asset path",()=>{
  expect(documentAssetPath("v1")).toBe("/documents/v1/document.css");
  expect(documentAssetPath("v2")).toBe("/documents/v2/document.css");
  expect(()=>documentAssetPath("../private")).toThrow();
 });
 it("keeps dynamic field nodes inline without the form layout class",()=>{
  const extension=readFileSync("src/components/documents/document-extensions.ts","utf8");
  expect(extension).toContain('class:"doc2-bound-field"');
  expect(extension).not.toContain('class:"doc2-field"');
 });
 it("reserves the bottom band and keeps the watermark behind editable text",()=>{
  const css=readFileSync("public/documents/v2/document.css","utf8");
  expect(css).toContain('bottom:36mm');
  expect(css).toContain('pointer-events:none');
  expect(css).toContain('size:148mm 210mm');
 });
});

it("keeps the historical v1 ink fallback unchanged when loading shared tokens",()=>{
 const tokens=readFileSync("src/styles/tokens.css","utf8");
 const legacy=readFileSync("public/documents/v1/document.css","utf8");
 expect(tokens.match(/--document-ink:([^;}]+)/u)?.[1]).toBe(legacy.match(/var\(--document-ink,([^)]+)\)/u)?.[1]);
});
