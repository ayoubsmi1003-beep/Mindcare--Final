/**
 * M08-D2 — admission de l'anglais + Gate-C dry-run Taylor (offline, zéro écriture).
 *
 * Couvre : `en` accepté là où prévu (types + validerLignePorte + dossier),
 * fr/ar/darija inchangés, inconnues rejetées, dossier Taylor en-attente
 * (jamais approuvé), purge patient corroborée, anti-fixture, déterminisme
 * des chunkIds, statut inactif en dur, non-régression R1.
 */
import { describe, expect, it } from "vitest";

import { validerLignePorte } from "../../src/server/knowledge/stockage";
import {
  dryRunTaylor,
  entreeTaylor,
  filtrerUnitesSuresTaylor,
  spanSuspect,
  TAYLOR_BOOK_ID,
  TAYLOR_CHUNKER_PROPOSE,
  TAYLOR_SOURCE_SHA,
} from "../../scripts/charger-connaissance-corpus-taylor.mjs";
import { validerQuarantaine } from "../../scripts/charger-connaissance-socle.mjs";

const RACINE = process.cwd();

/** Ligne de porte récupérable minimale (C4 + active + approuvée + revue à jour). */
function ligne(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chunk_id: "t1",
    source_id: "11111111-1111-1111-1111-111111111111",
    source_titre: "Taylor — Maudsley",
    source_version: `sha256:${TAYLOR_SOURCE_SHA}`,
    section: "Chapter 2",
    version_chunk: TAYLOR_CHUNKER_PROPOSE,
    langue: "en",
    texte: "Lithium 400mg/day, increasing every 3–4 days according to plasma levels.",
    score: 0.9,
    source_statut: "active",
    source_classification: "C4",
    source_approuvee_le: "2026-09-26T10:00:00+01:00",
    source_approuvee_par: "00000000-0000-0000-0000-000000000001",
    source_revue_a_jour: true,
    source_remplacee_par: null,
    ...surcharge,
  };
}

describe("M08-D2 — `en` admis là où prévu, le reste inchangé", () => {
  it("ligne `en` récupérable → validée (D2)", () => {
    const l = validerLignePorte(ligne());
    expect(l).not.toBeNull();
    expect(l?.langue).toBe("en");
  });

  it.each([["fr"], ["ar"], ["darija"]])("langue historique %s → toujours validée", (langue) => {
    expect(validerLignePorte(ligne({ langue }))).not.toBeNull();
  });

  it.each([["de"], ["xx"], [""], ["EN"], ["english"]])("langue non supportée %s → rejetée (null)", (langue) => {
    expect(validerLignePorte(ligne({ langue }))).toBeNull();
  });
});

describe("M08-D2 — dossier Taylor : admission sans approbation", () => {
  it("l'entrée Taylor construit un dossier C4/en traçable au frozen", () => {
    const e = entreeTaylor(RACINE);
    expect(e.titre).toBe("The Maudsley Prescribing Guidelines in Psychiatry");
    expect(e.langue).toBe("en");
    expect(e.version).toBe(`sha256:${TAYLOR_SOURCE_SHA}`);
    expect(e.classification).toBe("C4");
    expect(e.fixture).toBe(false);
  });

  it("approbation manquante → en-attente, jamais approuvée ni active", () => {
    const e = entreeTaylor(RACINE);
    const v = validerQuarantaine({
      titre: e.titre, version: e.version, langue: e.langue, classification: e.classification,
      provenance: e.provenance, hashContenu: e.hashContenu,
      approuvePar: e.approuvePar, approuveLe: e.approuveLe, revue: e.revue, fixture: false,
    });
    expect(v).toEqual({ ok: true, motif: null, approbation: "en-attente" });
  });
});

describe("M08-D2 — gardes patient + fixture sur Taylor", () => {
  it("2 unités purgées sur 7861, motifs corroborés uniquement", () => {
    const r = dryRunTaylor(RACINE);
    expect(r.unites_totales).toBe(7861);
    expect(r.unites_epurees).toHaveLength(2);
    expect(r.chunks_acceptes).toBe(7859);
  }, 120000);

  it("marqueur isolé sans corroboration → conservé (pas de faux positif biblio)", () => {
    expect(spanSuspect("Voir Doe J, et al. outcome D-2 trial results.", "prose")).toBe(false);
    expect(spanSuspect("contact 0612345678 noté en observation", "prose")).toBe(true);
    expect(spanSuspect("Doe J, et al. 2020", "reference")).toBe(false);
  });

  it("identifiant Taylor hors liste fixture", async () => {
    const { FIXTURE_IDS } = await import("../../scripts/charger-connaissance-socle.mjs");
    expect(FIXTURE_IDS.has(TAYLOR_BOOK_ID)).toBe(false);
  });
});

describe("M08-D2 — déterminisme + quarantaine", () => {
  it("deux constructions → mêmes chunkIds (déterminisme)", () => {
    const r1 = dryRunTaylor(RACINE);
    const r2 = dryRunTaylor(RACINE);
    expect(r1.determinisme_ids).toBe(true);
    expect(r2.determinisme_ids).toBe(true);
    expect(r1.chunks_acceptes).toBe(r2.chunks_acceptes);
  }, 120000);

  it("statut inactif en dur, chunker provisoire explicite (D4 ouvert)", () => {
    expect(TAYLOR_CHUNKER_PROPOSE).toBe("taylor-units-v1-proposed");
    const r = dryRunTaylor(RACINE);
    expect(r.statuts).toEqual(["inactive"]);
    expect(r.ecrits).toEqual({ sources: 0, chunks: 0 });
  }, 120000);

  it("aucune ligne active ne peut sortir du dry-run", () => {
    const r = dryRunTaylor(RACINE);
    expect(r.statuts).toEqual(["inactive"]);
    expect(r.validation.approbation).toBe("en-attente");
  }, 120000);

  it("spans vides conservés (jamais purgés sans preuve)", () => {
    const saines = [
      { unit_id: "u-a", unit_type: "prose", source_block_ids: [] },
      { unit_id: "u-b", unit_type: "heading", source_block_ids: [] },
    ];
    const { gardees, epurees } = filtrerUnitesSuresTaylor(RACINE, saines as never);
    expect(epurees).toEqual([]);
    expect(gardees).toHaveLength(2);
  });
});
