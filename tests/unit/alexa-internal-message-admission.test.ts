import {describe,expect,it} from "vitest";
import {frenchReadArgumentBindings,frenchRequestAdmission} from "@/shared/alexa/request-contract";

describe("admission du message interne Alexa",()=>{
 it("reconnaît une demande de message à la secrétaire comme une proposition",()=>{
  const admission=frenchRequestAdmission("Envoie un message à la secrétaire pour lui dire que le patient est arrivé.",false);
  expect(admission.tools).toEqual(["prepare_action"]);
  expect(admission.preparationAction).toBe("send_internal_message");
  expect(frenchReadArgumentBindings(admission,"prepare_action")).toEqual({action:"send_internal_message"});
 });

 it("ne confond pas un message patient avec le canal interne",()=>{
  const admission=frenchRequestAdmission("Prépare un message de rappel de rendez-vous pour ce patient.",false);
  expect(admission.applicationView).toBe("message_draft");
  expect(admission.preparationAction).toBeUndefined();
 });

 it("reconnaît une ordonnance comme document préparable",()=>{
  const admission=frenchRequestAdmission("Prépare une ordonnance pour ce patient.",false);
  expect(admission.tools).toEqual(["prepare_action"]);
  expect(admission.preparationAction).toBe("create_editable_document_draft");
  expect(admission.preparationDocumentType).toBe("ordonnance");
 });
});
