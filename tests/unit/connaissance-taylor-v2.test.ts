/**
 * M08-Taylor v2 CANDIDATE — dry-run uniquement, D4-bis requis avant chargement.
 *
 * Prouve : déterminisme, verbatim exact (jointures 746/746), ids disjoints
 * du v1, gardes héritées (2 purges), inactif partout, et surtout le
 * VERROU : `taylor-units-v2-candidate` n'est PAS dans CHUNKERS_ACCEPTES
 * (aucun backfill ne peut l'embarquer sans décision humaine explicite).
 */
import { describe, expect, it } from "vitest";

import {
  SEUIL_V2_CARACTERES,
  TAYLOR_CHUNKER_V2,
  chunksDepuisUnitesTaylorV2,
  couperLongSeuil,
  dryRunTaylorV2,
} from "../../scripts/charger-connaissance-corpus-taylor-v2.mjs";
import {
  chunksDepuisUnitesTaylor,
  filtrerUnitesSuresTaylor,
} from "../../scripts/charger-connaissance-corpus-taylor.mjs";
import { uuidDeterministe } from "../../scripts/charger-connaissance-socle.mjs";
import { CHUNKERS_ACCEPTES } from "../../scripts/remplir-embeddings-sql.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = process.cwd();
const CTX = {
  sourceUuid: uuidDeterministe(
    "maudsley-prescribing-guidelines-2021-taylor-14e:sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
  ),
  version: "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
  langue: "en",
};

function unitesGardees() {
  const base = join(
    RACINE, "knowledge", "canonical-v2",
    "maudsley-prescribing-guidelines-2021-taylor-14e",
    "sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
    "units.jsonl",
  );
  const unites = readFileSync(base, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return filtrerUnitesSuresTaylor(RACINE, unites);
}

describe("couperLongSeuil : verbatim, seuil paramétré, coupes marquées", () => {
  it("texte court : passthrough intact, jamais de coupe dure", () => {
    expect(couperLongSeuil("abc", 1500)).toEqual([{ texte: "abc", coupeDure: false, joint: " " }]);
  });

  it("seuil invalide : refus franc", () => {
    expect(() => couperLongSeuil("abc", 0)).toThrow(/seuil v2 invalide/);
  });

  it("split aux phrases, jointure exacte, aucune coupe dure", () => {
    const t = "Première phrase assez longue pour compter. Deuxième phrase qui suit. Troisième.";
    const ms = couperLongSeuil(t, 70);
    expect(ms.length).toBeGreaterThan(1);
    expect(ms.every((m) => m.texte.length <= 70)).toBe(true);
    const reconstitue = ms.map((m, i) => m.texte + (i < ms.length - 1 ? m.joint : "")).join("");
    expect(reconstitue).toBe(t);
    expect(ms.every((m) => m.coupeDure === false)).toBe(true);
  });

  it("phrase géante seule : coupe dure au dernier espace, jamais en milieu de mot, jointure exacte", () => {
    const phrase = "mot " + "x".repeat(10) + " " + "y".repeat(100);
    const ms = couperLongSeuil(phrase, 30);
    expect(ms.length).toBeGreaterThan(1);
    expect(ms.every((m) => m.texte.length <= 30)).toBe(true);
    expect(ms.some((m) => m.coupeDure === true)).toBe(true);
    const reconstitue = ms.map((m, i) => m.texte + (i < ms.length - 1 ? m.joint : "")).join("");
    expect(reconstitue).toBe(phrase);
  });
});

describe("v2 dry-run : corpus réel, zéro écriture", () => {
  const { gardees, epurees } = unitesGardees();
  const { chunks, parents } = chunksDepuisUnitesTaylorV2(RACINE, gardees, CTX);

  it("gardes héritées : 7 861 unités, 2 purges documentées, 7 859 parents", () => {
    expect(gardees.length + epurees.length).toBe(7861);
    expect(epurees).toHaveLength(2);
    expect(parents).toHaveLength(7859);
  });

  it("volume : 9 344 chunks v2 au seuil 1200 mesuré", () => {
    expect(SEUIL_V2_CARACTERES).toBe(1200);
    expect(chunks).toHaveLength(9344);
    expect(Math.max(...chunks.map((c) => c.texte.length))).toBeLessThanOrEqual(1200);
  });

  it("déterminisme : double construction bit-identique", () => {
    const b = chunksDepuisUnitesTaylorV2(RACINE, gardees, CTX);
    expect(b.chunks.map((c) => c.chunkId)).toEqual(chunks.map((c) => c.chunkId));
  });

  it("unicité : 9 344 ids distincts, tous namespacés taylor-", () => {
    expect(new Set(chunks.map((c) => c.chunkId)).size).toBe(9344);
    expect(chunks.every((c) => /^taylor-[0-9a-f]{8}$/.test(c.chunkId))).toBe(true);
  });

  it("disjonction totale d'avec le v1 (l'histoire est préservée, jamais réécrite)", () => {
    const v1 = chunksDepuisUnitesTaylor(RACINE, gardees, CTX);
    const ids1 = new Set(v1.map((c) => c.chunkId));
    expect(chunks.filter((c) => ids1.has(c.chunkId))).toHaveLength(0);
  });

  it("verbatim : chaque parent scindé = jointure exacte de ses enfants", () => {
    const parParent = new Map();
    for (const c of chunks) {
      const k = `${c.unit_id}|${c.occurrence}`;
      if (!parParent.has(k)) parParent.set(k, []);
      parParent.get(k).push(c);
    }
    let ok = 0;
    let ko = 0;
    for (const p of parents) {
      if (p.enfants <= 1) continue;
      const enfants = (parParent.get(`${p.unit_id}|${p.occurrence}`) ?? [])
        .sort((a, b) => a.enfant_index - b.enfant_index);
      let reconstitue = "";
      enfants.forEach((c, i) => {
        reconstitue += c.texte + (i < enfants.length - 1 ? (p.joints[i] ?? " ") : "");
      });
      if (reconstitue === p.texteParent) ok += 1;
      else ko += 1;
    }
    expect(ko).toBe(0);
    expect(ok).toBe(parents.filter((p) => p.enfants > 1).length);
  });

  it("contrat : versionChunk candidate, inactif partout, lignée complète", () => {
    expect(TAYLOR_CHUNKER_V2).toBe("taylor-units-v2-candidate");
    expect(chunks.every((c) => c.versionChunk === TAYLOR_CHUNKER_V2)).toBe(true);
    expect(chunks.every((c) => c.statut === "inactive")).toBe(true);
    expect(chunks.every((c) => c.langue === "en")).toBe(true);
    expect(chunks.every((c) =>
      typeof c.unit_id === "string" && typeof c.parent_texte_hash === "string" &&
      Number.isInteger(c.enfant_index) && Number.isInteger(c.enfants_total),
    )).toBe(true);
  });

  it("ADMISSION v2 : candidate admise EXPLICITEMENT (D4-bis LOAD + D1-V2 2026-09-27)", () => {
    expect(CHUNKERS_ACCEPTES).toContain(TAYLOR_CHUNKER_V2);
    expect(CHUNKERS_ACCEPTES).not.toContain("struct-v2");
  });

  it("dryRunTaylorV2 : rapport complet, zéro écriture", async () => {
    const r = dryRunTaylorV2(RACINE);
    expect(r.chunks_v2).toBe(9344);
    expect(r.determinisme_ids).toBe(true);
    expect(r.jointures_verbatim_ko).toBe(0);
    expect(r.ecrits).toEqual({ sources: 0, chunks: 0 });
  }, 120000);
});

describe("chargeur v2 : gardes quarantaine (pur, sans DB)", () => {
  it("garde statuts/chunker/langue/lignée, refus fermés", async () => {
    const { garderLotV2, verifierRetourLotTaylorV2 } = await import(
      "../../scripts/charger-connaissance-taylor-v2.mjs"
    );
    const bon = [{
      chunkId: "taylor-abcdef12", statut: "inactive", versionChunk: TAYLOR_CHUNKER_V2,
      langue: "en", unit_id: "tu-1", parent_texte_hash: "abcdef12",
      enfant_index: 0, enfants_total: 1, occurrence: 0,
    }];
    expect(() => garderLotV2(bon)).not.toThrow();
    expect(() => garderLotV2([{ ...bon[0], statut: "active" }])).toThrow(/statut chunk v2 refusé/);
    expect(() => garderLotV2([{ ...bon[0], versionChunk: "taylor-units-v1-proposed" }])).toThrow(/découpeur v2 refusé/);
    expect(() => garderLotV2([{ ...bon[0], unit_id: "" }])).toThrow(/lignée v2 incomplète/);
    expect(() => garderLotV2([{ ...bon[0], enfant_index: -1 }])).toThrow(/lignée v2 incomplète/);
    expect(verifierRetourLotTaylorV2(["a"], ["a"])).toBeUndefined();
    expect(() => verifierRetourLotTaylorV2(["a"], ["b"])).toThrow(/RETURNING v2 inattendu/);
  });
});
