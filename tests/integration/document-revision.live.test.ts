import { describe,it,expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
describe.skipIf(process.env["MINDCARE_DOCUMENTS_CHECKPOINT"]!=="1")("issued document revision on isolated PostgreSQL",()=>{
 it("creates a linked unnumbered draft while keeping the historical piece",()=>{
 execFileSync("docker",["cp",resolve("scripts/checkpoint-document-revision.sql"),"mc-p3:/tmp/checkpoint-document-revision.sql"]);
 const output=execFileSync("docker",["exec","mc-p3","psql","-U","postgres","-d","mindcare_documents_test_20261007","-q","-f","/tmp/checkpoint-document-revision.sql"],{encoding:"utf8"});
 expect(output).toContain("DOCUMENT REVISION CHECKPOINT PASS");
 });
});

