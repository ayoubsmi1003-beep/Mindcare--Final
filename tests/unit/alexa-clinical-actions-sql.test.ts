import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const sql=readFileSync("supabase/migrations/182_alexa_clinical_actions.sql","utf8");

describe("migration 182 — actions cliniques Alexa",()=>{
 it("fait expirer les propositions avant confirmation et exécution",()=>{
  expect(sql).toContain("ADD COLUMN IF NOT EXISTS expires_at timestamptz");
  expect(sql).toContain("now() + interval '15 minutes'");
  expect(sql).toContain("Cette proposition a expiré");
  const confirm=sql.slice(sql.indexOf("FUNCTION app.confirm_jarvis_action"),sql.indexOf("FUNCTION app.execute_jarvis_action"));
  expect(confirm).toContain("v_expires");
  expect(confirm).toContain("now() > v_expires");
 });

 it("ajoute le message interne à l'allowlist et l'exécute par la porte 178",()=>{
  expect(sql).toContain("'send_internal_message'");
  expect(sql).toContain("app.send_internal_message(");
  expect(sql).toContain("v_table := 'internal_messages'");
 });

 it("répare le décalage en construisant les changements attendus par update_appointment",()=>{
  const branch=sql.slice(sql.indexOf("WHEN 'reschedule_appointment'"),sql.indexOf("WHEN 'cancel_appointment'"));
  expect(branch).toContain("nouveau_debut");
  expect(branch).toContain("nouvelle_duree_minutes");
  expect(branch).toContain("app.update_appointment(");
  expect(branch).toContain("jsonb_strip_nulls");
 });

 it("ajoute la clôture de consultation sans signer la note",()=>{
  expect(sql).toContain("'close_consultation'");
  expect(sql).toContain("app.close_consultation(");
  expect(sql).not.toContain("app.sign_note(");
 });

 it("accepte les cinq types de documents et le contenu auto-rempli",()=>{
  expect(sql).toContain("'ordonnance'");
  expect(sql).toContain("app.create_alexa_document_draft(");
  expect(sql).toContain("app.validate_document_content(p_content::jsonb)");
 });
});
