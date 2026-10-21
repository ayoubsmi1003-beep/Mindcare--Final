#!/usr/bin/env node
/**
 * decouper-stahl-v1 — DÉCOUPEUR `stahl-units-v1` (pur, déterministe, zéro écriture en base).
 *
 *   node scripts/decouper-stahl-v1.mjs [--seuil 1200] [--verifier]
 *
 * CE QUE C'EST
 *   Le projecteur canonique -> chunks de retrieval, structure-aware :
 *   une unité canonique (units.jsonl) devient >= 1 chunk borné, avec
 *   trainée de titres (Drug › L2 › L3) dans le TEXTE DU CHUNK.
 *
 * CE QUE CE N'EST PAS
 *   Ni un embedding, ni un chargement PostgreSQL, ni une activation.
 *   Sortie : chunks-v2.jsonl + chunks-v2.manifest.json + repairs.jsonl.
 *
 * DÉCISIONS STRUCTURANTES (et pourquoi)
 *   1. Le chemin de titres vit dans `texte`, PAS seulement dans `section`.
 *      Raison : `remplir-embeddings-sql.mjs` vectorise `c.texte` (colonne SQL).
 *      Dans un ouvrage de 152 monographies, la preuve seule (« 50-200 mg/day »)
 *      n'identifie PAS le médicament : sans le titre dans le texte, 755 unités
 *      « Therapeutics » seraient mutuellement indiscernables pour le modèle.
 *      Modèle suivi : `struct-v2` (DSM-5), pas `taylor-units-v1` (Taylor).
 *   2. Le marqueur de page `[book p.<folio>|src:<page>]` est dans le texte :
 *      convention DÉJÀ en production (DSM-5, Taylor) ; permet la citation
 *      page-exacte SANS migration SQL (les portes SQL ont un contrat de
 *      retour verrouillé).
 *   3. La clé de section est la L2 NORMALISÉE (variantes de casse fusionnées),
 *      le chemin BRUT restant dans units.jsonl : perte nulle, index lisible.
 *   4. Les sauts de ligne intra-mot du PDF sont repliés en une espace au
 *      niveau du chunk ; units.jsonl n'est PAS réécrit ; la correction est
 *      consignée dans repairs.jsonl.
 *   5. Les atomes chiffrés ne sont jamais réécrits : le texte du chunk est le
 *      texte source, moins les blancs.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CHUNKER_VERSION = "stahl-units-v1";
export const NORMALISATION_CHUNK = "nfkc-espace-v1";
export const SEUIL_DEFAUT = 1200;

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOK_ID = "stahl-prescribers-guide-7e-cup";
const VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3";
const DOSSIER = join(RACINE, "knowledge", "canonical-v2", BOOK_ID, VERSION.replace("sha256:", "sha256-"));

export function normaliserTexte(t) {
  return String(t ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function sha256(t) {
  return createHash("sha256").update(String(t), "utf8").digest("hex");
}

/**
 * Coupe un texte long sur des frontières de phrase (verbatim).
 * Une phrase seule plus longue que le seuil est coupée au dernier espace
 * (jamais au milieu d'un mot) et le marquage `coupe_dure` est conservé.
 */
export function couperLong(texte, seuil = SEUIL_DEFAUT) {
  if (!Number.isInteger(seuil) || seuil <= 0) throw new Error("seuil invalide");
  if (texte.length <= seuil) return [{ texte, coupe_dure: false }];
  const morceaux = [];
  let courant = "";
  const phrases = texte.split(/(?<=[.!?;:])\s+(?=[A-ZÀ-ÿ0-9])/);
  for (const phrase of phrases) {
    if (phrase.length > seuil) {
      if (courant !== "") { morceaux.push({ texte: courant, coupe_dure: false }); courant = ""; }
      let reste = phrase;
      while (reste.length > seuil) {
        let coupure = reste.lastIndexOf(" ", seuil);
        if (coupure <= 0) coupure = seuil;
        morceaux.push({ texte: reste.slice(0, coupure).trim(), coupe_dure: true });
        reste = reste.slice(coupure).trim();
      }
      if (reste !== "") courant = reste;
      continue;
    }
    const candidat = courant === "" ? phrase : `${courant} ${phrase}`;
    if (candidat.length <= seuil) courant = candidat;
    else {
      if (courant !== "") morceaux.push({ texte: courant, coupe_dure: false });
      courant = phrase;
    }
  }
  if (courant !== "") morceaux.push({ texte: courant, coupe_dure: false });
  return morceaux.length === 0 ? [{ texte, coupe_dure: true }] : morceaux;
}

/** Assemble le texte final d'un chunk : titres + preuve + marqueur de page. */
export function texteChunk(l1, l2, l3, evidence, pageImprime, pagePhysique) {
  const train = [l1, l2, l3].filter(Boolean).join(" › ");
  const marqueur = `[${BOOK_ID} p.${pageImprime ?? "?"}|src:${pagePhysique ?? "?"}]`;
  return `${train} — ${evidence} ${marqueur}`.trim();
}

export function construireChunks(unites, mapL2, options = {}) {
  const seuil = options.seuil ?? SEUIL_DEFAUT;
  const chunks = [];
  const repairs = [];
  const occurrence = new Map();
  let ordinal = 0;

  for (const unite of unites) {
    const brut = unite.evidence_wording ?? "";
    const evidence = normaliserTexte(brut);
    if (evidence === "") continue;

    const chemin = Array.isArray(unite.structural_path) ? unite.structural_path : [];
    const l1 = chemin[0] ?? "";
    const l2Brut = chemin[1] ?? "";
    const l2 = mapL2[l2Brut]?.l2_index ?? l2Brut;
    const l3 = chemin[2] ?? "";

    // Réparation consignée (jamais appliquée à units.jsonl).
    const blancs = (brut.match(/\s+/g) ?? []).length;
    const newlines = (brut.match(/\n/g) ?? []).length;
    if (newlines > 0) {
      repairs.push({
        repair_id: `stahl7-rep-${String(repairs.length + 1).padStart(5, "0")}`,
        book_id: BOOK_ID,
        unit_id: unite.id,
        repair_type: "whitespace-collapse",
        normalisation: NORMALISATION_CHUNK,
        newlines_in_source: newlines,
        whitespace_runs_in_source: blancs,
        characters_before: brut.length,
        characters_after: evidence.length,
        content_preserving: true,
        note: "Sauts de ligne intra-mot du PDF repliés en une espace ; texte source non réécrit.",
      });
    }

    const parentTexte = texteChunk(l1, l2, l3, evidence, unite.printed_page_start, unite.page_start);
    const parentHash = sha256(parentTexte);
    const morceaux = couperLong(evidence, seuil);

    morceaux.forEach((morceau, enfantIndex) => {
      const texte = texteChunk(l1, l2, l3, morceau.texte, unite.printed_page_start, unite.page_start);
      const texteHash = sha256(texte);
      const cle = `${l1}|${l2}|${l3}|${texteHash}`;
      const occ = occurrence.get(cle) ?? 0;
      occurrence.set(cle, occ + 1);
      const chunkId = `stahl-${sha256(`${VERSION}|${unite.id}|${texteHash}|${occ}`).slice(0, 12)}`;
      chunks.push({
        chunk_id: chunkId,
        book_id: BOOK_ID,
        source_version: VERSION,
        unit_id: unite.id,
        titre_source: l1,
        structural_path_brut: chemin,
        structural_path_index: [l1, l2, l3].filter(Boolean),
        section: [l1, l2, l3].filter(Boolean).join(" › ") || null,
        sous_section: l3 || null,
        occurrence: occ,
        langue: unite.language ?? "en",
        texte,
        texte_hash: texteHash,
        texte_indexable: texte,
        evidence_parent: evidence,
        evidence_enfant: morceau.texte,
        page_start: unite.page_start ?? null,
        page_end: unite.page_end ?? null,
        printed_page_start: unite.printed_page_start ?? null,
        printed_page_end: unite.printed_page_end ?? null,
        concept_ids: unite.concept_ids ?? [],
        entity_ids: unite.entity_ids ?? [],
        table_figure_ids: unite.table_figure_ids ?? [],
        chunker_version: CHUNKER_VERSION,
        normalisation: NORMALISATION_CHUNK,
        parent_texte_hash: parentHash,
        enfant_index: enfantIndex,
        enfants_total: morceaux.length,
        coupe_dure: morceau.coupe_dure === true,
        statut: "inactive",
        provenance: { ...(unite.provenance ?? {}), chunker: CHUNKER_VERSION },
        confidence: unite.confidence ?? null,
        validation_status: unite.validation_status ?? "needs_review",
        semantic_domain: unite.semantic_domain ?? null,
        content_type: unite.content_type ?? null,
      });
      ordinal += 1;
    });
  }
  return { chunks, repairs };
}

function main() {
  const args = process.argv.slice(2);
  const iSeuil = args.indexOf("--seuil");
  const seuil = iSeuil >= 0 ? Number.parseInt(args[iSeuil + 1], 10) : SEUIL_DEFAUT;
  const verifier = args.includes("--verifier");

  const unites = readFileSync(join(DOSSIER, "units.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const props = JSON.parse(readFileSync(join(DOSSIER, "structure-casing-proposals.json"), "utf8"));
  const mapL2 = props.l2_index_map ?? {};

  const { chunks, repairs } = construireChunks(unites, mapL2, { seuil });

  // Contrôle de verbatim : la jointure des enfants restitue le parent.
  const parParent = new Map();
  for (const c of chunks) {
    if (!parParent.has(c.unit_id)) parParent.set(c.unit_id, []);
    parParent.get(c.unit_id).push(c);
  }
  let jointuresOk = 0;
  let jointuresKo = 0;
  for (const [unitId, enfants] of parParent) {
    if (enfants.length < 2) continue;
    enfants.sort((a, b) => a.enfant_index - b.enfant_index);
    const reconstitue = enfants.map((c) => c.evidence_enfant).join(" ");
    if (reconstitue === enfants[0].evidence_parent) jointuresOk += 1;
    else jointuresKo += 1;
  }

  // Déterminisme : deux constructions donnent les mêmes ids.
  const second = construireChunks(unites, mapL2, { seuil });
  const hash1 = sha256(chunks.map((c) => c.chunk_id).join("\n"));
  const hash2 = sha256(second.chunks.map((c) => c.chunk_id).join("\n"));

  const vides = chunks.filter((c) => c.texte.trim() === "").length;
  const sansProvenance = chunks.filter((c) => !c.unit_id || !c.page_start).length;
  const sansMedicament = chunks.filter((c) => !c.titre_source).length;
  const ids = new Set(chunks.map((c) => c.chunk_id));
  const longueurTexte = chunks.map((c) => c.texte.length);
  const longueurIndexable = chunks.map((c) => c.texte_indexable.length);

  if (!verifier) {
    writeFileSync(join(DOSSIER, "chunks-v2.jsonl"),
      chunks.map((c) => `${JSON.stringify(c)}\n`).join(""), "utf8");
    writeFileSync(join(DOSSIER, "repairs.jsonl"),
      repairs.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
  }

  const manifeste = {
    chunker_version: CHUNKER_VERSION,
    normalisation: NORMALISATION_CHUNK,
    seuil_caracteres: seuil,
    unites_lues: unites.length,
    chunks_emis: chunks.length,
    unites_multi_chunks: [...parParent.values()].filter((e) => e.length > 1).length,
    chunks_vides: vides,
    chunks_sans_provenance: sansProvenance,
    chunks_sans_titre: sansMedicament,
    ids_uniques: ids.size === chunks.length,
    jointures_verbatim_ok: jointuresOk,
    jointures_verbatim_ko: jointuresKo,
    determinisme_ids: hash1 === hash2,
    hash_ids: hash1,
    texte_max: Math.max(...longueurTexte, 0),
    texte_moyen: Math.round(longueurTexte.reduce((a, b) => a + b, 0) / Math.max(1, longueurTexte.length)),
    indexable_max: Math.max(...longueurIndexable, 0),
    repairs_enregistres: repairs.length,
    statut: "inactive",
    provenance: {
      titre_dans_texte: true,
      marqueur_page_dans_texte: true,
      cle_section_normalisee: true,
      chemin_brut_conserve: true,
    },
  };
  writeFileSync(join(DOSSIER, "chunks-v2.manifest.json"),
    `${JSON.stringify(manifeste, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifeste, null, 2));
  if (vides > 0 || sansProvenance > 0 || jointuresKo > 0 || ids.size !== chunks.length || hash1 !== hash2) {
    console.error("ROUGE — contrôle d'intégrité du découpage échoué.");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main();
}
