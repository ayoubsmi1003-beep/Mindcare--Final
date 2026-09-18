/**
 * M07 — Gouvernance : seule une source C4 + active + approuvée est récupérable.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * La fonction PURE `estRecuperable`/`motifBlocage` : un seul chemin rend
 * `true`. C'est la défense en profondeur côté TypeScript — l'autorisation
 * réelle est imposée en SQL (portes `stockage.ts`, matrice n°11).
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'application RLS/portes (exigera `MINDCARE_TEST_DATABASE_URL`, sinon
 * NOT RUN), ni la classification M05 elle-même (`jarvis-egress-*` la couvre).
 */
import { describe, expect, it } from "vitest";

import { estRecuperable, motifBlocage } from "../../src/server/knowledge/gouvernance";
import type { AttestationSource } from "../../src/server/knowledge/types";

function attestationValide(): AttestationSource {
  return {
    statut: "active",
    classification: "C4",
    approvedAt: "2026-09-01T10:00:00+01:00",
    approvedBy: "00000000-0000-0000-0000-000000000001",
    revueAJour: true,
    remplaceePar: null,
  };
}

describe("source récupérable uniquement", () => {
  it("C4 + active + approbation complète → récupérable", () => {
    expect(estRecuperable(attestationValide())).toBe(true);
    expect(motifBlocage(attestationValide())).toBeNull();
  });

  it.each(["C1", "C2", "C3", "INCONNU"] as const)(
    "classification %s → bloquée (matrice n°10)",
    (classification) => {
      const source = { ...attestationValide(), classification };
      expect(estRecuperable(source)).toBe(false);
      expect(motifBlocage(source)).toBe("non-c4");
    },
  );

  it.each(["discovered", "classified", "reviewed", "revoked", "inactive", "superseded"] as const)(
    "statut %s → bloqué (matrice n°7/8/9, H1)",
    (statut) => {
      const source = { ...attestationValide(), statut };
      expect(estRecuperable(source)).toBe(false);
      expect(motifBlocage(source)).toBe("non-active");
    },
  );

  it("active + C4 SANS approbation (dates/acteur null) → bloquée (n°9)", () => {
    expect(estRecuperable({ ...attestationValide(), approvedAt: null })).toBe(false);
    expect(estRecuperable({ ...attestationValide(), approvedBy: null })).toBe(false);
    expect(motifBlocage({ ...attestationValide(), approvedAt: null })).toBe("non-approuvee");
  });

  it("approbation vide ou blanche → bloquée (pas d'approbation fabriquée)", () => {
    expect(estRecuperable({ ...attestationValide(), approvedBy: "   " })).toBe(false);
    expect(estRecuperable({ ...attestationValide(), approvedAt: "" })).toBe(false);
  });

  it("ordre des motifs : classification avant statut avant approbation", () => {
    // C1 + revoked + non approuvée → le premier défaut nommé est la classification.
    const source: AttestationSource = {
      statut: "revoked",
      classification: "C1",
      approvedAt: null,
      approvedBy: null,
      revueAJour: true,
      remplaceePar: null,
    };
    expect(motifBlocage(source)).toBe("non-c4");
  });

  it("revue en retard → bloquée même si tout le reste est parfait (H1)", () => {
    const source = { ...attestationValide(), revueAJour: false };
    expect(estRecuperable(source)).toBe(false);
    expect(motifBlocage(source)).toBe("revue-en-retard");
  });

  it("supersédée → bloquée dans le défaut, même active et approuvée (H1)", () => {
    const source = { ...attestationValide(), remplaceePar: "22222222-2222-2222-8222-222222222222" };
    expect(estRecuperable(source)).toBe(false);
    expect(motifBlocage(source)).toBe("supersedee");
  });

  it("C4-looking mais active SANS approbation reste bloquée (n°9, pas de contournement)", () => {
    // Même avec le statut et la classification parfaits, l'absence
    // d'approbation ferme la porte — aucun champ client ne l'ouvre.
    const source: AttestationSource = {
      statut: "active",
      classification: "C4",
      approvedAt: null,
      approvedBy: null,
      revueAJour: true,
      remplaceePar: null,
    };
    expect(estRecuperable(source)).toBe(false);
  });
});
