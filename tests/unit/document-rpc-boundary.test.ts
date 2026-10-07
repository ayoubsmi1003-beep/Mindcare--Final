import {describe,it,expect} from "vitest";
import {EntreeRpc} from "@/server/db/frontiere";
describe("document RPC payload boundary",()=>{
 it("accepts an editable body above the old 64K scalar cap",()=>{expect(EntreeRpc.safeParse({name:"save_editable_document_draft",args:{p_id:"d3000000-0000-4000-8000-000000000001",p_revision:1,p_content:"a".repeat(100000),p_variables:"{}",p_date:"2026-10-07"}}).success).toBe(true);});
 it("retains the old bound on unrelated RPC values",()=>{expect(EntreeRpc.safeParse({name:"update_patient",args:{p_changes:"a".repeat(100000)}}).success).toBe(false);});
});
