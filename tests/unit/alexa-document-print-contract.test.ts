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
