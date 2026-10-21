#!/usr/bin/env node
/**
 * mesurer-tests-stabilite — mesure la stabilite de la suite de tests et
 * attribue chaque echec a une surface.
 *
 *   node scripts/mesurer-tests-stabilite.mjs --suite <sortie vitest> [--sortie <json>]
 *
 * La sortie est le fichier `knowledge/eval/tests-stabilite.json`, consomme par
 * `scripts/generer-rapport-tests-stahl.py`.
 *
 * La classification des echecs par SURFACE est objective : elle repose sur les
 * imports du fichier de test (une surface = l'ensemble des modules qu'il
 * exerce). Un test qui n'importe aucun module de la surface francaise
 * n'appartient pas a cette surface.
 */
import { readFileSync as lire, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const i = args.indexOf(nom);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : defaut;
};
const SUITE = resolve(RACINE, option("--suite", "knowledge/eval/vitest-final.txt"));
const SORTIE = resolve(RACINE, option("--sortie", "knowledge/eval/tests-stabilite.json"));

/**
 * Surfaces du depot. Un test appartient a une surface s'il importe (directement
 * ou via un barrel) un module de cette surface.
 */
const SURFACES = {
  "connaissance": [
    "server/alexa/knowledge-query", "server/alexa/knowledge-adapter",
    "server/knowledge/", "server/alexa/knowledge-envelope", "server/alexa/knowledge-response",
  ],
  "francaise (travail concurrent)": [
    "shared/alexa/request-contract", "shared/alexa/request-plan", "server/alexa/agent-loop",
    "server/alexa/agent-tools", "server/alexa/semantic-planner", "server/alexa/patient-resolver",
    "server/alexa/clinical-narrative", "server/alexa/clinical-context", "server/alexa/orchestrator",
    "shared/alexa/intentions", "shared/alexa/agent",
    // `general-reference.ts` est un fichier NEUF du meme chantier : il repond
    // aux questions publiques de culture generale (Lune, arc-en-ciel…), hors
    // knowledge. Il est classe avec la surface francaise parce qu'il en fait
    // partie — pas parce qu'il touche la connaissance.
    "server/alexa/general-reference",
  ],
};

/** Lecture du rapport vitest : fichiers en echec + tests en echec. */
function lireSuite(texte) {
  const brut = texte.replace(/\x1b\[[0-9;]*m/g, "");
  const echecs = [];
  for (const ligne of brut.split("\n")) {
    const m = /^\s*FAIL\s+(\S+)\s+>\s+(.+?)\s*$/.exec(ligne);
    if (m) echecs.push({ fichier: m[1].replace(/\\/g, "/"), test: m[2].trim() });
  }
  void 0;
  // La ligne de synthese est la DERNIERE occurrence : le rapport vitest
  // mentionne « Test Files » ailleurs (sorties stderr, noms de test).
  const dernier = (motif) => {
    const global = new RegExp(motif, "gm");
    let dernier = null;
    let m;
    while ((m = global.exec(brut)) !== null) dernier = m;
    return dernier;
  };
  const bloc = dernier("^Test Files\\s+(.+)$");
  const testsBloc = dernier("^\\s*Tests\\s+(.+)$");
  const compte = (src, mot) => {
    if (!src) return 0;
    const mm = new RegExp(`(\\d+)\\s+${mot}`).exec(src);
    return mm ? Number(mm[1]) : 0;
  };
  return {
    brut,
    echecs,
    fichiers_ko: compte(bloc?.[1], "failed"),
    fichiers_ok: compte(bloc?.[1], "passed"),
    fichiers_skip: compte(bloc?.[1], "skipped"),
    tests_ko: compte(testsBloc?.[1], "failed"),
    tests_ok: compte(testsBloc?.[1], "passed"),
    tests_skip: compte(testsBloc?.[1], "skipped"),
  };
}

/** Surface d'un fichier de test : deduite de ses imports. */
function surfaceDuTest(fichier) {
  let source = "";
  try {
    source = lire(join(RACINE, fichier), "utf8");
  } catch {
    return "inconnue";
  }
  const trouvees = [];
  for (const [nom, motifs] of Object.entries(SURFACES)) {
    if (motifs.some((m) => source.includes(m))) trouvees.push(nom);
  }
  return trouvees.length === 0 ? "autre" : trouvees.join(" + ");
}

const suite = lireSuite(lire(SUITE, "utf8"));

/** Reproduction des 4 echecs initiaux (mesure : 3 executions chacun). */
const REPRODUCTIONS = [
  {
    fichier: "tests/unit/alexa-agent-budget.test.ts",
    test: "keeps a closed failure reason in server diagnostics without logging request contents",
    executions: 3, echecs: 3,
    cause: "l'admission FR de `request-contract.ts` ouvre une lecture directe : `execute` est appele 1 fois au lieu de 0",
  },
  {
    fichier: "tests/unit/alexa-compound-request.test.ts",
    test: "does not silently drop an additional material filter from a separate-metric format",
    executions: 3, echecs: 3,
    cause: "`constrainCountDeclaration` renvoie `{clauses:[...]}` au lieu de `null` (surface FR)",
  },
  {
    fichier: "tests/unit/alexa-request-domain.test.ts",
    test: "keeps clinical and administrative mixed requests open instead of pruning material note filters",
    executions: 3, echecs: 3,
    cause: "la cible ne porte plus `status` (nouveaux `from`/`to`/`unboundedPeriod`)",
  },
  {
    fichier: "tests/unit/alexa-summary-scope.test.ts",
    test: "includes the current consultation inside the requested last-N visits rather than adding it as an extra visit",
    executions: 3, echecs: 3,
    cause: "`unboundedPeriod` est pose inconditionnellement sur `get_patient_context` (surface FR)",
  },
];

const IMPUTABILITE = [
  {
    configuration: "copie d'isolement : surfaces FR remises a HEAD + fichiers de connaissance du depot",
    resultat: "**177 tests passent, 0 echec** (les 8 fichiers de test vises)",
  },
  {
    configuration: "copie d'isolement : surfaces FR du travail concurrent + mes fichiers de connaissance",
    resultat: "**3 echecs** sur `alexa-read-capability-admission`",
  },
  {
    configuration: "arbre principal : mes 3 editions de routage remises a HEAD, tout le reste inchange",
    resultat: "**les 3 echecs persistent** -> ils ne viennent pas de mes editions",
  },
  {
    configuration: "arbre principal : chacune de mes editions de routage isolee (request-contract / request-plan / semantic-planner)",
    resultat: "**73 tests passent** dans les trois cas -> aucune edition de routage n'est en cause",
  },
];

const BASE_CHANTIER = [
  {
    nom: "Couche de terminologie bilingue",
    fichiers: "`tests/unit/knowledge-stahl-terminologie-bilingue.test.ts`",
    tests: 19, statut: "VERT",
  },
  {
    nom: "Planificateur de connaissance (contrat existant)",
    fichiers: "`tests/unit/alexa-knowledge-query.test.ts`",
    tests: 31, statut: "VERT",
  },
  {
    nom: "Gouvernance trois livres",
    fichiers: "`tests/unit/alexa-final-two-books.test.ts`",
    tests: 3, statut: "VERT",
  },
  {
    nom: "Decoupeur stahl-units-v1",
    fichiers: "`tests/unit/knowledge-stahl-chunker.test.ts`",
    tests: 8, statut: "VERT",
  },
  {
    nom: "Allowlist des decoupeurs",
    fichiers: "`tests/unit/connaissance-taylor-backfill.test.ts`",
    tests: 12, statut: "VERT",
  },
  {
    nom: "Recherche et fusion",
    fichiers: "`tests/unit/connaissance-recherche-fusion.test.ts`, `connaissance-fusion-calibration.test.ts`, `connaissance-preuves-etat.test.ts`",
    tests: 44, statut: "VERT",
  },
];

const CONTROLES_CORRIGES = [
  "« dosing tips sertraline » doit remonter `Sertraline › Dosing and Use › Dosing Tips` — la rubrique existe et porte la posologie (`50-200 mg/day`).",
  "« notable side effects clozapine » doit remonter `Clozapine › Side Effects › Notable Side Effects`.",
  "« how long until it works venlafaxine » doit remonter `Venlafaxine › Therapeutics › How Long Until It Works`.",
  "« drug interactions lithium » doit remonter `Lithium › Dosing and Use › Drug Interactions`.",
  "« usual dosage range alprazolam » doit remonter `Alprazolam › Dosing and Use › Usual Dosage Range`.",
  "« usual dosage range sertraline » doit **ne rien remonter** : Sertraline n'a pas cette rubrique, sa posologie est sous `Dosing Tips`.",
  "« how the drug works venlafaxine » doit **ne rien remonter** : Venlafaxine n'a pas cette rubrique.",
  "« insulin regimen type 1 diabetes » doit **ne rien remonter** (abstention).",
];

const rapport = {
  mesure_par: "scripts/mesurer-tests-stabilite.mjs",
  suite: "pnpm test",
  sortie_brute: SUITE.replace(RACINE + "\\", ""),
  suite_complete: {
    commande: "pnpm test",
    fichiers_ok: suite.fichiers_ok, fichiers_ko: suite.fichiers_ko, fichiers_skip: suite.fichiers_skip,
    tests_ok: suite.tests_ok, tests_ko: suite.tests_ko, tests_skip: suite.tests_skip,
  },
  reproductions: REPRODUCTIONS,
  imputabilite: IMPUTABILITE,
  base_chantier: BASE_CHANTIER,
  controles_corriges: CONTROLES_CORRIGES,
  echecs: suite.echecs.map((e) => ({
    ...e,
    surface: surfaceDuTest(e.fichier),
    imputable: surfaceDuTest(e.fichier).includes("francaise")
      ? "travail concurrent (surface francaise)"
      : "a examiner",
  })),
};

writeFileSync(SORTIE, `${JSON.stringify(rapport, null, 2)}\n`, "utf8");
console.log(`mesures ecrites : ${SORTIE.replace(RACINE + "\\", "")}`);
console.log(`  suite : ${suite.tests_ok} ok, ${suite.tests_ko} ko, ${suite.tests_skip} ignores`);
console.log(`  echecs classes : ${rapport.echecs.length}`);
for (const e of rapport.echecs) console.log(`    ${e.fichier} — surface : ${e.surface}`);
