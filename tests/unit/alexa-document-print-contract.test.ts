import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

it("prints a saved draft through one numbered snapshot without a separate issue confirmation",()=>{
 const source=readFileSync(fileURLToPath(new URL("../../src/components/documents/DocumentWorkspace.tsx",import.meta.url)),"utf8");
 expect(source).toContain("const printDraft=async()=>");
 expect(source).toContain("await issueDraft(preview,manifest)");
 expect(source).toContain("await printDocument(issued.data)");
 expect(source).toContain("{t.save}");
 expect(source).toContain("{t.print}");
 expect(source).not.toContain("setConfirm(true)");
 expect(source).not.toContain("{t.issueForPrint}");
 expect(source).not.toContain("issueForPrint");
});

it("records a print only after the user attests that it was printed",()=>{
 const workspace=readFileSync(fileURLToPath(new URL("../../src/components/documents/DocumentWorkspace.tsx",import.meta.url)),"utf8");
 const printer=readFileSync(fileURLToPath(new URL("../../src/components/documents/document-printer.ts",import.meta.url)),"utf8");
 const printDraft=workspace.slice(workspace.indexOf("const printDraft=async()=>"),workspace.indexOf("const duplicate="));
 const printIssued=workspace.slice(workspace.indexOf("const print=useCallback("),workspace.indexOf("const confirmPrinted="));
 expect(printer).toContain("printInvoked:true");
 expect(printDraft).not.toContain("markDocumentPrinted");
 expect(printIssued).not.toContain("markDocumentPrinted");
 expect(workspace).toContain("const confirmPrinted=async()=>");
 expect(workspace).toContain("markDocumentPrinted(id)");
 expect(workspace).toContain("t.confirmPrinted");
 expect(workspace).toContain("t.printNotConfirmed");
});
