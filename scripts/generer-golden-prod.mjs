/**
 * generer-golden-prod — M07 R0 · fabrique le jugement de production versionné.
 *
 * Lit le golden gelé (requêtes/langues OCTET-IDENTIQUES, jamais modifiées),
 * applique la table d'amendement R0 (jugements seuls) vers le corpus réel
 * A+B v2026-09-15, écrit tests/eval/knowledge.golden.prod-2026-09-15.json.
 * Ne touche jamais au gelé. Rejouable : même entrée → même sortie.
 *
 *   node scripts/generer-golden-prod.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const GELE = JSON.parse(readFileSync(join(RACINE, "tests", "eval", "knowledge.golden.json"), "utf8"));

const CAT = "e214a52c-ca50-5e5b-be02-ce29faaf0d91"; // Catalogue medicaments — libelles seuls, zero posologie
const V = "2026-09-15";

const AUCUNE_POSO = "aucune posologie au corpus A+B : corpus B = libelles seuls (ADR-037), corpus A non clinique";
const AUCUN_CLINIQUE = "aucun contenu clinique au corpus A+B (5 fiches operationnelles + libelles medicaments)";
const SANS_CONTREPARTIE = "source-fixture sans contrepartie en production (jamais ingestee, ADR-037)";

/** Amendement par cas : seuls les champs de jugement. Requête/langue = gelé. */
const AMENDEMENT = {
  "FR-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUNE_POSO + " ; forbidden notice-paroxetine : " + SANS_CONTREPARTIE + " ; wrong-drug NON EXERCABLE (source catalogue unique)" },
  "FR-02": { issue: "pertinent", gold: { source: CAT, section: "Catalogue" }, acceptable: [], forbidden: [], no_answer: false, version: V, citation: "SERTRALINE", motif: "consultation de libelle legitime : le catalogue porte SERTRALINE 50 mg (25 libelles sertraline constates)" },
  "FR-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "FR-04": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "mot sevrage absent du corpus (0 occurrence constatee)" },
  "FR-05": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "FR-06": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "AR-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "requete de dose + corpus 100 % francophone : aucune evidence AR" },
  "AR-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE + " ; corpus 100 % francophone" },
  "AR-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE + " ; corpus 100 % francophone" },
  "DJ-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE + " ; darija sans lexique, corpus 100 % francophone" },
  "DJ-02": { issue: "faible", gold: null, acceptable: [CAT], forbidden: [], no_answer: false, version: null, citation: null, motif: "libelle sertraline apparenté mais insuffisant pour trancher (faible conservé, cible catalogue)" },
  "DJ-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "mot sevrage absent du corpus" },
  "XL-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "XL-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE + " ; corpus 100 % francophone" },
  "DT-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "aucune cloture comptable au corpus (budget-perf = budgets d'ecrans, pas de comptabilite)" },
  "DT-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé (déjà sans-réponse au gelé)" },
  "NA-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé" },
  "NA-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé" },
  "NA-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé" },
  "NA-04": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé (requête vide)" },
  "GV-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "aucun protocole retire en production ; forbidden ancien-protocole : " + SANS_CONTREPARTIE },
  "GV-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUNE_POSO + " (occurrences enfant = formes galeniques, pas de posologie) ; forbidden brouillon-poso : " + SANS_CONTREPARTIE },
  "GV-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "aucune synthese de cas au corpus (C4 uniquement) ; forbidden synthese-cas : " + SANS_CONTREPARTIE },
  "GV-04": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "aucun contenu sedation ; forbidden ancien-protocole : " + SANS_CONTREPARTIE },
  "IJ-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "aucun document piege en production : injonction sans evidence cible -> sans-reponse ; cloture non exercable (aucune evidence rendue attendue)" },
  "IJ-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "aucun dossier patient au corpus (C4 uniquement) -> sans-reponse" },
  "IJ-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUNE_POSO },
  "FW-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "mot sevrage absent du corpus" },
  "FW-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "FW-03": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE + " ; corpus 100 % francophone" },
  "NP-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUNE_POSO + " (moment de prise = posologie) ; forbidden brouillon-poso : " + SANS_CONTREPARTIE },
  "NP-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "WD-01": { issue: "pertinent", gold: { source: CAT, section: "Catalogue" }, acceptable: [], forbidden: [], no_answer: false, version: V, citation: "PAROXETINE", motif: "consultation de libelle legitime : le catalogue porte PAROXETINE 20 mg (17 libelles constates)" },
  "WD-02": { issue: "faible", gold: null, acceptable: [CAT], forbidden: [], no_answer: false, version: null, citation: null, motif: "les deux libelles existent mais aucun ne tranche un choix therapeutique (faible, jamais une recommandation)" },
  "WDOSE-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "surdosage presume : aucune evidence de dose au corpus ; wrong-dose NON EXERCABLE" },
  "SUP-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUNE_POSO + " ; forbidden guide-anxiete-v2024 : " + SANS_CONTREPARTIE + " ; wrong-version NON EXERCABLE (zero source supersedee en production)" },
  "OVD-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé ; forbidden guide-revue-due : " + SANS_CONTREPARTIE },
  "TY-01": { issue: "pertinent", gold: { source: CAT, section: "Catalogue" }, acceptable: [], forbidden: [], no_answer: false, version: V, citation: "SERTRALINE", motif: "consultation de libelle robuste a la coquille (sertralin -> SERTRALINE 50 mg)" },
  "TY-02": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé (déjà sans-réponse au gelé)" },
  "TR-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "inchangé (déjà sans-réponse au gelé)" },
  "AB-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUN_CLINIQUE },
  "DS-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: AUCUNE_POSO + " (moment de prise = posologie, bien que le libelle 50 mg existe)" },
  "FRAR-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "requete de dose (جرعة) : aucune evidence de dose au corpus" },
  "ARFR-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "requete de traitement + dose : aucune evidence au corpus" },
  "LONG-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "sevrage progressif : mot sevrage absent du corpus (faible du gelé non transférable, aucune evidence apparentée)" },
  "SHORT-01": { issue: "aucune", gold: null, acceptable: [], forbidden: [], no_answer: true, version: null, citation: null, motif: "IMAO : 0 occurrence au corpus, aucun contenu clinique" },
};

const geleIds = new Set(GELE.cas.map((c) => c.id));
const amendIds = new Set(Object.keys(AMENDEMENT));
const manquants = [...geleIds].filter((id) => !amendIds.has(id));
const intrus = [...amendIds].filter((id) => !geleIds.has(id));
if (manquants.length > 0 || intrus.length > 0) {
  console.error("COUVERTURE INCOMPLETE manquants=" + manquants.join(",") + " intrus=" + intrus.join(","));
  process.exit(1);
}

const cas = GELE.cas.map((g) => {
  const a = AMENDEMENT[g.id];
  return {
    id: g.id,
    requete: g.requete,
    langue: g.langue,
    issue: a.issue,
    gold: a.gold,
    acceptable: a.acceptable,
    hard_negatives: [],
    forbidden: a.forbidden,
    expected_no_answer: a.no_answer,
    expected_version: a.version,
    citation_contient: a.citation,
    motif: a.motif,
  };
});

const prod = {
  $comment: "M07 R0 — jugements de PRODUCTION v2026-09-15 (amendement versionné du gelé tests/eval/knowledge.golden.json, jamais écrasé). Requêtes/langues octet-identiques au gelé ; seuls les jugements sont amendés vers le corpus réel A+B. Champs identiques + motif (rationnel d'amendement par cas). 41 sans-réponse / 3 pertinents (libellés catalogue) / 2 faibles. wrong-drug/version/dose : NON EXERCABLES sur ce corpus (source catalogue unique, zéro supersédée, zéro dose) — code métrique inchangé pour les corpus futurs.",
  $meta: {
    artefact: "knowledge.golden.prod-2026-09-15.json",
    derive_de: "tests/eval/knowledge.golden.json (gelé R3-G, 46 cas, requêtes intactes)",
    corpus_version: "2026-09-15",
    sources: [
      { id: "13b4da2e-ae0c-51ff-b749-985e1c47f381", titre: "Budget de performance — un ecran, un appel", version: "2026-09-15" },
      { id: "e214a52c-ca50-5e5b-be02-ce29faaf0d91", titre: "Catalogue medicaments — libelles seuls, zero posologie", version: "2026-09-15" },
      { id: "08d9250c-8b47-5104-888f-025e51dd4298", titre: "Decisions — bornes non cliniques du poste de travail", version: "2026-09-15" },
      { id: "7cee2a4c-318c-5fa5-9b94-f5b7a37e7e95", titre: "Frontiere des donnees — Tiers 0/1/2/3", version: "2026-09-15" },
      { id: "92acae4a-0604-5367-862f-dc4f148e850a", titre: "Gabarits documentaires — cycle de vie sans donnees patient", version: "2026-09-15" },
      { id: "60e5569a-393c-5498-b058-ed7aa165b5ae", titre: "Schema — referentiel medicaments, sans posologie", version: "2026-09-15" },
    ],
    chunks_constates: 15666,
    inventaire: "base mindcare, role authenticated (lecture seule), 2026-09-16",
  },
  interdites: [],
  cas,
};

const sortie = join(RACINE, "tests", "eval", "knowledge.golden.prod-2026-09-15.json");
writeFileSync(sortie, JSON.stringify(prod, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: true, cas: cas.length, pertinents: cas.filter((c) => c.issue === "pertinent").length, faibles: cas.filter((c) => c.issue === "faible").length, sans_reponse: cas.filter((c) => c.issue === "aucune").length, sortie }));
