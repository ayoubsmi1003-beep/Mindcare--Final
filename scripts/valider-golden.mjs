/**
 * valider-golden — LE CONTRAT SCHEMA M08 (strict, deterministe, 0 reseau).
 *
 * CE QUE CETTE PASSE PROUVE
 * Les goldens M08-A/B sont bien formes : JSON lisible, ids presents et
 * uniques, cles connues (anti-derive silencieuse), enums valides, references
 * internes coherentes (patients, statuts/raisons). Convention ASCII volontaire.
 *
 * CE QU'ELLE NE PROUVE PAS
 * Ni le sens metier des cas (aux evaluateurs), ni la qualite live.
 * Un cas malforme = FAIL, jamais NOT RUN.
 *
 *   node scripts/valider-golden.mjs [fichier.json ...]
 * Defaut : les 4 goldens canoniques (intentions, conversation, connaissance
 * fixture + connaissance prod, ce dernier valide comme famille connaissance).
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";

const RACINE = join(dirname(process.argv[1]), "..");
const SCHEMA = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "golden-schema.json"), "utf8"));

const DEFAUT = [
  "tests/eval/jarvis-intentions.golden.json",
  "tests/eval/jarvis-conversation.golden.json",
  "tests/eval/knowledge.golden.json",
  "tests/eval/knowledge.golden.prod-2026-09-15.json",
];

const fichiers = process.argv.length > 2 ? process.argv.slice(2) : DEFAUT;

function familleDe(nom) {
  const b = basename(nom);
  if (b.startsWith("jarvis-intentions")) return "intentions";
  if (b.startsWith("jarvis-conversation")) return "conversation";
  if (b.startsWith("knowledge")) return "connaissance";
  return null;
}

let rouges = 0;
let totalCas = 0;
const erreurs = [];
function erreur(fichier, detail) {
  rouges += 1;
  erreurs.push(`${fichier} :: ${detail}`);
  console.log(`  ROUGE | ${fichier} | ${detail}`);
}

const estChaine = (v) => typeof v === "string";
const estChaineNonVide = (v) => typeof v === "string" && v.length > 0;
const estBool = (v) => typeof v === "boolean";
const estTableau = (v) => Array.isArray(v);
const estEntierPositif = (v) => Number.isInteger(v) && v >= 0;

function clesInconnues(obj, autorisees) {
  return Object.keys(obj).filter((k) => !autorisees.includes(k));
}

function validerRacine(fichier, doc, autorisees) {
  for (const k of clesInconnues(doc, autorisees)) erreur(fichier, `cle racine inconnue: ${k}`);
}

// ─── Famille intentions ────────────────────────────────────────────────
function validerIntentions(fichier, doc) {
  const F = SCHEMA.familles.intentions;
  validerRacine(fichier, doc, F.clesRacine);
  if (!estTableau(doc.cas)) {
    erreur(fichier, "racine.cas n est pas un tableau");
    return;
  }
  const vus = new Set();
  for (const c of doc.cas) {
    const tag = (c && c.id) || "?";
    for (const k of clesInconnues(c, F.clesCas)) erreur(fichier, `${tag}: cle cas inconnue: ${k}`);
    if (!estChaineNonVide(c.id)) {
      erreur(fichier, "cas sans id non vide");
      continue;
    }
    if (vus.has(c.id)) erreur(fichier, `${c.id}: id duplique`);
    vus.add(c.id);
    totalCas += 1;
    if (!estChaine(c.input)) erreur(fichier, `${c.id}: input doit etre une chaine`);
    if (!estChaine(c.langue)) erreur(fichier, `${c.id}: langue doit etre une chaine`);
    if (!estChaine(c.categorie)) erreur(fichier, `${c.id}: categorie doit etre une chaine`);
    if (!(estChaine(c.sortieModele) || c.sortieModele === null))
      erreur(fichier, `${c.id}: sortieModele doit etre chaine ou null`);
    if (c.note !== undefined && !estChaine(c.note)) erreur(fichier, `${c.id}: note doit etre une chaine`);
    const a = c.attendu;
    if (typeof a !== "object" || a === null) {
      erreur(fichier, `${c.id}: attendu doit etre un objet`);
      continue;
    }
    for (const k of clesInconnues(a, F.clesAttendu)) erreur(fichier, `${c.id}: cle attendu inconnue: ${k}`);
    if (!F.statuts.includes(a.statut)) {
      erreur(fichier, `${c.id}: statut invalide: ${JSON.stringify(a.statut)}`);
      continue;
    }
    if (a.statut === "ecarte") {
      if (!F.raisonsEcarte.includes(a.raison)) erreur(fichier, `${c.id}: raison ecarte invalide: ${JSON.stringify(a.raison)}`);
      if (a.intent !== null) erreur(fichier, `${c.id}: ecarte exige intent null`);
      if (a.patientMention !== null && a.patientMention !== undefined)
        erreur(fichier, `${c.id}: ecarte exige patientMention null`);
      if (a.outil !== null) erreur(fichier, `${c.id}: ecarte exige outil null`);
    } else {
      if ("raison" in a) erreur(fichier, `${c.id}: valide ne porte pas de raison`);
      if (!estChaineNonVide(a.intent)) erreur(fichier, `${c.id}: valide exige intent non vide`);
      if (!(a.patientMention === null || a.patientMention === undefined || estChaine(a.patientMention)))
        erreur(fichier, `${c.id}: patientMention doit etre chaine ou null`);
      if (!estTableau(a.missingInformation) || !a.missingInformation.every(estChaine))
        erreur(fichier, `${c.id}: missingInformation doit etre un tableau de chaines`);
      if (!estBool(a.pronomSansAntecedent)) erreur(fichier, `${c.id}: pronomSansAntecedent doit etre booleen`);
      if (!estBool(a.homonymePossible)) erreur(fichier, `${c.id}: homonymePossible doit etre booleen`);
      if (!(a.outil === null || estChaine(a.outil))) erreur(fichier, `${c.id}: outil doit etre chaine ou null`);
      if (!estBool(a.clarification)) erreur(fichier, `${c.id}: clarification doit etre booleen`);
      if (!estBool(a.refus)) erreur(fichier, `${c.id}: refus doit etre booleen`);
    }
  }
}

// ─── Famille conversation ──────────────────────────────────────────────
function validerConversation(fichier, doc) {
  const F = SCHEMA.familles.conversation;
  validerRacine(fichier, doc, F.clesRacine);
  const patients = doc.patients ?? {};
  if (typeof patients !== "object" || patients === null || estTableau(patients)) {
    erreur(fichier, "racine.patients doit etre un objet");
    return;
  }
  for (const [cle, p] of Object.entries(patients)) {
    if (typeof p !== "object" || p === null || !estChaineNonVide(p.id) || !estChaineNonVide(p.libelle))
      erreur(fichier, `patient ${cle}: exige {id, libelle} non vides`);
  }
  if (!estTableau(doc.scripts)) {
    erreur(fichier, "racine.scripts n est pas un tableau");
    return;
  }
  const vus = new Set();
  for (const s of doc.scripts) {
    const tag = (s && s.id) || "?";
    for (const k of clesInconnues(s, F.clesScript)) erreur(fichier, `${tag}: cle script inconnue: ${k}`);
    if (!estChaineNonVide(s.id)) {
      erreur(fichier, "script sans id non vide");
      continue;
    }
    if (vus.has(s.id)) erreur(fichier, `${s.id}: id duplique`);
    vus.add(s.id);
    totalCas += 1;
    if (!estChaine(s.description)) erreur(fichier, `${s.id}: description doit etre une chaine`);
    if (!estChaineNonVide(s.conversationId)) erreur(fichier, `${s.id}: conversationId non vide exige`);
    if (s.resolutionOff !== undefined && !estBool(s.resolutionOff))
      erreur(fichier, `${s.id}: resolutionOff doit etre booleen`);
    if (s.setup !== undefined) {
      if (typeof s.setup !== "object" || s.setup === null) erreur(fichier, `${s.id}: setup doit etre un objet`);
      else {
        for (const k of clesInconnues(s.setup, F.clesSetup)) erreur(fichier, `${s.id}: cle setup inconnue: ${k}`);
        const cible = s.setup.cible;
        if (!(cible === null || cible === undefined || (estChaine(cible) && cible in patients)))
          erreur(fichier, `${s.id}: setup.cible patient inconnu: ${JSON.stringify(cible)}`);
      }
    }
    if (!estTableau(s.tours) || s.tours.length === 0) {
      erreur(fichier, `${s.id}: tours doit etre un tableau non vide`);
      continue;
    }
    let n = 0;
    for (const t of s.tours) {
      n += 1;
      const tt = `${s.id}#T${n}`;
      for (const k of clesInconnues(t, F.clesTour)) erreur(fichier, `${tt}: cle tour inconnue: ${k}`);
      if (!estChaine(t.input)) erreur(fichier, `${tt}: input doit etre une chaine`);
      if (t.sonde !== null && t.sonde !== undefined) {
        if (typeof t.sonde !== "object" || !estEntierPositif(t.sonde.total) || !estTableau(t.sonde.patients))
          erreur(fichier, `${tt}: sonde exige {total entier>=0, patients[]}`);
        else
          for (const p of t.sonde.patients)
            if (!estChaine(p) || !(p in patients)) erreur(fichier, `${tt}: sonde patient inconnu: ${JSON.stringify(p)}`);
      }
      if (t.sondeQueries !== undefined && (!estTableau(t.sondeQueries) || !t.sondeQueries.every(estChaine)))
        erreur(fichier, `${tt}: sondeQueries doit etre un tableau de chaines`);
      if (t.sondeErreur !== undefined && !estBool(t.sondeErreur))
        erreur(fichier, `${tt}: sondeErreur doit etre booleen`);
      if (t.rechercheModele !== undefined && !estTableau(t.rechercheModele))
        erreur(fichier, `${tt}: rechercheModele doit etre un tableau`);
      if (!estTableau(t.reponses) || t.reponses.length === 0)
        erreur(fichier, `${tt}: reponses doit etre un tableau non vide`);
      const a = t.attendu;
      if (typeof a !== "object" || a === null) {
        erreur(fichier, `${tt}: attendu doit etre un objet`);
        continue;
      }
      for (const k of clesInconnues(a, F.clesAttendu)) erreur(fichier, `${tt}: cle attendu inconnue: ${k}`);
      if (!F.verdicts.includes(a.verdict)) erreur(fichier, `${tt}: verdict invalide: ${JSON.stringify(a.verdict)}`);
      if (!(a.source === null || a.source === undefined || estChaine(a.source)))
        erreur(fichier, `${tt}: source doit etre chaine ou null`);
      if (!(a.patient === null || a.patient === undefined || (estChaine(a.patient) && a.patient in patients)))
        erreur(fichier, `${tt}: patient inconnu: ${JSON.stringify(a.patient)}`);
      for (const k of ["intentionChainee", "intentionRetenu"])
        if (!(a[k] === null || a[k] === undefined || estChaine(a[k])))
          erreur(fichier, `${tt}: ${k} doit etre chaine ou null`);
      if (!estEntierPositif(a.sondes)) erreur(fichier, `${tt}: sondes doit etre un entier >=0`);
      if (!estTableau(a.executesPatients) || !a.executesPatients.every(estChaine))
        erreur(fichier, `${tt}: executesPatients doit etre un tableau de chaines`);
      if (!estEntierPositif(a.transports)) erreur(fichier, `${tt}: transports doit etre un entier >=0`);
      if (a.clarification !== null && a.clarification !== undefined) {
        const cl = a.clarification;
        if (
          typeof cl !== "object" ||
          !estTableau(cl.contient) ||
          !cl.contient.every(estChaine) ||
          !estTableau(cl.exclut) ||
          !cl.exclut.every(estChaine)
        )
          erreur(fichier, `${tt}: clarification exige {contient[], exclut[]}`);
      }
      if (a.ciblePreservee !== undefined && !(estChaine(a.ciblePreservee) && a.ciblePreservee in patients))
        erreur(fichier, `${tt}: ciblePreservee patient inconnu`);
      if (a.porteDeFil !== undefined && !estBool(a.porteDeFil))
        erreur(fichier, `${tt}: porteDeFil doit etre booleen`);
      if (a.propositionInconnue !== undefined && !estChaine(a.propositionInconnue))
        erreur(fichier, `${tt}: propositionInconnue doit etre une chaine`);
    }
  }
}

// ─── Famille connaissance ──────────────────────────────────────────────
function validerConnaissance(fichier, doc) {
  const F = SCHEMA.familles.connaissance;
  validerRacine(fichier, doc, F.clesRacine);
  if (!estTableau(doc.cas)) {
    erreur(fichier, "racine.cas n est pas un tableau");
    return;
  }
  const vus = new Set();
  for (const c of doc.cas) {
    const tag = (c && c.id) || "?";
    for (const k of clesInconnues(c, F.clesCas)) erreur(fichier, `${tag}: cle cas inconnue: ${k}`);
    if (!estChaineNonVide(c.id)) {
      erreur(fichier, "cas sans id non vide");
      continue;
    }
    if (vus.has(c.id)) erreur(fichier, `${c.id}: id duplique`);
    vus.add(c.id);
    totalCas += 1;
    if (!estChaine(c.requete)) erreur(fichier, `${c.id}: requete doit etre une chaine`);
    if (!F.langues.includes(c.langue)) erreur(fichier, `${c.id}: langue invalide: ${JSON.stringify(c.langue)}`);
    if (!F.issues.includes(c.issue)) erreur(fichier, `${c.id}: issue invalide: ${JSON.stringify(c.issue)}`);
    if (c.gold !== null && (typeof c.gold !== "object" || !estChaineNonVide(c.gold.source) || !estChaineNonVide(c.gold.section)))
      erreur(fichier, `${c.id}: gold exige null ou {source, section} non vides`);
    for (const k of ["acceptable", "hard_negatives", "forbidden"])
      if (!estTableau(c[k]) || !c[k].every(estChaine)) erreur(fichier, `${c.id}: ${k} doit etre un tableau de chaines`);
    if (!estBool(c.expected_no_answer)) erreur(fichier, `${c.id}: expected_no_answer doit etre booleen`);
    if (!(c.expected_version === null || estChaine(c.expected_version)))
      erreur(fichier, `${c.id}: expected_version doit etre chaine ou null`);
    if (!(c.citation_contient === null || c.citation_contient === undefined || estChaine(c.citation_contient)))
      erreur(fichier, `${c.id}: citation_contient doit etre chaine ou null`);
    if (c.motif !== undefined && !estChaine(c.motif)) erreur(fichier, `${c.id}: motif doit etre une chaine`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────
let fichiersOk = 0;
for (const relatif of fichiers) {
  const chemin = resolve(RACINE, relatif);
  const famille = familleDe(chemin);
  if (famille === null) {
    erreur(relatif, "famille inconnue (nom de fichier non reconnu)");
    continue;
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(chemin, "utf8"));
  } catch (e) {
    erreur(relatif, `JSON illisible: ${e.message}`);
    continue;
  }
  const avant = rouges;
  if (famille === "intentions") validerIntentions(relatif, doc);
  else if (famille === "conversation") validerConversation(relatif, doc);
  else validerConnaissance(relatif, doc);
  if (rouges === avant) {
    fichiersOk += 1;
    const n = famille === "conversation" ? (doc.scripts ?? []).length : (doc.cas ?? []).length;
    console.log(`  vert  | ${relatif} | ${n} cas (${famille})`);
  }
}

console.log(
  rouges === 0
    ? `\nVERDICT SCHEMA : VERT (${fichiersOk} fichiers, ${totalCas} cas)`
    : `\nVERDICT SCHEMA : ROUGE — ${rouges} erreur(s)`,
);
process.exit(rouges === 0 ? 0 : 1);
