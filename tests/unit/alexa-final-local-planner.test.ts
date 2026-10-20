import { describe, expect, it } from "vitest";
import { planLocalSemantic } from "@/server/alexa/local-semantic-planner";
import { planRequest } from "@/shared/alexa/request-plan";

const value = { language:"fr",domain:"patient",operation:"search",output:"count",patient:null,field:"phone",query:null,count:20,missing:[] };
describe("local semantic interpretation",()=>{
  it("interprets a private request with local inference only",async()=>{
    let received="";
    const result=await planLocalSemantic("Qui n’a pas renseigné son numéro ?",planRequest("Qui n’a pas renseigné son numéro ?",null),null,new AbortController().signal,
      async text=>{received=text;return value;});
    expect(received).toContain("Qui n’a pas renseigné son numéro");
    expect(result?.plan).toMatchObject({intent:"patient_search",patientFilter:"missing_phone",outputShape:"count"});
  });
  it("does not turn help into a mutation proposal",async()=>{
    const result=await planLocalSemantic("Comment signer cette consultation ?",planRequest("Comment signer cette consultation ?",null),null,new AbortController().signal,
      async()=>({...value,domain:"application",operation:"explain",output:"explanation",field:null,query:"sign_consultation"}));
    expect(result?.plan.intent).toBe("app_help");
  });
  it("a local failure never falls through to cloud semantic inference",async()=>{
    expect(await planLocalSemantic("traitement de Ahmed",planRequest("traitement de Ahmed",null),null,new AbortController().signal,async()=>{throw new Error("private error body");})).toBeNull();
  });
  it("model-generated SQL is rejected",async()=>{
    expect(await planLocalSemantic("patients",planRequest("patients",null),null,new AbortController().signal,async()=>({...value,sql:"SELECT *"}))).toBeNull();
  });
});
