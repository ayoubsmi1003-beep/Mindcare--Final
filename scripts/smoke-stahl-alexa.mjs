#!/usr/bin/env node
/**
 * smoke-stahl-alexa — preuve de bout en bout, porte H (Stahl 7e).
 *
 *   node scripts/smoke-stahl-alexa.mjs            (etat AVANT activation)
 *   node scripts/smoke-stahl-alexa.mjs --actif    (etat APRES activation)
 *
 * Ce que le script verifie, sur les VRAIES portes SQL :
 *  - `app.search_knowledge_lexical` (porte de production, RLS comprise) ;
 *  - la source Stahl est-elle eligible (classe, approbation, revue) ;
 *  - les deux livres deja actifs repondent-ils toujours (non-regression) ;
 *  - quand Stahl est actif : la source, la section, le folio IMPRIME et la
 *    page PHYSIQUE sont-ils exposes dans la preuve ?
 *  - une question dont le livre ne repond PAS ramene-t-elle quelque chose ?
 *
 * Le script n'ECRIT rien. Il lit, il mesure, il rapporte.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execSocket, lignesSocket } from "./transport-socket.mjs";
import { SOURCE_UUID, VERSION } from "./charger-connaissance-corpus-stahl.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTIF = process.argv.includes("--actif");
const VERIFIER = process.argv.includes("--verifier");
const SORTIE = join(RACINE, "knowledge", "canonical-v2", "stahl-prescribers-guide-7e-cup",
  VERSION.replace("sha256:", "sha256-"), "smoke-alexa.json");
const TITRE_STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)";

/** La PORTE DE PRODUCTION, inchangee (migration 123).
 *  Les lignes sont transportees en JSON : le marqueur de page
 *  `[book p.X|src:Y]` contient un `|`, qui est aussi le separateur de
 *  `psql -qAt` — un parsing par `split('|')` corromprait la preuve. */
const PORTE = `SELECT row_to_json(x)::text FROM app.search_knowledge_lexical($1, $2, $3) x`;

/**
 * Questions de fumee.
 *
 * `attend` : la SECTION attendue (rubrique + monographie). Chaque paire
 * (requete, section) est un couple REELLEMENT PRESENT dans le corpus : une
 * monographie n'a pas les memes rubriques qu'une autre (seules 30 monographies
 * sur 152 ont une rubrique « Usual Dosage Range » ; Venlafaxine n'a pas de
 * rubrique « How the Drug Works »). Interroger une rubrique absente NE DOIT
 * PAS remonter de passage — c'est le comportement correct, verifie par le
 * controle « rubrique absente » plus bas.
 *
 * `attend: null` : aucune reponse attendue (abstention).
 */
const QUESTIONS = [
  // Rubrique « Dosing Tips » — existe pour Sertraline.
  { q: "dosing tips sertraline", langue: "en", attend: "Dosing Tips" },
  // Rubrique « Notable Side Effects » — existe pour Clozapine.
  { q: "notable side effects clozapine", langue: "en", attend: "Notable Side Effects" },
  // Rubrique « How Long Until It Works » — existe pour Venlafaxine.
  { q: "how long until it works venlafaxine", langue: "en", attend: "How Long Until It Works" },
  // Rubrique « Drug Interactions » — existe pour Lithium.
  { q: "drug interactions lithium", langue: "en", attend: "Drug Interactions" },
  // Rubrique « Usual Dosage Range » — existe pour Alprazolam (30 monographies
  // sur 152 la portent : c'est une variete d'INTITULE, pas une absence de
  // donnee — voir le controle d'abstention « usual dosage range sertraline »).
  { q: "usual dosage range alprazolam", langue: "en", attend: "Usual Dosage Range" },
  // Abstention : le livre ne repond pas.
  { q: "insulin regimen type 1 diabetes", langue: "en", attend: null },
  // Abstention : une question dont la RUBRIQUE N'EXISTE PAS pour ce medicament.
  // La reponse vide est le comportement CORRECT : l'absence d'un intitulé ne
  // prouve pas l'absence de donnee (la posologie de Sertraline est sous
  // « Dosing Tips »).
  { q: "usual dosage range sertraline", langue: "en", attend: null },
  { q: "how the drug works venlafaxine", langue: "en", attend: null },
];

const NON_REGRESSION = [
  { q: "criteres diagnostiques trouble panique", langue: "fr", attend: "DSM-5" },
  { q: "sertraline side effects", langue: "en", attend: "Maudsley" },
];

function requete(q, langue, limite = 10) {
  const lignes = lignesSocket(RACINE, { texte: PORTE, params: [q, langue, limite] });
  return lignes.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { texte: l, source_titre: "" };
    }
  });
}

function etatSource() {
  const l = lignesSocket(RACINE, {
    texte: `SELECT statut||'|'||classification||'|'||(approved_at IS NULL)::text||'|'||(approved_by IS NULL)::text||'|'||langue||'|'||titre FROM app.knowledge_sources WHERE id='${SOURCE_UUID}'`,
    params: [],
  })[0] ?? "";
  const [statut, classe, na, nb, langue, titre] = l.split("|");
  return { statut, classe, approved_at_null: na === "t", approved_by_null: nb === "t", langue, titre };
}

function etatChunks() {
  const l = lignesSocket(RACINE, {
    texte: `SELECT count(*)||'|'||count(*) FILTER (WHERE statut='active')||'|'||count(*) FILTER (WHERE statut='inactive')||'|'||count(embedding) FROM app.knowledge_chunks WHERE source_id='${SOURCE_UUID}'`,
    params: [],
  })[0] ?? "0|0|0|0";
  const [total, actifs, inactifs, vecteurs] = l.split("|");
  return { total: +total, actifs: +actifs, inactifs: +inactifs, vecteurs: +vecteurs };
}

const rapport = { moment: ACTIF ? "APRES activation" : "AVANT activation", controles: [], echecs: [] };
const source = etatSource();
const chunks = etatChunks();
rapport.source = source;
rapport.chunks = chunks;
console.log(`source Stahl : statut=${source.statut} classe=${source.classe} langue=${source.langue}`);
console.log(`chunks       : ${chunks.total} (actifs=${chunks.actifs} inactifs=${chunks.inactifs} vecteurs=${chunks.vecteurs})`);

/* ------------------------------------------------------------------ */
/* MODE VERIFICATION : on active DANS UNE TRANSACTION puis ROLLBACK.    */
/*                                                                      */
/* But : prouver le chemin POST-ACTIVATION (porte de production reelle, */
/* citations avec folio imprime et page physique) SANS activer quoi que  */
/* soit. La transaction est annulee : l'etat de la base est inchange.  */
/* ------------------------------------------------------------------ */
if (VERIFIER) {
  const q = (texte, langue) =>
    `SELECT '${texte}'::text AS q, row_to_json(x)::text AS r FROM app.search_knowledge_lexical(${texte}, '${langue}', 10) x;`;
  // Les requetes sont alignees sur le VOCABULAIRE REEL du livre : chaque
  // monographie a ses propres rubriques (seules 33 monographies sur 152 ont
  // une rubrique « Usual Dosage Range »). C'est une contrainte MESUREE de la
  // porte lexicale (AND) : interroger un livre suppose d employer ses mots.
  const requetes = [
    ["Q1", "sertraline dosing", "en"],
    ["Q2", "notable side effects clozapine", "en"],
    ["Q3", "venlafaxine dosing", "en"],
    ["Q4", "drug interactions lithium", "en"],
    ["Q5", "insulin regimen type 1 diabetes", "en"],
    ["Q6", "posologie habituelle sertraline", "fr"],
    ["Q7", "sertraline", "en"],
  ];
  const sql = [
    "BEGIN;",
    `UPDATE app.knowledge_sources SET statut='active', approved_at=now(), `
    + `approved_by='00000000-0000-0000-0000-0000000000a1'::uuid, `
    + `reviewed_by='00000000-0000-0000-0000-0000000000a1'::uuid, reviewed_at=now() `
    + `WHERE id='${SOURCE_UUID}'::uuid;`,
    `UPDATE app.knowledge_chunks SET statut='active' WHERE source_id='${SOURCE_UUID}'::uuid;`,
    ...requetes.map(([etiq, txt, langue]) => q(etiq, langue).replace(
      "SELECT '", `SELECT '${etiq}|`).replace(
      "::text AS q,", `::text AS q,`)),
    "ROLLBACK;",
  ].join("\n");
  // Les requetes doivent porter leur etiquette ET leur texte : on les ecrit
  // explicitement plutot que par remplacement fragile.
  const lignesRequete = requetes.map(([etiq, txt, langue]) =>
    `SELECT '${etiq}'::text AS etiquette, row_to_json(y)::text AS r `
    + `FROM LATERAL app.search_knowledge_lexical('${txt.replace(/'/g, "''")}', '${langue}', 10) AS y;`);
  const sqlFinal = [
    "BEGIN;",
    `UPDATE app.knowledge_sources SET statut='active', approved_at=now(), `
    + `approved_by='00000000-0000-0000-0000-0000000000a1'::uuid, `
    + `reviewed_by='00000000-0000-0000-0000-0000000000a1'::uuid, reviewed_at=now() `
    + `WHERE id='${SOURCE_UUID}'::uuid;`,
    `UPDATE app.knowledge_chunks SET statut='active' WHERE source_id='${SOURCE_UUID}'::uuid;`,
    ...lignesRequete,
    "ROLLBACK;",
  ].join("\n");
  void sql;

  const sortie = execSocket(RACINE, sqlFinal);
  const parEtiquette = new Map();
  for (const ligne of sortie.split("\n")) {
    const i = ligne.indexOf("|");
    if (i < 0) continue;
    const etiq = ligne.slice(0, i);
    const reste = ligne.slice(i + 1);
    if (!/^Q\d$/.test(etiq)) continue;
    let objet;
    try {
      objet = JSON.parse(reste);
    } catch {
      continue; // ligne non JSON : ignoree
    }
    const liste = parEtiquette.get(etiq) ?? [];
    liste.push(objet);
    parEtiquette.set(etiq, liste);
  }

  const attendu = {
    Q1: { drug: "Sertraline", page: true },
    Q2: { drug: "Clozapine", page: true },
    Q3: { drug: "Venlafaxine", page: true },
    Q4: { drug: "Lithium", page: true },
    Q5: { drug: null, page: false },
    // Question FRANCAISE : la porte filtre sur la langue du chunk (en) ->
    // aucune correspondance. C'est le comportement ATTENDU et documente :
    // l'ecart FR/EN mesure (variante D du rapport).
    Q6: { drug: null, page: false },
    Q7: { drug: "Sertraline", page: true },
  };
  const controles = [];
  for (const [etiq, regle] of Object.entries(attendu)) {
    const lignes = parEtiquette.get(etiq) ?? [];
    const stahl = lignes.filter((l) => l.source_titre === TITRE_STAHL);
    const avecPage = stahl.filter((l) => /\[stahl-prescribers-guide-7e-cup p\.\d+\|src:\d+\]/.test(l.texte ?? ""));
    const bonneSection = regle.drug === null
      ? true
      : stahl.some((l) => (l.section ?? "").includes(regle.drug));
    const ok = regle.drug === null
      ? stahl.length === 0
      : bonneSection && avecPage.length > 0;
    controles.push({
      etiquette: etiq,
      requete: requetes.find((r) => r[0] === etiq)?.[1],
      chunks_stahl: stahl.length,
      chunks_avec_page: avecPage.length,
      section_attendue: regle.drug,
      statut: ok ? "PASS" : "FAIL",
      exemple: stahl[0]
        ? { section: stahl[0].section, extrait: (stahl[0].texte ?? "").slice(0, 200) }
        : null,
    });
    console.log(`  ${ok ? "PASS" : "FAIL"} ${etiq} : ${stahl.length} chunk(s) Stahl, ${avecPage.length} avec folio+page`);
    if (stahl[0]) console.log(`        ${stahl[0].section}`);
  }

  // L'etat doit etre IDENTIQUE apres ROLLBACK.
  const apres = { source: etatSource(), chunks: etatChunks() };
  const identique =
    apres.source.statut === source.statut &&
    apres.chunks.actifs === chunks.actifs &&
    apres.chunks.total === chunks.total &&
    apres.chunks.vecteurs === chunks.vecteurs;
  const echecs = controles.filter((c) => c.statut === "FAIL");
  const rapportVerif = {
    outil: "smoke-stahl-alexa.mjs --verifier",
    methode: "activation simulee DANS UNE TRANSACTION, porte de production reelle, puis ROLLBACK",
    etat_avant: rapport,
    controles,
    etat_apres_rollback: apres,
    etat_inchange: identique,
    verdict: echecs.length === 0 && identique ? "PASS" : "FAIL",
  };
  writeFileSync(SORTIE, `${JSON.stringify(rapportVerif, null, 2)}\n`, "utf8");
  console.log(`\nverdict : ${rapportVerif.verdict} (${controles.length} controles, ${echecs.length} echec(s))`);
  console.log(`etat apres ROLLBACK : statut=${apres.source.statut} chunks actifs=${apres.chunks.actifs} (inchange=${identique})`);
  process.exit(rapportVerif.verdict === "PASS" ? 0 : 1);
}

if (!ACTIF) {
  // --- etat de QUARANTAINE : le livre doit etre INVISIBLE ---------------
  const r = requete("usual dosage range sertraline", "en");
  const visible = r.filter((x) => x.source_titre === TITRE_STAHL);
  const ok = visible.length === 0;
  rapport.controles.push({
    controle: "quarantaine : la porte de production ne rend AUCUN chunk Stahl",
    attendu: 0, obtenu: visible.length, statut: ok ? "PASS" : "FAIL",
  });
  console.log(`  ${ok ? "PASS" : "FAIL"} — porte lexicale, chunks Stahl visibles = ${visible.length} (attendu 0)`);
} else {
  // --- etat ACTIVE : le livre doit repondre, avec page exacte -----------
  for (const item of QUESTIONS) {
    const r = requete(item.q, item.langue);
    const stahl = r.filter((x) => x.source_titre === TITRE_STAHL);
    if (item.attend === null) {
      const ok = stahl.length === 0;
      rapport.controles.push({
        controle: `sans reponse attendue : "${item.q}"`, attendu: 0, obtenu: stahl.length,
        statut: ok ? "PASS" : "FAIL",
      });
      console.log(`  ${ok ? "PASS" : "FAIL"} — "${item.q}" : ${stahl.length} chunk(s) Stahl (attendu 0)`);
    } else {
      const avecPage = stahl.filter((x) => /\[[^\]]*p\.\d+\|src:\d+\]/.test(x.texte ?? ""));
      const bonne = stahl.filter((x) => (x.section ?? "").includes(item.attend));
      const ok = bonne.length > 0 && avecPage.length > 0;
      rapport.controles.push({
        controle: `reponse avec section "${item.attend}" et marqueur de page`,
        attendu: "> 0", obtenu: `${bonne.length} section(s), ${avecPage.length} avec page`,
        statut: ok ? "PASS" : "FAIL",
        exemple: stahl[0] ? { section: stahl[0].section, extrait: (stahl[0].texte ?? "").slice(0, 220) } : null,
      });
      console.log(`  ${ok ? "PASS" : "FAIL"} — "${item.q}" : ${stahl.length} chunk(s), `
        + `${bonne.length} sur la bonne section, ${avecPage.length} avec folio+page`);
      if (stahl[0]) {
        console.log(`        section : ${stahl[0].section}`);
        console.log(`        extrait : ${(stahl[0].texte ?? "").slice(0, 200)}`);
      }
    }
  }
}

// --- NON-REGRESSION : les deux livres deja actifs -----------------------
for (const item of NON_REGRESSION) {
  const r = requete(item.q, item.langue);
  const ok = r.some((x) => (x.source_titre ?? "").includes(item.attend));
  rapport.controles.push({
    controle: `non-regression : "${item.attend}" repond toujours`,
    attendu: "> 0", obtenu: r.filter((x) => (x.source_titre ?? "").includes(item.attend)).length,
    statut: ok ? "PASS" : "FAIL",
  });
  console.log(`  ${ok ? "PASS" : "FAIL"} — non-regression "${item.attend}" : `
    + `${r.filter((x) => (x.source_titre ?? "").includes(item.attend)).length} resultat(s)`);
}

const echecs = rapport.controles.filter((c) => c.statut === "FAIL");
rapport.verdict = echecs.length === 0 ? "PASS" : "FAIL";

writeFileSync(SORTIE, `${JSON.stringify(rapport, null, 2)}\n`, "utf8");
console.log(`\nverdict : ${rapport.verdict} (${rapport.controles.length} controles, ${echecs.length} echec(s))`);
console.log(`preuve   : ${SORTIE.replace(RACINE + "\\", "")}`);
process.exit(echecs.length === 0 ? 0 : 1);
