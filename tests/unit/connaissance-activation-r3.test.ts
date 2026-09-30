/**
 * R3 — Acte gouverne d'activation du corpus (quarantaine -> actif).
 * TDD RED : echoue tant que le module d'activation n'existe pas.
 * Invariants : transaction, approbateur reel, autorisation explicite,
 *eligibilite stricte, audit, idempotence, echec ferme.
 */
import { describe, expect, it } from "vitest";

import {
  sqlActiverChunks,
  sqlActiverSource,
  sqlAuditActivation,
  sqlVerifierApprobateur,
  sqlVerifierSource,
} from "../../scripts/activer-connaissance.mjs";

describe("R3 activation : SQL gouverne", () => {
  it("source : n'active que reviewed/C4/hash exact, ecrit approved_* + reviewed_*", () => {
    const sql = sqlActiverSource();
    expect(sql).toContain("SET statut = 'active'");
    expect(sql).toContain("approved_at = now()");
    expect(sql).toContain("approved_by = $2");
    expect(sql).toContain("WHERE id = $1");
    expect(sql).toContain("AND statut = 'reviewed'");
    expect(sql).toContain("AND classification = 'C4'");
    expect(sql).toContain("AND contenu_hash = $3");
    expect(sql).toContain("AND approved_at IS NULL");
    expect(sql).toContain("RETURNING id");
  });
  it("chunks : n'active que l'inactif verifie, jamais de patient, jamais de vide", () => {
    const sql = sqlActiverChunks();
    expect(sql).toContain("SET statut = 'active'");
    expect(sql).toContain("AND statut = 'inactive'");
    expect(sql).toContain("AND NULLIF(btrim(texte), '') IS NOT NULL");
    expect(sql).toContain("RETURNING id");
  });
  it("audit : une ligne par source, acteur reel, avant/apres", () => {
    const sql = sqlAuditActivation();
    expect(sql).toContain("INSERT INTO audit.log");
    expect(sql).toContain("actor_id");
    expect(sql).toContain("new_values");
  });
  it("approbateur : doit exister, actif, jamais invente", () => {
    const sql = sqlVerifierApprobateur();
    expect(sql).toContain("FROM app.profiles");
    expect(sql).toContain("is_active");
  });
  it("verif source : hash, statut, approbation, remplacement, chunks", () => {
    const sql = sqlVerifierSource();
    expect(sql).toContain("contenu_hash");
    expect(sql).toContain("superseded_by");
  });
});
