import { describe,it,expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
describe.skipIf(process.env["MINDCARE_DOCUMENTS_CHECKPOINT"]!=="1")("controlled document identity on isolated PostgreSQL",()=>{
 it("persists only the order number and rejects stale controlled identity",()=>{
 execFileSync("docker",["cp",resolve("scripts/checkpoint-document-header.sql"),"mc-p3:/tmp/checkpoint-document-header.sql"]);
 const output=execFileSync("docker",["exec","mc-p3","psql","-U","postgres","-d","mindcare_documents_test_20261007","-q","-f","/tmp/checkpoint-document-header.sql"],{encoding:"utf8"});
 expect(output).toContain("DOCUMENT HEADER CHECKPOINT PASS");
 });
});

