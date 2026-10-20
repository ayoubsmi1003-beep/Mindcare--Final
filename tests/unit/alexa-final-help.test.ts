import { it, expect } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
it.each([
  ["Comment signer une consultation ?", "app_help", "sign_consultation"],
  ["Comment modifier le tarif d’une séance ?", "app_help", "change_tariff"],
  ["Quelle heure est-il à Alger ?", "clock", undefined],
])("safe server shortcut: %s",(text,intent,topic)=>{
  expect(planRequest(text,null)).toMatchObject({intent});
  if(topic)expect(planRequest(text,null).helpTopic).toBe(topic);
});
it("an explanation of a signing control cannot become an action",()=>{
  expect(planRequest("Explique le bouton Signer la note",null).intent).toBe("app_help");
  expect(planRequest("Signe cette note",null).intent).toBe("proposal");
});
it.each([["Combien de patients sans téléphone ?","missing_phone","count"],["Liste les patients sans carte d’identité","missing_identity_card","list"],["شحال من مريض بلا نوميرو","missing_phone","count"],["Combien de patients sans email","missing_email","count"]])("a bounded local search preserves the requested shape: %s",(text,patientFilter,outputShape)=>{
 expect(planRequest(text,null)).toMatchObject({intent:"patient_search",patientFilter,outputShape});
});
