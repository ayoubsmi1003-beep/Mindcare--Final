/**
 * Garde statique migration 112 — kernel Communication.
 * Pas de base requise : vérifie le texte SQL (tables + portes + garde-fous).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/112_communication_kernel.sql", "utf8");

describe("migration 112 communication kernel", () => {
  it("contient les tables canoniques", () => {
    for (const t of [
      "communication_conversations",
      "communication_participants",
      "communication_messages",
      "message_deliveries",
      "message_templates",
      "communication_consents",
      "external_connections",
      "external_message_refs",
      "communication_actions",
      "human_handoffs",
      "communication_automations",
    ]) {
      expect(sql, `table manquante: ${t}`).toContain(t);
    }
  });

  it("contient les portes", () => {
    for (const f of [
      "comm_create_conversation",
      "comm_append_message",
      "comm_transition_message",
      "comm_set_consent",
      "comm_register_delivery",
      "comm_request_handoff",
    ]) {
      expect(sql, `porte manquante: ${f}`).toContain(f);
    }
  });

  it("ne duplique pas les patients et verrouille la RLS", () => {
    expect(sql).toContain("REFERENCES app.patients(id)");
    expect(sql).toContain("FORCE  ROW LEVEL SECURITY");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("schema_migrations");
  });
});

const sql113 = readFileSync("supabase/migrations/113_communication_gates.sql", "utf8");

describe("migration 113 communication gates", () => {
  it("contient les portes templates/connexions/actions/lectures", () => {
    for (const f of [
      "comm_upsert_template",
      "comm_set_connection",
      "comm_connection_status",
      "comm_log_action",
      "comm_confirm_action",
      "comm_list_conversations",
      "comm_list_messages",
      "comm_get_consent",
    ]) {
      expect(sql113, `porte manquante: ${f}`).toContain(f);
    }
  });

  it("la confirmation exige propose et pose confirmed_at", () => {
    expect(sql113).toContain("confirmed_at");
    expect(sql113).toContain("propose");
  });
});

const sql114 = readFileSync("supabase/migrations/114_boundary_purpose_communication.sql", "utf8");

describe("migration 114 purpose communication", () => {
  it("élargit la CHECK aux cinq usages", () => {
    expect(sql114).toContain("'communication'");
    expect(sql114).toContain("boundary_crossings_purpose_check");
  });
});

const sql115 = readFileSync("supabase/migrations/115_communication_webhook.sql", "utf8");

describe("migration 115 webhook", () => {
  it("contient les portes de routage et de déduplication", () => {
    for (const f of [
      "comm_trouver_ou_creer_conversation",
      "comm_ref_existe",
      "comm_ajouter_ref_externe",
      "comm_conversation_routage",
    ]) {
      expect(sql115, `porte manquante: ${f}`).toContain(f);
    }
  });
});

const sql116 = readFileSync("supabase/migrations/116_communication_appariement.sql", "utf8");

describe("migration 116 appariement", () => {
  it("contient les portes de matching, liaison et suivi", () => {
    for (const f of ["comm_matcher_patient", "comm_lier_patient", "comm_suivi_statut"]) {
      expect(sql116, `porte manquante: ${f}`).toContain(f);
    }
  });

  it("ne promet jamais un correspondant unique", () => {
    expect(sql116).toContain("LIMIT 10");
  });
});

const sql117 = readFileSync("supabase/migrations/117_confirmation_reverifiee.sql", "utf8");

describe("migration 117 confirmation revérifiée", () => {
  it("verrouille le créneau avant de confirmer", () => {
    expect(sql117).toContain("confirmer_apres_reverification");
    expect(sql117).toContain("FOR UPDATE");
    expect(sql117).toContain("SECURITY INVOKER");
  });

  it("refuse nommément le créneau pris et les transitions illégales", () => {
    expect(sql117).toContain("occupé");
    expect(sql117).toContain("requested");
  });
});
