import { describe,it,expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const enabled=process.env["MINDCARE_DOCUMENTS_CHECKPOINT"]==="1";
describe.skipIf(!enabled)("document drafts on isolated PostgreSQL",()=>{
  it("persists exact revisions, rejects unsafe content and isolates every clinical role",()=>{
    execFileSync("docker",["cp",resolve("scripts/checkpoint-document-editor.sql"),"mc-p3:/tmp/checkpoint-document-editor.sql"]);
    const result=execFileSync("docker",["exec","mc-p3","psql","-U","postgres","-d","mindcare_documents_test_20261007","-q","-f","/tmp/checkpoint-document-editor.sql"],{encoding:"utf8"});
    expect(result).toContain("DOCUMENT DRAFT CHECKPOINT PASS");
  });
});
