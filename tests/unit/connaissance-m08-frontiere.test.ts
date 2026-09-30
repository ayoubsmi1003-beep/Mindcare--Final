/**
 * M08-C/J/K — frontière du corpus actif, garde patient, frontière d'approbation.
 *
 * Pur/statique : aucune base réelle. La preuve live (portes SQL, corpus
 * actif, garde patient en base) est portée par
 * `scripts/m08-valider-corpus.mjs` (lecture seule) et l'éval golden.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESCRIPTION_OUTILS,
  PROMPT_CONNAISSANCE,
  PROMPT_PATIENT,
} from "../../src/app/api/jarvis/jarvis-chat/prompt";
import { estRecuperable, motifBlocage } from "../../src/server/knowledge/gouvernance";
import type { AttestationSource } from "../../src/server/knowledge/types";
import { chunksDepuisUnitesDSM, filtrerUnitesSures } from "../../scripts/charger-connaissance-corpus-dsm.mjs";

function attestation(surcharge: Partial<AttestationSource> = {}): AttestationSource {
  return {
    statut: "active",
    classification: "C4",
    approvedAt: "2026-09-20T10:00:00+01:00",
    approvedBy: "00000000-0000-0000-0000-0000000000a1",
    revueAJour: true,
    remplaceePar: null,
    ...surcharge,
  };
}

describe("M08-C — seul le corpus actif approuvé est récupérable", () => {
  it("actif + C4 + approuvé + revue à jour → récupérable, sans motif", () => {
    expect(estRecuperable(attestation())).toBe(true);
    expect(motifBlocage(attestation())).toBe(null);
  });

  it.each([
    ["inactive", { statut: "inactive" }, "non-active"],
    ["reviewed sans approbation", { statut: "reviewed", approvedAt: null, approvedBy: null }, "non-active"],
    ["approval NULL", { approvedAt: null, approvedBy: null }, "non-approuvee"],
    ["approbateur NULL seul", { approvedBy: null }, "non-approuvee"],
    ["revoked", { statut: "revoked" }, "non-active"],
    ["superseded", { remplaceePar: "22222222-2222-2222-2222-222222222222" }, "supersedee"],
    ["revue en retard", { revueAJour: false }, "revue-en-retard"],
    ["C1", { classification: "C1" }, "non-c4"],
    ["C3", { classification: "C3" }, "non-c4"],
    ["classified", { statut: "classified", approvedAt: null, approvedBy: null }, "non-active"],
    ["discovered", { statut: "discovered", approvedAt: null, approvedBy: null }, "non-active"],
  ])("%s → exclu (%s)", (_libelle, surcharge, motif) => {
    const a = attestation(surcharge as Partial<AttestationSource>);
    expect(estRecuperable(a)).toBe(false);
    expect(motifBlocage(a)).toBe(motif);
  });
});

describe("M08-C/D — les 5 unités DSM suspectes ne deviennent jamais des chunks", () => {
  const EXCLUES = [
    "dsm5fr-u-1175-N013",
    "dsm5fr-u-152-C027",
    "dsm5fr-u-590-COVER",
    "dsm5fr-u-590-T40001",
    "dsm5fr-u-590-U30184",
  ];

  it("filtrerUnitesSures écarte chaque unité exclue (déclencheur marqueur patient)", () => {    const unites = EXCLUES.map((id, i) => ({
      id,
      title: `titre ${i}`,
      // Déclencheurs réels du mécanisme : marqueur patient du socle.
      evidence_wording: i === 1 ? "étude P12 reprise" : `note touchant Mahmoud ${i}`,
      structural_path: ["Section II"],
      book_id: "dsm5-fr-2015-elsevier",
      printed_page_start: "100",
      page_start: 100 + i,
    }));
    const gardees = filtrerUnitesSures([...unites, { id: "u-saine", evidence_wording: "critères diagnostiques", structural_path: ["Section II"] }]);
    expect(gardees.map((u: { id: string }) => u.id)).toEqual(["u-saine"]);
  });

  it("chunksDepuisUnitesDSM ne projette que du struct-v2 inactif, jamais d'actif", () => {
    const chunks = chunksDepuisUnitesDSM(
      [{ id: "u-x", title: "t", evidence_wording: "w", structural_path: ["S"] }],
      { sourceUuid: "11111111-1111-1111-1111-111111111111", version: "2015-fr", langue: "fr" },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.statut).toBe("inactive");
    expect(chunks[0]?.versionChunk).toBe("struct-v2");
  });

  it("chaque famille de marqueur patient est épurée (téléphone, dossier, identifiant, nom)", () => {
    const unites = [
      { id: "u-tel", evidence_wording: "contact 0612345678 noté", structural_path: ["S"] },
      { id: "u-modele", evidence_wording: "synthèse {{PATIENT.nom}}", structural_path: ["S"] },
      { id: "u-colonne", evidence_wording: "ligne patient_id 42", structural_path: ["S"] },
      { id: "u-dossier", evidence_wording: "voir dossier P123", structural_path: ["S"] },
      { id: "u-saine", evidence_wording: "critères diagnostiques", structural_path: ["S"] },
    ];
    expect(filtrerUnitesSures(unites).map((u: { id: string }) => u.id)).toEqual(["u-saine"]);
  });
});

describe("M08-R5 — les portes ne lisent que les tables knowledge (contamination patient impossible)", () => {
  it("le SQL proposé ne référence aucune table/identifiant patient et garde le filtre d'autorité", async () => {
    const { sqlPorteLexicalePropose, sqlPorteVectoriellePropose, FILTRE_AUTORITE_SQL } = await import(
      "../../src/server/knowledge/stockage"
    );
    const sql = `${sqlPorteLexicalePropose()}\n${sqlPorteVectoriellePropose()}\n${FILTRE_AUTORITE_SQL}`;
    for (const interdit of ["patient", "dossier", "ordonnance", "consultation", "seance", "agenda", "finance"]) {
      expect(sql.toLowerCase()).not.toContain(interdit);
    }
    expect(sql).toContain("knowledge_chunks");
    expect(sql).toContain("knowledge_sources");
    expect(sql).toContain("c.embedding IS NOT NULL");
    expect(sql).toContain("s.classification = 'C4'");
    expect(sql).toContain("c.statut = 'active'");
  });
});

describe("M08-J — le patient ne fuit jamais vers le corpus", () => {
  it("le chemin connaissance ne charge aucune donnée individuelle (prompt verrouillé)", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/ce chemin ne charge aucune\s*donnée individuelle/i);
  });

  it("la route n'appelle la récupération de preuves que dans les deux branches connaissance", () => {
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "jarvis", "jarvis-chat", "route.ts"), "utf8");
    const appels = [...route.matchAll(/recupererPreuves\(/g)].map((m) => m.index ?? -1);
    expect(appels).toHaveLength(2);
    for (const i of appels) {
      const fenetre = route.slice(Math.max(0, i - 1200), i);
      expect(fenetre).toContain('chemin === "connaissance"');
    }
  });
});

describe("M08-K — l'information n'exige rien, l'écriture exige une confirmation", () => {
  it("le chemin connaissance ne contient aucune machinerie de confirmation", () => {
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "jarvis", "jarvis-chat", "route.ts"), "utf8");
    for (const m of route.matchAll(/chemin === "connaissance" && !escaladeChainee\) \{/g)) {
      const branche = route.slice(m.index ?? 0, (m.index ?? 0) + 3500);
      expect(branche).not.toMatch(/confirmation|proposition|lireProposition/i);
    }
  });

  it("les outils d'écriture annoncent la carte de confirmation, le chemin patient la confirmation humaine", () => {
    expect(DESCRIPTION_OUTILS).toMatch(/ÉCRITURE — passera par une carte de confirmation/i);
    expect(PROMPT_PATIENT).toMatch(/soumise à confirmation humaine/i);
  });
});
