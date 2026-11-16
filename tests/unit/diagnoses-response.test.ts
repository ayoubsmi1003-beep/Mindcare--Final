import {beforeEach, describe, expect, it, vi} from "vitest";
import {enregistrerDiagnostic, resoudreDiagnostic} from "@/services/diagnoses";

const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/services/db",()=>({db:()=>({rpc})}));
vi.mock("@/services/log",()=>({log:{error:vi.fn()}}));
const row={id:"d9000000-0000-4000-8000-000000000001",code_system:"ICD-10",code:"F41.1",label:"Diagnostic synthétique",is_primary:true,onset_date:null,resolved_at:null,
 cabinet_id:"d1000000-0000-4000-8000-000000000001",practitioner_id:"d1000000-0000-4000-8000-000000000002",patient_id:"d2000000-0000-4000-8000-000000000001",is_synthetic:true,created_at:"2026-11-16T08:00:00Z",updated_at:null};
beforeEach(()=>rpc.mockReset());
describe.each([
 ["record_diagnosis",()=>enregistrerDiagnostic({patientId:row.patient_id,label:row.label})],
 ["resolve_diagnosis",()=>resoudreDiagnostic(row.id)],
] as const)("diagnostic response %s",(_name,call)=>{
 it("accepts the complete SQL row and returns only the clinical view",async()=>{
  rpc.mockResolvedValue({ok:true,data:[row]});
  expect(await call()).toEqual({ok:true,data:{id:row.id,codeSystem:"ICD-10",code:"F41.1",label:row.label,isPrimary:true,onsetDate:null,resolvedAt:null}});
 });
 it("still rejects malformed required fields",async()=>{
  rpc.mockResolvedValue({ok:true,data:[{...row,is_primary:"yes"}]});expect((await call()).ok).toBe(false);
 });
 it("keeps genuine failures and empty scope responses",async()=>{
  const failure={ok:false,error:{code:"indisponible",message:"Indisponible"}};
  rpc.mockResolvedValueOnce(failure).mockResolvedValueOnce({ok:true,data:[]});
  expect(await call()).toEqual(failure);expect(await call()).toEqual({ok:true,data:null});
 });
});
