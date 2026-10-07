import { describe,it,expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
describe.skipIf(process.env["MINDCARE_DOCUMENTS_CHECKPOINT"]!=="1")("ordered list fragment rendering on isolated PostgreSQL",()=>{
 it("does not change list numbering because a later item belongs to another page",()=>{
 execFileSync("docker",["cp",resolve("scripts/checkpoint-document-fragments.sql"),"mc-p3:/tmp/checkpoint-document-fragments.sql"]);
 const output=execFileSync("docker",["exec","mc-p3","psql","-U","postgres","-d","mindcare_documents_test_20261007","-q","-f","/tmp/checkpoint-document-fragments.sql"],{encoding:"utf8"});
 expect(output).toContain("DOCUMENT FRAGMENT CHECKPOINT PASS");
 });
});

