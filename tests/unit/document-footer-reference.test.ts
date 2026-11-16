import {readFileSync} from "node:fs";
import {expect,it} from "vitest";

it("uses the approved public footer reference in the forward migration",()=>{
 const reference=JSON.parse(readFileSync("resources/documents/cabinet-letterhead.json","utf8"));
 const migration=readFileSync("supabase/migrations/226_document_print_corrections.sql","utf8");
 const footer=JSON.parse(migration.split("$reference$")[1]!);
 expect(footer).toEqual({address:reference.cabinet.address,...reference.practitioner.document_footer});
});
