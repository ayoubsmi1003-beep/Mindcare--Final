import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {actionArgumentKeys,agentSchemas} from "@/shared/alexa/agent";
import {agentDescriptions,agentMetadataPrompt} from "@/i18n/alexa-agent";
import {frenchRequestAdmission} from "@/shared/alexa/request-contract";
import {nomsDEcriture} from "@/services/jarvis-ecritures";

const patient="Nadia Test";

it("exposes versioned treatment changes and supported fields in the model tool contract",()=>{
 const edit=agentSchemas.prepare_action.safeParse({partIds:["change"],action:"update_treatment",patientName:patient,treatmentName:"Sertraline",changes:{dose:"75 mg",endDate:"2026-10-26"}});
 expect(agentDescriptions.prepare_action).toContain("update_treatment");
 expect(edit.success).toBe(true);
 expect(agentDescriptions.prepare_action).toContain("stop_treatment");
});

it("teaches the model the treatment actions and field names it can prepare",()=>{
 const prompt=agentMetadataPrompt(["prepare_action"]);
 expect(prompt).toContain("update_treatment");
 expect(prompt).toContain("endDate");
 expect(agentDescriptions.prepare_action).toContain("stop_treatment");
});

it("admits only explicit treatment fields for a versioned treatment change",()=>{
 const action=agentSchemas.prepare_action.safeParse({partIds:["change"],action:"update_treatment",patientName:patient,treatmentName:"Sertraline",changes:{dose:"75 mg",frequency:"une fois par jour"}});
 expect(action.success).toBe(true);
 expect(actionArgumentKeys("update_treatment")).toContain("changes");
 expect(agentSchemas.prepare_action.safeParse({partIds:["change"],action:"update_treatment",treatmentName:"Sertraline",changes:{status:"stopped"}}).success).toBe(false);
 expect(agentSchemas.prepare_action.safeParse({partIds:["change"],action:"update_treatment",treatmentName:"Sertraline",changes:{}}).success).toBe(false);
});

it("admits a discontinuation and a field-only edit to an existing draft",()=>{
 expect(agentSchemas.prepare_action.safeParse({partIds:["stop"],action:"stop_treatment",treatmentName:"Sertraline"}).success).toBe(true);
 expect(agentSchemas.prepare_action.safeParse({partIds:["edit"],action:"update_editable_document_draft",draftId:"11111111-1111-4111-8111-111111111111",variables:{motif:"suivi demandé"}}).success).toBe(true);
 expect(agentSchemas.prepare_action.safeParse({partIds:["print"],action:"print_issued_document",documentType:"ordonnance"}).success).toBe(true);
});

it.each([
 ["Modifie le traitement de Nadia Test, passe la dose à 75 mg par jour.","update_treatment"],
 ["Arrête le traitement Sertraline de Nadia Test.","stop_treatment"],
 ["Corrige le brouillon de certificat médical de Nadia Test, remplace le motif par suivi demandé.","update_editable_document_draft"],
 ["Pour Nadia Test, peux-tu modifier la dose de Sertraline à 50 mg par jour ?","update_treatment"],
 ["Peux-tu arrêter la Sertraline de Nadia Test ?","stop_treatment"],
 ["Pour Nadia Test, pourrais-tu corriger le brouillon de certificat médical et remplacer le motif par suivi demandé ?","update_editable_document_draft"],
 ["Alexa, pour Nadia Test, ajuste le traitement Sertraline à 50 mg.","update_treatment"],
 ["Peux-tu fixer un rendez-vous pour Nadia Test demain ?","create_appointment"],
 ["Pour Nadia Test, crée une ordonnance.","create_editable_document_draft"],
 ["Peux-tu imprimer l'ordonnance de Nadia Test ?","print_issued_document"],
])("routes a French write request to the matching model action: %s",(text,action)=>{
 const admission=frenchRequestAdmission(text,false);
 expect(admission).toMatchObject({tools:["prepare_action"],preparationAction:action});
});

it("does not reinterpret a negated treatment change as an action",()=>{
 expect(frenchRequestAdmission("Pour Nadia Test, ne modifie pas la dose de Sertraline.",false)).not.toHaveProperty("preparationAction");
});

it("registers treatment and existing-draft edits without adding a parallel issuance capability",()=>{
 expect(nomsDEcriture()).toEqual(expect.arrayContaining(["update_treatment","stop_treatment","update_editable_document_draft"]));
 expect(nomsDEcriture()).not.toContain("issue_document");
 expect(nomsDEcriture()).not.toContain("print_issued_document");
});

it("extends only the existing action allowlist and domain doors",()=>{
 const migration=readFileSync(fileURLToPath(new URL("../../supabase/migrations/187_alexa_treatment_draft_updates.sql",import.meta.url)),"utf8");
 expect(migration).toContain("'update_treatment'");expect(migration).toContain("'stop_treatment'");expect(migration).toContain("'update_editable_document_draft'");
 expect(migration).toContain("FROM app.update_treatment(");expect(migration).toContain("FROM app.stop_treatment(");expect(migration).toContain("app.save_editable_document_draft(");
 expect(migration).not.toMatch(/\bCREATE\s+TABLE\b|\bADD\s+COLUMN\b|\bCREATE\s+TYPE\b|\bALTER\s+TYPE\b/iu);
});
