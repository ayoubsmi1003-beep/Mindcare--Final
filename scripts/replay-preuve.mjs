/**
 * replay-preuve — FONCTIONS PURES M09 (simulation hors-ligne, 0 reseau).
 *
 * Ce module ne fait aucune I/O : hachage, canonisation, analyse des lignes
 * `vert |` / `ROUGE |` des harnesses, assemblage et comparaison de rapports
 * de replay. Il est importe a la fois par `scripts/replay-golden.mjs`
 * (execution) et par les tests unitaires (preuve).
 *
 * Vocabulaire strict : PASS / FAIL / NOT RUN. Sorties 0 / 1 / 2.
 * ASCII volontaire (artefacts + grep), comme le gate M08.
 */

import { createHash } from "node:crypto";

/** Version du contrat de rapport de replay (voir tests/eval/replay-schema.json). */
export const REPLAY_SCHEMA_VERSION = "m09-replay-v1";

/** Familles rejouables en simulation deterministe (sorties pinees, faux registres). */
export const FAMILLES_SIMULATION = ["intentions", "conversation", "connaissance"];

/**
 * Canonisation JSON a cles triees (stable entre runs, independante de
 * l'ordre d'insertion). Supporte objets, tableaux et scalaires JSON.
 * @param {unknown} valeur
 * @returns {string}
 */
export function chaineCanonique(valeur) {
  if (valeur === null || valeur === undefined) return "null";
  if (Array.isArray(valeur)) return `[${valeur.map((v) => chaineCanonique(v)).join(",")}]`;
  if (typeof valeur === "object") {
    const cles = Object.keys(valeur).sort();
    return `{${cles.map((k) => `${JSON.stringify(k)}:${chaineCanonique(valeur[k])}`).join(",")}}`;
  }
  return JSON.stringify(valeur) ?? "null";
}

/** SHA-256 hexadecimal (ASCII) d'une chaine UTF-8.
 * @param {unknown} texte
 * @returns {string}
 */
export function sha256Hex(texte) {
  return createHash("sha256").update(String(texte), "utf8").digest("hex");
}

/** Emprunte d'un cas golden : hash de sa partie decisionnelle canonisee.
 * @param {unknown} partieDecisionnelle
 * @returns {string}
 */
export function empreinteCas(partieDecisionnelle) {
  return sha256Hex(chaineCanonique(partieDecisionnelle));
}

/**
 * Extrait la partie decisionnelle d'un cas selon sa famille (les notes et
 * meta humaines sont exclues : elles ne decident d'aucun verdict).
 * @param {string} famille
 * @param {{ id: string, [cle: string]: unknown }} cas
 * @returns {Record<string, unknown> | null}
 */
export function partieDecisionnelle(famille, cas) {
  if (famille === "intentions") {
    return { id: cas.id, input: cas.input, sortieModele: cas.sortieModele ?? null, attendu: cas.attendu };
  }
  if (famille === "conversation") {
    return {
      id: cas.id,
      setup: cas.setup ?? null,
      tours: (cas.tours ?? []).map((t) => ({
        input: t.input,
        sonde: t.sonde ?? null,
        sondeQueries: t.sondeQueries ?? null,
        sondeErreur: t.sondeErreur ?? null,
        reponses: t.reponses,
        attendu: t.attendu,
      })),
    };
  }
  if (famille === "connaissance") {
    return {
      id: cas.id,
      requete: cas.requete,
      gold: cas.gold,
      acceptable: cas.acceptable,
      hard_negatives: cas.hard_negatives,
      forbidden: cas.forbidden,
      expected_no_answer: cas.expected_no_answer,
      expected_version: cas.expected_version,
      citation_contient: cas.citation_contient ?? null,
    };
  }
  return null;
}

const LIGNE_VERT = /^\s*vert\s*\|\s*(\S+)/;
const LIGNE_ROUGE = /^\s*ROUGE\s*\|\s*(\S+)/;

/**
 * Analyse les lignes de sortie d'un harness : cles des controles verts
 * (premier token apres `vert |`) et rouges (premier token apres `ROUGE |`).
 * Les lignes sans token identifiable sont comptees mais non nommees.
 * @param {unknown} sortie
 * @returns {{ passer: string[], echouer: string[], vertsAnonymes: number, rougesAnonymes: number }}
 */
export function analyserLignes(sortie) {
  const passer = [];
  const echouer = [];
  let vertsAnonymes = 0;
  let rougesAnonymes = 0;
  for (const ligne of String(sortie ?? "").split("\n")) {
    const mV = ligne.match(LIGNE_VERT);
    if (mV) {
      if (mV[1]) passer.push(mV[1]);
      else vertsAnonymes += 1;
      continue;
    }
    const mR = ligne.match(LIGNE_ROUGE);
    if (mR) {
      if (mR[1]) echouer.push(mR[1]);
      else rougesAnonymes += 1;
    }
  }
  return { passer, echouer, vertsAnonymes, rougesAnonymes };
}

/**
 * Rattache une cle de controle a un id de cas selon la famille :
 * - intentions : cle exacte (`M01-01`) ;
 * - conversation : prefixe `<scriptId>#T<n>` ;
 * - connaissance : exact ou prefixe `<casId>-<check>`.
 * @param {string} famille
 * @param {string} idCas
 * @param {string} cle
 * @returns {boolean}
 */
export function cleRattachee(famille, idCas, cle) {
  if (famille === "intentions") return cle === idCas;
  if (famille === "conversation") return cle === idCas || cle.startsWith(`${idCas}#T`);
  if (famille === "connaissance") return cle === idCas || cle.startsWith(`${idCas}-`);
  return false;
}

/**
 * Verdict par cas : FAIL si une cle echouee s'y rattache, sinon PASS si une
 * cle verte s'y rattache, sinon `non-mappe` (honnete : le harness n'a emis
 * aucune ligne rattachable, jamais converti en PASS).
 * @param {string} famille
 * @param {string[]} idsCas
 * @param {string[]} clesPasser
 * @param {string[]} clesEchouer
 * @returns {Record<string, string>}
 */
export function verdictsParCas(famille, idsCas, clesPasser, clesEchouer) {
  const verdicts = {};
  for (const id of idsCas) {
    if (clesEchouer.some((c) => cleRattachee(famille, id, c))) verdicts[id] = "FAIL";
    else if (clesPasser.some((c) => cleRattachee(famille, id, c))) verdicts[id] = "PASS";
    else verdicts[id] = "non-mappe";
  }
  return verdicts;
}

/**
 * Assemble un enregistrement de suite de replay (objet pur, pret a
 * serialiser). `statut` vaut PASS / FAIL / NOT RUN.
 * @param {{ nom: string, statut: string, passer?: string[], echouer?: string[], raisonNonRun?: string | null, environnementRequis?: string | null, latenceMs?: number | null, detail?: string | null }} entree
 * @returns {{ nom: string, statut: string, pass_count: number, fail_count: number, not_run_count: number, cles_vertes: string[], cles_rouges: string[], not_run_reason: string | null, required_environment: string | null, latence_ms: number | null, detail: string | null }}
 */
export function enregistrementSuite({ nom, statut, passer = [], echouer = [], raisonNonRun = null, environnementRequis = null, latenceMs = null, detail = null }) {
  return {
    nom,
    statut,
    pass_count: statut === "NOT RUN" ? 0 : passer.length,
    fail_count: statut === "FAIL" ? Math.max(echouer.length, 1) : 0,
    not_run_count: statut === "NOT RUN" ? 1 : 0,
    cles_vertes: passer.slice(0, 400),
    cles_rouges: echouer.slice(0, 80),
    not_run_reason: raisonNonRun,
    required_environment: environnementRequis,
    latence_ms: latenceMs,
    detail,
  };
}

// ─── Scan PII (memes regles que le gate M08, elargies aux rapports replay) ──

const RX_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const UUID_OK = /^(uuid-|00000000-|11111111-|22222222-|33333333-|123e4567-)/i;
const REGLES_PII = [
  ["courriel", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["telephone", /(\+213|0)(5|6|7)\d{8}/],
  ["fixe", /(\+213|0)(2|3|4)\d{7,8}/],
  ["dossier", /P-\d{3,}/],
];

/**
 * Balaye des textes `{nom, brut, corpusIds}` et rend les trouvailles
 * `["nom: regle extrait…"]`. Les placeholders synthetiques et les ids de
 * corpus declares sont admis (pas des patients).
 * @param {Array<{ nom: string, brut: string, corpusIds?: string[] }>} cibles
 * @returns {string[]}
 */
export function balayerPii(cibles) {
  const trouvailles = [];
  for (const { nom, brut, corpusIds = [] } of cibles) {
    const corpus = new Set(corpusIds.map((s) => String(s).toLowerCase()));
    for (const [regle, rx] of REGLES_PII) {
      const m = brut.match(rx);
      if (m) trouvailles.push(`${nom}: ${regle} ${m[0].slice(0, 12)}…`);
    }
    for (const m of brut.matchAll(RX_UUID)) {
      if (!UUID_OK.test(m[0]) && !corpus.has(m[0].toLowerCase())) {
        trouvailles.push(`${nom}: uuid-reel ${m[0].slice(0, 13)}…`);
      }
    }
  }
  return trouvailles;
}

// ─── Comparaison de runs (kind=compare, hors-ligne) ─────────────────────────

/**
 * Compare deux rapports de replay : verdicts par suite et par cas, totaux,
 * provenance (hashes goldens, versions prompts). Rend `{identique, diffs[]}`.
 * Une difference de verdict est informative (drift detecte), jamais un PASS.
 * @param {{ suites?: Array<{ nom: string, statut: string, cles_rouges?: string[] }>, cas?: Array<{ famille: string, id: string, empreinte: string, verdict: string }>, provenance?: Record<string, string> }} ancien
 * @param {{ suites?: Array<{ nom: string, statut: string, cles_rouges?: string[] }>, cas?: Array<{ famille: string, id: string, empreinte: string, verdict: string }>, provenance?: Record<string, string> }} nouveau
 * @returns {{ identique: boolean, diffs: Array<{ portee: string, nom: string, ecart: string }> }}
 */
export function comparerRapports(ancien, nouveau) {
  const diffs = [];
  const suitesA = new Map((ancien.suites ?? []).map((s) => [s.nom, s]));
  const suitesN = new Map((nouveau.suites ?? []).map((s) => [s.nom, s]));
  for (const [nom, sa] of suitesA) {
    const sn = suitesN.get(nom);
    if (!sn) {
      diffs.push({ portee: "suite", nom, ecart: "absente-du-nouveau" });
      continue;
    }
    if (sa.statut !== sn.statut) diffs.push({ portee: "suite", nom, ecart: `statut ${sa.statut} -> ${sn.statut}` });
    const rougesA = new Set(sa.cles_rouges ?? []);
    const rougesN = new Set(sn.cles_rouges ?? []);
    for (const c of rougesN) if (!rougesA.has(c)) diffs.push({ portee: "controle", nom, ecart: `nouveau-rouge ${c}` });
    for (const c of rougesA) if (!rougesN.has(c)) diffs.push({ portee: "controle", nom, ecart: `rouge-resolu ${c}` });
  }
  for (const nom of suitesN.keys()) {
    if (!suitesA.has(nom)) diffs.push({ portee: "suite", nom, ecart: "nouvelle-suite" });
  }
  const casA = new Map(((ancien.cas ?? []).map((c) => [`${c.famille}/${c.id}`, c])));
  for (const c of nouveau.cas ?? []) {
    const cle = `${c.famille}/${c.id}`;
    const pa = casA.get(cle);
    if (!pa) {
      diffs.push({ portee: "cas", nom: cle, ecart: "nouveau-cas" });
      continue;
    }
    if (pa.empreinte !== c.empreinte) diffs.push({ portee: "cas", nom: cle, ecart: "entree-modifiee (golden change)" });
    else if (pa.verdict !== c.verdict) diffs.push({ portee: "cas", nom: cle, ecart: `verdict ${pa.verdict} -> ${c.verdict}` });
  }
  const provA = ancien.provenance ?? {};
  const provN = nouveau.provenance ?? {};
  for (const k of ["goldens_hash", "schema_version", "prompts_hash"]) {
    if (provA[k] !== provN[k]) diffs.push({ portee: "provenance", nom: k, ecart: `${provA[k] ?? "?"} -> ${provN[k] ?? "?"}` });
  }
  return { identique: diffs.length === 0, diffs };
}
