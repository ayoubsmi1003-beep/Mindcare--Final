#!/usr/bin/env node
/** M08-Taylor v2 CANDIDATE — DRY-RUN UNIQUEMENT (décision D4-bis requise avant tout chargement).
 *
 * Constat mesuré (sonde-troncation-taylor.mjs) : 414/7 859 chunks v1
 * dépassent la fenêtre d'embedding épinglée (512 tokens, règle `511 premiers
 * + dernier`) — 18,71 % des tokens du corpus sont tronqués au milieu.
 * Ce candidat scinde VERBATIM les unités longues, sans toucher au v1 :
 *
 * - mêmes unités, mêmes gardes patient/fixture, même assemblage Gate-4,
 *   même construction de texte parent que
 *   `charger-connaissance-corpus-taylor.mjs` (importé, jamais copié) ;
 * - si texte parent > SEUIL_V2 (1 500 caractères) : découpe aux frontières
 *   de phrases (miroir sémantique de `couperLong`, seuil paramétré —
 *   le partagé reste à 2 000, intouché), rejointe par " " = parent à l'octet
 *   (normaliserTexte a déjà resserré les blancs) ;
 * - ids enfants 100 % disjoints du v1 (marqueur v2 dans l'empreinte) :
 *   `taylor-` + FNV(sourceUuid|version|section|unit_id|texteHashParent|
 *   occurrence|enfantIndex|chunkerV2) ; jamais de collision intra-corpus ;
 * - versionChunk `taylor-units-v2-candidate` — JAMAIS ajoutée à
 *   CHUNKERS_ACCEPTES ici (le chargement exige une décision D4-bis humaine) ;
 * - statut "inactive" en dur, approbation "en-attente" : aucune activation,
 *   aucun embedding, aucune approbation inventée.
 *
 * Zéro écriture (ni DB, ni fichiers : rapport stdout + objet retourné).
 */
import {
  TAYLOR_BOOK_ID,
  TAYLOR_SOURCE_SHA,
  entreeTaylor,
  filtrerUnitesSuresTaylor,
  spanBrutUnite,
} from "./charger-connaissance-corpus-taylor.mjs";
import {
  FIXTURE_IDS,
  hacherTexteFNV,
  normaliserTexte,
  sha256Hex,
  uuidDeterministe,
  validerQuarantaine,
} from "./charger-connaissance-socle.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TAYLOR_CHUNKER_V2 = "taylor-units-v2-candidate";
/** Seuil de scission (caractères), CHOISI MESURÉ (tokenizer épinglé, 7 859 parents) :
 * 1500 → 8 860 enfants, max 580 tokens, 5 au-delà de 512, 44 coupes dures ;
 * 1200 → 9 344 enfants, max 500 tokens, 0 au-delà de 512, 105 coupes dures ;
 * 1000 → 9 842 enfants, max 444 tokens, 0 au-delà, 183 coupes dures.
 * 1200 retenu : zéro dépassement prouvé exhaustivement, +5,5 % de chunks
 * contre 1 500, deux fois moins de coupes dures que 1 000. */
export const SEUIL_V2_CARACTERES = 1200;

/** Miroir de `couperLong` (découpe) au seuil v2 — même sémantique verbatim.
 * Écart documenté avec le précédent v1.1 : une phrase SEULE dépassant le
 * seuil serait poussée entière (jusqu'à ~4 000 caractères — hors fenêtre
 * d'embed, ce qui annulerait l'objet même du v2). Ici elle est coupée au
 * dernier espace ≤ seuil (`coupeDure: true`, jamais en milieu de mot) :
 * la jointure " " reste exacte à l'octet, seule la frontière change de
 * nature — et elle est marquée comme telle, pas silencieuse. */
export function couperLongSeuil(texte, seuil = SEUIL_V2_CARACTERES) {
  if (!Number.isInteger(seuil) || seuil <= 0) throw new Error("seuil v2 invalide");
  if (texte.length <= seuil) return [{ texte, coupeDure: false, joint: " " }];
  const durcir = (phrase) => {
    const parts = [];
    let reste = phrase;
    while (reste.length > seuil) {
      let coupure = reste.lastIndexOf(" ", seuil);
      let joint = " ";
      if (coupure <= 0) {
        coupure = seuil; // sans espace : coupe franche, joint vide, casse-tête documenté
        joint = "";
      }
      parts.push({ texte: reste.slice(0, coupure), coupeDure: true, joint });
      reste = (joint === " " ? reste.slice(coupure).trimStart() : reste.slice(coupure));
    }
    if (reste !== "") parts.push({ texte: reste, coupeDure: true, joint: " " });
    return parts;
  };
  const phrases = texte.split(/(?<=[.!?;:\n])\s+/);
  const morceaux = [];
  let courant = "";
  for (const phrase of phrases) {
    if (phrase.length > seuil) {
      if (courant !== "") morceaux.push({ texte: courant, coupeDure: false, joint: " " });
      courant = "";
      morceaux.push(...durcir(phrase));
      continue;
    }
    const candidat = courant === "" ? phrase : `${courant} ${phrase}`;
    if (candidat.length <= seuil) courant = candidat;
    else {
      if (courant !== "") morceaux.push({ texte: courant, coupeDure: false, joint: " " });
      courant = phrase;
    }
  }
  if (courant !== "") morceaux.push({ texte: courant, coupeDure: false, joint: " " });
  return morceaux.length === 0 ? [{ texte, coupeDure: true, joint: " " }] : morceaux;
}

function lireUnites(racine) {
  const chemin = join(
    racine, "knowledge", "canonical-v2", TAYLOR_BOOK_ID,
    `sha256-${TAYLOR_SOURCE_SHA}`, "units.jsonl",
  );
  return readFileSync(chemin, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Construit les chunks v2 depuis les unités gardées : parents identiques au
 * v1 (même texte, même hash, même occurrence), enfants scindés verbatim.
 * Retourne { chunks, parents } — chunks plats prêts pour mesure/test.
 */
export function chunksDepuisUnitesTaylorV2(racine, unites, ctx) {
  const chunks = [];
  const parents = [];
  const occ = new Map();
  const vus = new Set();
  for (const u of unites) {
    const section = Array.isArray(u.structural_path) ? u.structural_path.join(" › ") : "";
    const imprime = u.printed_start ?? "?";
    const span = spanBrutUnite(racine, u);
    const texteParent = normaliserTexte(`${u.title ?? ""} — ${span} [${TAYLOR_BOOK_ID} p.${imprime}|src:${u.physical_start ?? "?"}]`);
    if (texteParent === "") continue;
    const texteHashParent = hacherTexteFNV(texteParent);
    const cle = `${ctx.sourceUuid}|${ctx.version}|${section}|${texteHashParent}`;
    const occurrence = occ.get(cle) ?? 0;
    occ.set(cle, occurrence + 1);
    const morceaux = couperLongSeuil(texteParent);
    const parent = {
      unit_id: u.unit_id, section, texteParent, texteHashParent, occurrence,
      enfants: morceaux.length, scinde: morceaux.length > 1,
      joints: morceaux.map((m) => m.joint ?? " "),
      physical_start: u.physical_start ?? null, physical_end: u.physical_end ?? null,
      printed_start: u.printed_start ?? null, printed_end: u.printed_end ?? null,
    };
    parents.push(parent);
    morceaux.forEach((m, enfantIndex) => {
      const texte = m.texte;
      const texteHash = hacherTexteFNV(texte);
      const chunkId =
        `taylor-${hacherTexteFNV([ctx.sourceUuid, ctx.version, section, u.unit_id, texteHashParent, String(occurrence), String(enfantIndex), TAYLOR_CHUNKER_V2].join("|"))}`;
      if (vus.has(chunkId)) throw new Error(`collision intra-corpus v2 : ${chunkId}`);
      vus.add(chunkId);
      chunks.push({
        chunkId, section, ordinal: chunks.length, langue: "en", texte, texteHash, occurrence,
        versionChunk: TAYLOR_CHUNKER_V2, statut: "inactive",
        unit_id: u.unit_id, parent_texte_hash: texteHashParent,
        enfant_index: enfantIndex, enfants_total: morceaux.length, coupe_dure: m.coupeDure === true,
        physical_start: parent.physical_start, physical_end: parent.physical_end,
        printed_start: parent.printed_start, printed_end: parent.printed_end,
      });
    });
  }
  return { chunks, parents };
}

/** Dry-run v2 : zéro écriture, rapport retourné + imprimé. */
export function dryRunTaylorV2(racine) {
  const entree = entreeTaylor(racine);
  if (FIXTURE_IDS.has(TAYLOR_BOOK_ID) || FIXTURE_IDS.has(entree.titre)) {
    throw new Error("fixture-interdite : identifiant Taylor en liste fixture");
  }
  const dossier = {
    titre: entree.titre, version: entree.version, langue: entree.langue,
    classification: entree.classification, provenance: entree.provenance,
    hashContenu: entree.hashContenu, approuvePar: entree.approuvePar, approuveLe: entree.approuveLe,
    revue: entree.revue, fixture: false,
  };
  const validation = validerQuarantaine(dossier);
  const unites = lireUnites(racine);
  const { gardees, epurees } = filtrerUnitesSuresTaylor(racine, unites);
  const ctx = {
    sourceUuid: uuidDeterministe(`${TAYLOR_BOOK_ID}:sha256:${TAYLOR_SOURCE_SHA}`),
    version: entree.version, langue: "en",
  };
  const p1 = chunksDepuisUnitesTaylorV2(racine, gardees, ctx);
  spanBrutUnite._cache = new Map();
  const p2 = chunksDepuisUnitesTaylorV2(racine, gardees, ctx);
  const h1 = sha256Hex(p1.chunks.map((c) => c.chunkId).join("\n"));
  const h2 = sha256Hex(p2.chunks.map((c) => c.chunkId).join("\n"));
  // Preuve verbatim : chaque parent scindé = jointure exacte de ses enfants
  // (séparateurs enregistrés par morceau : " " sauf coupe franche "").
  let jointuresOk = 0;
  let jointuresKo = 0;
  let coupesDures = 0;
  const parParent = new Map();
  for (const c of p1.chunks) {
    const k = `${c.unit_id}|${c.occurrence}`;
    if (!parParent.has(k)) parParent.set(k, []);
    parParent.get(k).push(c);
  }
  // Preuve verbatim : chaque parent scindé = jointure exacte de ses enfants
  // (séparateurs enregistrés par morceau : " " sauf coupe franche "").
  for (const parent of p1.parents) {
    if (!parent.scinde) continue;
    const enfants = (parParent.get(`${parent.unit_id}|${parent.occurrence}`) ?? [])
      .sort((a, b) => a.enfant_index - b.enfant_index);
    const joints = parent.joints ?? [];
    let reconstitue = "";
    enfants.forEach((c, i) => {
      reconstitue += c.texte + (i < enfants.length - 1 ? (joints[i] ?? " ") : "");
    });
    if (reconstitue === parent.texteParent) jointuresOk += 1;
    else jointuresKo += 1;
    coupesDures += enfants.filter((c) => c.coupe_dure === true).length;
  }
  const longueurs = p1.chunks.map((c) => c.texte.length).sort((a, b) => b - a);
  return {
    source_id: entree.source_id, langue: entree.langue, version: entree.version,
    validation, unites_totales: unites.length, unites_epurees: epurees.map((e) => e.id),
    parents: p1.parents.length, parents_scindes: p1.parents.filter((p) => p.scinde).length,
    chunks_v2: p1.chunks.length, chunker: TAYLOR_CHUNKER_V2, seuil: SEUIL_V2_CARACTERES,
    determinisme_ids: h1 === h2, jointures_verbatim_ok: jointuresOk, jointures_verbatim_ko: jointuresKo,
    enfants_coupe_dure: coupesDures,
    enfant_max_caracteres: longueurs[0] ?? 0,
    statuts: [...new Set(p1.chunks.map((c) => c.statut))],
    ecrits: { sources: 0, chunks: 0 },
  };
}

const lanceDirect = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (lanceDirect) {
  const racine = process.argv[2] ?? process.cwd();
  const r = dryRunTaylorV2(racine);
  console.log("taylor v2-candidate dry-run (zero ecriture)");
  console.log(`  parents  : ${r.parents} (scindés=${r.parents_scindes}, seuil=${r.seuil})`);
  console.log(`  chunks   : ${r.chunks_v2} [${r.chunker}, D4-bis requis]`);
  console.log(`  determinisme : ${r.determinisme_ids === true ? "OK" : "ECHEC"}`);
  console.log(`  verbatim : ok=${r.jointures_verbatim_ok} ko=${r.jointures_verbatim_ko} (coupes dures=${r.enfants_coupe_dure})`);
  console.log(`  enfant max : ${r.enfant_max_caracteres} caractères`);
  console.log(`  statuts  : ${r.statuts.join(",")} — ecrits sources=${r.ecrits.sources} chunks=${r.ecrits.chunks}`);
  if (r.validation.ok !== true || r.determinisme_ids !== true || r.jointures_verbatim_ko !== 0) process.exit(1);
}
