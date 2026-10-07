import { describe,it,expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
describe.skipIf(process.env["MINDCARE_DOCUMENTS_CHECKPOINT"]!=="1")("canonical document issue on isolated PostgreSQL",()=>{
 it("rejects invalid coverage and stale identity, issues once and preserves the immutable hash",()=>{
 execFileSync("docker",["cp",resolve("scripts/checkpoint-document-prescription.sql"),"mc-p3:/tmp/checkpoint-document-prescription.sql"]);
 const output=execFileSync("docker",["exec","mc-p3","psql","-U","postgres","-d","mindcare_documents_test_20261007","-q","-f","/tmp/checkpoint-document-prescription.sql"],{encoding:"utf8"});
 expect(output).toContain("DOCUMENT PRESCRIPTION CHECKPOINT PASS");
 });
});

