import {expect,test} from "vitest";
import {capaciteEcriture} from "@/services/jarvis-ecritures";
test("editable drafts have a distinct confirmed action and keep the legacy request marker",()=>{
 expect(capaciteEcriture("create_document_draft")).not.toBeNull();
 expect(capaciteEcriture("create_editable_document_draft")).not.toBeNull();
 expect(capaciteEcriture("issue_document")).toBeNull();
 expect(capaciteEcriture("sign_note")).toBeNull();
});
