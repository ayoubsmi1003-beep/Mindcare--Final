/**
 * `terminologie-bilingue.ts` — la COUCHE DE TERMINOLOGIE CLINIQUE FR↔EN.
 *
 * ═══ LE PROBLÈME MESURÉ ═══
 * Le Prescriber's Guide est en ANGLAIS ; l'Alexa est interrogée en FRANÇAIS ;
 * la porte de recherche est LEXICALE (`plainto_tsquery('simple', …)` = ET de
 * tous les termes). Une question française qui nomme le médicament ET le sujet
 * clinique (« posologie habituelle de l'olanzapine ») ne matche donc RIEN :
 * les mots français n'existent pas dans un texte anglais.
 *
 * Mesure (corpus `stahl-bilingue-v1`, 362 questions, VRAIE porte, chemin de
 * production `readKnowledge()`) :
 *   · question de contenu en anglais      → MRR 0,3679
 *   · question clinique complète en FR     → MRR 0,0455
 *   · question FR (sujet + médicament)     → MRR 0,0167
 *   · nom du médicament seul              → MRR 0,1989
 *
 * ═══ CE QUE C'EST ═══
 * Une table FERMÉE, VERSIONNÉE et SÉPARÉE du contenu source, qui associe un
 * CONCEPT CLINIQUE (français ou anglais) aux INTITULÉS DE RUBRIQUES RÉELS du
 * corpus ingéré. Le mot-clé : les réalisations anglaises ne sont pas un
 * vocabulaire médical inventé — ce sont les rubriques mesurées du livre
 * (`dosage-couverture.json`), donc chaque terme existe dans le texte indexé
 * et chaque requête ainsi bâtie peut effectivement matcher.
 *
 * Exemple mesuré : « posologie habituelle » → « Usual Dosage Range »,
 * « Dosing Tips », « How to Dose » — trois rubriques RÉELS, qui couvrent
 * 137 monographies sur 154 (89 %) au lieu des 30 d'une seule rubrique.
 *
 * ═══ CE QUE CE N'EST PAS (et ne sera jamais) ═══
 *   · PAS une traduction du livre : le livre reste en anglais, mot pour mot.
 *     Cette couche ne touche qu'UNE REQUÊTE, jamais une source, jamais une
 *     assertion, jamais une citation.
 *   · PAS une base de connaissances médicale : la table ne contient que des
 *     ÉQUIVALENCES DE RUBRIQUE, pas de contenu clinique. Aucun dosage, aucune
 *     recommandation, aucune assertion n'y figure.
 *   · PAS une décision clinique : la couche aide à OUVRIR la bonne rubrique ;
 *     elle ne décide pas de la réponse.
 *
 * ═══ GOUVERNANCE ═══
 *   · Version explicite (`VERSION_TERMINOLOGIE`) : toute évolution est un
 *     changement versionné, jamais une édition opportuniste.
 *   · Interrupteur global (`TERMINOLOGIE_BILINGUE_ACTIVE`) : le remettre à
 *     `false` neutralise TOUTE l'expansion, sans toucher au reste.
 *   · Retour arrière : ce module est le SEUL porteur de la table ; le retirer
 *     et annuler ses trois appels suffit à revenir à l'état antérieur.
 *   · Traçabilité : chaque correspondance porte son ORIGINE —
 *     `livre` (intitulé de rubrique mesuré dans le corpus) ou `lexique`
 *     (équivalent clinique français, sans rubrique correspondante). Un test
 *     vérifie que chaque réalisation `livre` existe bien dans le corpus
 *     indexé.
 */

import { jetoniser } from "./rerank";
import { medicationNames } from "@/shared/alexa/medications";

/** Noms de médicaments du référentiel fermé (comparaison en `string`). */
const MEDICAMENTS_CONNUS: ReadonlySet<string> = new Set<string>(medicationNames);

/** Unités identiques en français et en anglais (jamais un mot de contenu). */
const UNITES_INVARIANTES: ReadonlySet<string> = new Set([
  "mg", "g", "mcg", "ug", "ml", "kg", "ui", "iu", "%", "jour", "jours",
  "semaine", "semaines", "mois", "an", "ans",
]);

/** Plafond de requêtes produites par l'expansion (portes SQL bornées). */
const MAX_REQUETES_BILINGUES = 6;

/** Version de la table de terminologie — à changer à chaque évolution. */
export const VERSION_TERMINOLOGIE = "fr-en-clinique-v2" as const;

/**
 * Interrupteur global. `false` = aucune expansion, exactement le comportement
 * d'avant la couche (la couche est réversible en une ligne).
 */
export const TERMINOLOGIE_BILINGUE_ACTIVE = true;

/**
 * Origine d'une réalisation anglaise.
 * - `livre` : l'intitulé est une RUBRIQUE MESURÉE du corpus ingéré. Elle
 *   existe donc dans le texte indexé (vérifié par test).
 * - `lexique` : équivalent clinique français sans rubrique correspondante.
 *   Utile pour un mot de la question qui n'a pas de rubrique, mais jamais
 *   pour une affirmation clinique.
 */
export type OrigineRealisation = "livre" | "lexique";

export interface CorrespondanceTerminologie {
  /** Identifiant stable (traçabilité, ADR, rapport). */
  readonly id: string;
  /** Formes françaises reconnues (normalisées : minuscules, sans diacritiques). */
  readonly fr: readonly string[];
  /** Formes anglaises reconnues (normalisées). */
  readonly en: readonly string[];
  /**
   * Intitulés de rubrique du corpus (rubrique L3 mesurée). C'est le seul
   * vocabulaire qui EXISTE dans l'index : une requête bâtie dessus peut
   * donc effectivement matcher.
   */
  readonly rubriques: readonly string[];
  readonly origine: OrigineRealisation;
  /** Ce que la correspondance recouvre — pour la relecture, jamais pour la machine. */
  readonly note: string;
}

/**
 * La table.
 *
 * Les formes sont écrites comme elles apparaissent APRÈS normalisation
 * (minuscules, diacritiques retirés) : `planKnowledgeQuery` normalise la
 * question de la même façon.
 *
 * L'ordre des rubriques suit la COUVERTURE MESURÉE du corpus (la plus large
 * d'abord) : c'est la requête la plus probable qui est émise en premier.
 * Les formes PRÉCISES précèdent les formes larges (tri par longueur
 * décroissante à la reconnaissance) : « posologie habituelle » doit gagner
 * contre « posologie ».
 */
export const CORRESPONDANCES: readonly CorrespondanceTerminologie[] = [
  // ── Posologie ────────────────────────────────────────────────────────────
  // Les formes PRECISES d'abord : « posologie habituelle » est
  // « usual dosage range », PAS « dosing tips ». Une correspondance large
  // (« posologie ») ne sert que de repli, et n'est atteinte qu'après les
  // formes specifiques (tri par longueur decroissante des formes).
  {
    id: "posologie-habituelle",
    fr: ["posologie habituelle", "posologie usuelle", "fourchette posologique",
      "fourchette de posologie", "doses usuelles"],
    en: ["usual dosage range", "dose", "dosage"],
    rubriques: ["Usual Dosage Range"],
    origine: "livre",
    note: "rubrique « Usual Dosage Range » (30 monographies) — la forme exacte "
      + "de « posologie habituelle », pas la rubrique la plus large",
  },
  {
    id: "conseils-posologie",
    fr: ["conseils de posologie", "astuces de posologie", "conseils de dosage"],
    en: ["dosing tips"],
    rubriques: ["Dosing Tips"],
    origine: "livre",
    note: "rubrique « Dosing Tips » (114 monographies)",
  },
  {
    id: "comment-doser",
    fr: ["comment doser", "comment dose t on", "comment l administrer",
      "comment administrer", "mode d administration"],
    en: ["how to dose"],
    rubriques: ["How to Dose"],
    origine: "livre",
    note: "rubrique « How to Dose » (50 monographies)",
  },
  {
    id: "posologie-generique",
    fr: ["posologie", "dosage"],
    en: ["dose", "dosage"],
    rubriques: ["Dosing Tips", "How to Dose", "Usual Dosage Range", "Dosage Forms"],
    origine: "livre",
    note: "REPLI : le concept posologie sans precision. Les quatre rubriques "
      + "reelles qui portent une posologie, par couverture decroissante "
      + "(114 / 50 / 30 / 30 monographies) — l'union couvre 137 monographies "
      + "sur 154, la seule « Usual Dosage Range » n'en couvre que 30",
  },
  {
    id: "formes-pharmaceutiques",
    fr: ["formes pharmaceutiques", "formes galeniques"],
    en: ["dosage forms", "available formulations"],
    rubriques: ["Dosage Forms"],
    origine: "livre",
    note: "rubrique « Dosage Forms »",
  },
  {
    id: "surdosage",
    fr: ["surdosage"],
    en: ["overdose"],
    rubriques: ["Overdose"],
    origine: "livre",
    note: "rubrique « Overdose »",
  },
  {
    id: "arret-traitement",
    fr: ["arret du traitement", "comment arreter", "sevrage"],
    en: ["how to stop", "tapering", "discontinuation"],
    rubriques: ["How to Stop"],
    origine: "livre",
    note: "rubrique « How to Stop »",
  },
  {
    id: "pharmacocinetique",
    fr: ["pharmacocinetique", "pharmacodynamique"],
    en: ["pharmacokinetics"],
    rubriques: ["Pharmacokinetics"],
    origine: "livre",
    note: "rubrique « Pharmacokinetics »",
  },
  {
    id: "usage-long-cours",
    fr: ["usage prolonge", "utilisation prolongee", "traitement au long cours"],
    en: ["long-term use", "maintenance treatment"],
    rubriques: ["Long-Term Use"],
    origine: "livre",
    note: "rubrique « Long-Term Use »",
  },

  // ── Effets indésirables ──────────────────────────────────────────────────
  {
    id: "effets-indesirables",
    fr: ["effets indesirables", "effets secondaires", "effets indesirables possibles"],
    en: ["side effects", "adverse effects"],
    rubriques: ["Notable Side Effects"],
    origine: "livre",
    note: "rubrique « Notable Side Effects » (le L2 « Side Effects » est trop large)",
  },
  {
    id: "effets-indesirables-graves",
    fr: ["effets indesirables graves", "effets indesirables dangereux",
      "effets secondaires graves", "effets potentiellement mortels"],
    en: ["life-threatening side effects", "dangerous side effects", "serious adverse effects"],
    rubriques: ["Life-Threatening or Dangerous Side Effects"],
    origine: "livre",
    note: "rubrique « Life-Threatening or Dangerous Side Effects »",
  },
  {
    id: "effets-indesirables-notables",
    fr: ["effets indesirables notables", "effets secondaires notables"],
    en: ["notable side effects"],
    rubriques: ["Notable Side Effects"],
    origine: "livre",
    note: "rubrique « Notable Side Effects »",
  },
  {
    id: "conduite-effets",
    fr: ["que faire des effets indesirables", "conduite a tenir devant les effets indesirables"],
    en: ["what to do about side effects", "managing side effects"],
    rubriques: ["What to Do About Side Effects"],
    origine: "livre",
    note: "rubrique « What to Do About Side Effects »",
  },
  {
    id: "agents-appoint",
    fr: ["agents d appoint des effets indesirables", "traitement d appoint des effets indesirables"],
    en: ["best augmenting agents for side effects"],
    rubriques: ["Best Augmenting Agents for Side Effects"],
    origine: "livre",
    note: "rubrique « Best Augmenting Agents for Side Effects »",
  },
  {
    id: "prise-poids",
    fr: ["prise de poids", "gain de poids"],
    en: ["weight gain"],
    rubriques: ["Weight Gain"],
    origine: "livre",
    note: "rubrique « Weight Gain »",
  },
  {
    id: "sedation",
    fr: ["sedation", "somnolence"],
    en: ["sedation", "somnolence"],
    rubriques: ["Sedation"],
    origine: "livre",
    note: "rubrique « Sedation »",
  },
  {
    id: "mechanisme-effets",
    fr: ["mecanisme des effets indesirables"],
    en: ["how drug causes side effects"],
    rubriques: ["How Drug Causes Side Effects"],
    origine: "livre",
    note: "rubrique « How Drug Causes Side Effects »",
  },

  // ── Mécanisme, indication, action ────────────────────────────────────────
  {
    id: "mecanisme-action",
    fr: ["mecanisme d action", "comment agit le medicament", "mode d action"],
    en: ["how the drug works", "mechanism of action", "how does it work"],
    rubriques: ["How the Drug Works"],
    origine: "livre",
    note: "rubrique « How the Drug Works »",
  },
  {
    id: "delai-action",
    fr: ["delai d action", "delai d efficacite", "combien de temps pour agir"],
    en: ["how long until it works", "onset of action"],
    rubriques: ["How Long Until It Works"],
    origine: "livre",
    note: "rubrique « How Long Until It Works »",
  },
  {
    id: "indications",
    fr: ["indications", "indication principale", "pour quoi est prescrit"],
    en: ["commonly prescribed for", "indications"],
    rubriques: ["Commonly Prescribed for"],
    origine: "livre",
    note: "rubrique « Commonly Prescribed for »",
  },
  {
    id: "generique",
    fr: ["generique", "medicament generique"],
    en: ["generic", "generic name"],
    rubriques: ["Generic?"],
    origine: "livre",
    note: "rubrique « Generic? »",
  },

  // ── Populations spéciales ────────────────────────────────────────────────
  {
    id: "grossesse",
    fr: ["grossesse", "pendant la grossesse"],
    en: ["pregnancy", "in pregnancy"],
    rubriques: ["Pregnancy"],
    origine: "livre",
    note: "rubrique « Pregnancy »",
  },
  {
    id: "allaitement",
    fr: ["allaitement", "allaitement maternel", "allaite"],
    en: ["breast feeding", "breastfeeding", "nursing"],
    rubriques: ["Breast Feeding"],
    origine: "livre",
    note: "rubrique « Breast Feeding »",
  },
  {
    id: "enfants-adolescents",
    fr: ["enfants et adolescents", "population pediatrique", "chez l enfant"],
    en: ["children and adolescents", "pediatric", "in children"],
    rubriques: ["Children and Adolescents"],
    origine: "livre",
    note: "rubrique « Children and Adolescents »",
  },
  {
    id: "personnes-agees",
    fr: ["personnes agees", "sujet age", "chez le sujet age", "personne agee"],
    en: ["elderly", "in the elderly", "geriatric"],
    rubriques: ["Elderly"],
    origine: "livre",
    note: "rubrique « Elderly »",
  },
  {
    id: "insuffisance-renale",
    fr: ["insuffisance renale", "insuffisance renale severe", "precautions renales", "fonction renale", "renal", "renale", "rein", "reins"],
    en: ["renal impairment", "renal insufficiency", "renal"],
    rubriques: ["Renal Impairment"],
    origine: "livre",
    note: "rubrique « Renal Impairment » + formes génériques « rénal / rein » (Taylor est en chapitres, pas en monographies)",
  },
  {
    id: "insuffisance-hepatique",
    fr: ["insuffisance hepatique", "insuffisance hepatique severe"],
    en: ["hepatic impairment", "liver impairment"],
    rubriques: ["Hepatic Impairment"],
    origine: "livre",
    note: "rubrique « Hepatic Impairment »",
  },
  {
    id: "insuffisance-cardiaque",
    fr: ["insuffisance cardiaque", "maladie cardiaque"],
    en: ["cardiac impairment", "heart disease"],
    rubriques: ["Cardiac Impairment"],
    origine: "livre",
    note: "rubrique « Cardiac Impairment »",
  },

  // ── Interactions, précautions, dépendance ─────────────────────────────────
  {
    id: "interactions",
    fr: ["interactions medicamenteuses", "interactions avec d autres medicaments"],
    en: ["drug interactions", "interactions"],
    rubriques: ["Drug Interactions"],
    origine: "livre",
    note: "rubrique « Drug Interactions »",
  },
  {
    id: "contre-indications",
    fr: ["contre indications", "contre indications principales", "contre indications absolues",
      "contre indication", "contreindications", "contreindication"],
    en: ["do not use", "contraindications"],
    rubriques: ["Do Not Use"],
    origine: "livre",
    note: "rubrique « Do Not Use »",
  },
  {
    id: "precautions",
    fr: ["precautions", "mises en garde", "precautions particulieres", "avertissements"],
    en: ["other warnings", "precautions", "warnings and precautions"],
    rubriques: ["Other Warnings/Precautions"],
    origine: "livre",
    note: "rubrique « Other Warnings/Precautions »",
  },
  {
    id: "dependance",
    fr: ["dependance", "risque de dependance", "addiction"],
    en: ["habit forming", "dependence", "addiction"],
    rubriques: ["Habit Forming"],
    origine: "livre",
    note: "rubrique « Habit Forming »",
  },
  {
    id: "surveillance",
    fr: ["surveillance", "surveillance apres l initiation", "monitoring"],
    en: ["monitoring after starting", "monitoring"],
    rubriques: ["Monitoring after starting an atypical antipsychotic"],
    origine: "livre",
    note: "rubrique « Monitoring after starting an atypical antipsychotic »",
  },

  // ── Avantages / inconvénients ───────────────────────────────────────────
  {
    id: "avantages",
    fr: ["avantages", "interets"],
    en: ["potential advantages", "advantages"],
    rubriques: ["Potential Advantages"],
    origine: "livre",
    note: "rubrique « Potential Advantages »",
  },
  {
    id: "inconvenients",
    fr: ["inconvenients", "desavantages"],
    en: ["potential disadvantages", "disadvantages"],
    rubriques: ["Potential Disadvantages"],
    origine: "livre",
    note: "rubrique « Potential Disadvantages »",
  },
  {
    id: "changement-traitement",
    fr: ["changement de traitement", "switch therapeutique", "passage d un traitement a un autre"],
    en: ["the art of switching"],
    rubriques: ["The Art of Switching"],
    origine: "livre",
    note: "rubrique « The Art of Switching »",
  },
  {
    id: "art-psychopharmacologie",
    fr: ["art de la psychopharmacologie"],
    en: ["the art of psychopharmacology"],
    rubriques: ["The Art of Psychopharmacology"],
    origine: "livre",
    note: "rubrique « The Art of Psychopharmacology »",
  },
];

/**
 * Mots META du livre (la question parle de la STRUCTURE, pas de la clinique) :
 * « que dit la RUBRIQUE posologie ? » — « rubric » n'existe pas dans le
 * corpus et annulerait l'ET de la porte. Ils sont retires de la requête,
 * jamais du texte source.
 */
export const META_MOTS_LIVRE: ReadonlySet<string> = new Set([
  "rubrique", "rubriques", "section", "sections", "chapitre", "parties",
  "table", "tables", "tableau", "tableaux", "page", "pages", "figure", "figures",
  "livre", "livres", "ouvrage", "manuel", "source", "sources", "reference", "references",
]);

/**
 * Mots-outils DE LA QUESTION (français et anglais) : ils ne sont pas du
 * contenu clinique et n'existent pas dans le corpus indexe. Le planificateur
 * les retire déjà de la requête de base (`SCAFFOLD` + `MOTS_VIDES`) ;
 * l'expansion doit faire de même, sinon elle réintroduirait des mots qui
 * annulent l'ET de la porte.
 */
export const MOTS_OUTILS_QUESTION: ReadonlySet<string> = new Set([
  "quel", "quels", "quelle", "quelles", "quoi", "qui", "comment", "combien",
  "selon", "d apres", "suivant", "at", "by", "according",
  "est", "sont", "etre", "etait", "et", "ou", "de", "du", "des", "la", "le",
  "les", "un", "une", "au", "aux", "en", "dans", "pour", "par", "sur",
  "avec", "sans", "son", "sa", "ses", "leur", "leurs", "mon", "ma", "mes",
  "notre", "nos", "votre", "vos", "ce", "cet", "cette", "ces", "il", "elle",
  "ils", "elles", "on", "nous", "vous", "je", "tu", "te", "se", "y",
  "que", "quand", "comme", "si", "ne", "pas", "plus", "a", "ou",
  "dire", "dit", "dis", "sait", "savoir", "peut", "faire", "faut",
  "what", "which", "who", "whom", "whose", "how", "why", "when", "where",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does",
  "did", "has", "have", "had", "can", "could", "should", "would", "will",
  "shall", "may", "a", "an", "the", "and", "or", "of", "in", "on", "at",
  "by", "for", "with", "about", "into", "from", "up", "down", "out", "off",
  "over", "under", "then", "there", "here", "its", "it", "this", "that",
  "these", "those", "as", "than", "to", "tell", "says", "say", "does",
  "according", "book", "explain",
]);

/**
 * Les paires FR→EN que le planificateur traduit deja lui-meme (table
 * `ALIASES` de `knowledge-query.ts`). Si la question contient deja la forme
 * ANGLAISE d'une de ces paires, le planificateur a fait la traduction : la
 * requete de base est deja en anglais et l'expansion bilingue ne doit pas s'y
 * superposer (portes SQL inutiles + bruit dans le classement).
 *
 * Liste TENUE À LA MAIN et MIROIR de `ALIASES` : toute evolution de l'une
 * doit se refleter dans l'autre. Le test `terminologie-bilingue` verifie la
 * coherence des deux listes.
 */
export const ALIASES_PLANIFICATEUR_FR_EN: readonly (readonly [string, string])[] = [
  ["criteres", "criteria"],
  ["diagnostiquer", "diagnostiquer"],
  ["traitement", "treatment"],
  ["traitements", "treatments"],
  ["trouble", "disorder"],
  ["troubles", "disorders"],
  ["bipolaire", "bipolar"],
  ["schizophrenie", "schizophrenia"],
  ["anxiete", "anxiety"],
  ["symptomes", "symptoms"],
  ["enfants", "children"],
  ["adulte", "adult"],
  ["contre indications", "contraindications"],
];

/** Résultat de la planification bilingue. */
export interface PlanBilingue {
  /**
   * Requêtes candidates, une par rubrique de réalisation. Chaque requête est
   * bâtie sur le vocabulaire du CORPUS (donc effective) et ne contient que
   * des termes de contenu (médicament, population, quantité).
   */
  readonly requetes: readonly string[];
  /** Identifiants des concepts reconnus (traçabilité). */
  readonly concepts: readonly string[];
  /** Version de la table qui a produit ce plan. */
  readonly version: string;
  /** `false` quand la couche est désactivée ou qu'aucun concept n'a été reconnu. */
  readonly actif: boolean;
}

/** Plan vide : la couche est neutre. */
export const PLAN_BILINGUE_VIDE: PlanBilingue = {
  requetes: [],
  concepts: [],
  version: VERSION_TERMINOLOGIE,
  actif: false,
};

function echapper(regex: string): string {
  return regex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise une forme comme `planKnowledgeQuery` normalise la question :
 * minuscules, diacritiques retirés, espaces réduits. Les TIRETS et
 * APOSTROPHES deviennent des espaces : « dose-t-on » et « dose t on » sont
 * la même forme clinique.
 */
function normaliserForme(forme: string): string {
  return forme
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’ʼ-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Construit le motif de reconnaissance d'une forme : les mots sont séparés
 * par un ESPACE (`\s+`) — la question peut contenir n'importe quel nombre
 * d'espaces, et la forme peut contenir un tiret (normalisé en espace).
 */
function motifForme(forme: string): RegExp {
  const mots = normaliserForme(forme).split(" ").filter(Boolean);
  const corps = mots.map((m) => echapper(m)).join("\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${corps}([^\\p{L}\\p{N}]|$)`, "u");
}

/**
 * Planifie l'expansion bilingue d'une question DÉJÀ normalisée.
 *
 * Contrat :
 *   · la question d'origine n'est JAMAIS modifiée — l'expansion produit des
 *     requêtes ADDITIONNELLES ;
 *   · chaque forme reconnue n'est consommée qu'une fois (la plus longue
 *     d'abord) ;
 *   · la forme reconnue est RETIRÉE du reste : le concept français ne doit
 *     pas rester dans la requête, il annulerait l'ET de la porte ;
 *   · les autres termes (médicament, population, quantité) sont conservés.
 */
export function planifierExpansionBilingue(
  questionNormalisee: string,
  jetonsQuestion: readonly string[],
): PlanBilingue {
  if (!TERMINOLOGIE_BILINGUE_ACTIVE) return PLAN_BILINGUE_VIDE;
  const base = normaliserForme(questionNormalisee);
  if (base.length === 0) return PLAN_BILINGUE_VIDE;

  // Formes triées par longueur décroissante : « posologie habituelle » est
  // reconnue avant « posologie ». À longueur égale, l'ordre de la table
  // départage (stable).
  const formes = CORRESPONDANCES
    .flatMap((c) => [...c.fr.map((f) => ({ forme: f, c })),
      ...c.en.map((f) => ({ forme: f, c }))])
    .sort((a, b) => b.forme.length - a.forme.length);

  const consommes = new Set<string>();
  const rubriques: string[] = [];
  const generiques: string[] = [];
  const concepts: string[] = [];
  // Le RESTE de la question : on retire les formes reconnues, ET les mots
  // META du livre. Le reste porte le contenu : médicament, population,
  // quantité.
  let reste = base;

  for (const { forme, c } of formes) {
    if (consommes.has(c.id)) continue;
    if (!motifForme(forme).test(reste)) continue;
    // Si la FORME ANGLAISE du meme concept a ete reconnue dans la question
    // (et pas seulement une forme voisine), la question est deja formulee
    // dans le vocabulaire du corpus : l'expansion n'ajouterait que du bruit.
    // Le test porte sur la forme CHOSE, jamais sur le concept entier.
    if (c.en.includes(forme)) continue;
    // Si le planificateur a DEJA traduit le concept (alias FR→EN du
    // planificateur, ex. « contre-indications » → « contraindications »),
    // la requete de base est deja en anglais : l'expansion bilingue ne doit
    // pas s'y superposer. On detecte la trace de l'alias dans les jetons.
    // ATTENTION : on ne compare que la FORME ANGLAISE reellement produite par
    // l'alias du planificateur, pas toutes les formes anglaises du concept.
    const aliasPlanificateur = jetonsQuestion.some((j) => {
      const mots = j.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (mots.length === 0) return false;
      const joint = mots.join(" ");
      return ALIASES_PLANIFICATEUR_FR_EN.some(([, en]) => en === joint);
    });
    if (aliasPlanificateur) continue;
    consommes.add(c.id);
    concepts.push(c.id);
    for (const r of c.rubriques) if (!rubriques.includes(r)) rubriques.push(r);
    // La réalisation ANGLAISE générique (« side effects », « pregnancy ») est
    // une seconde clé de recherche : les intitulés de rubrique mesurés
    // appartiennent au Stahl, alors que Taylor est organisé en CHAPITRES.
    // Sans cette clé, une question française sur Taylor ne trouve rien
    // (mesuré : 4/4 des cas Maudsley en `sans-preuve`).
    for (const e of c.en) if (!generiques.includes(e)) generiques.push(e);
    // La forme reconnue est RETIREE du reste.
    reste = reste.replace(motifForme(forme), " ");
  }

  if (rubriques.length === 0) return PLAN_BILINGUE_VIDE;

  // Les mots META du livre (« rubrique », « section », « page »…) sont
  // eux aussi retires : ils ne sont pas dans le corpus et annuleraient l'ET.
  for (const meta of META_MOTS_LIVRE) reste = reste.replace(motifForme(meta), " ");
  // Idem pour les mots-outils DE LA QUESTION (« quelle », « est », « de »…) :
  // le planificateur les retire deja de la requete de base ; l'expansion doit
  // faire de meme, sinon elle reintroductionne des mots qui n'existent pas
  // dans le corpus et annulent l'ET de la porte.
  for (const outil of MOTS_OUTILS_QUESTION) reste = reste.replace(motifForme(outil), " ");

  // Les termes de contenu conserves : medicament, population, quantite.
  // On les extrait du RESTE (la chaine), pas des jetons du planificateur :
  // celui-ci produit des jetons multi-mots (l'alias « contreindications »
  // vaut « contre indications ») qui ne se comparent pas mot a mot.
  const contenu = [...new Set(reste.split(/[^\p{L}\p{N}]+/u).filter(Boolean))]
    .filter((j) => j.length >= 2 || /^\d+$/u.test(j));
  // Les quantites exactes du planificateur (doses signees, decimales) sont
  // conservees telles quelles : elles ne sont pas dans le texte source, mais
  // elles font partie de la question.
  for (const j of jetonsQuestion) {
    if (/^[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?$/u.test(j) && !contenu.includes(j)) contenu.push(j);
  }

  const requetes: string[] = [];
  // Requête pleine (toutes les contraintes conservées) PUIS requête
  // « entité + quantité » : sur un livre anglais, un seul mot français
  // résiduel (« contre indiquee ») annule l'ET de la porte. La variante
  // invariante ne garde que ce qui existe à l'identique dans les deux langues
  // (nom de médicament fermé, nombre, unité) — jamais une assertion clinique,
  // jamais une négation réécrite : elle ÉLARGIT la recherche, et la question
  // d'origine reste celle que lit la synthèse.
  const invariant = (jeton: string): boolean =>
    MEDICAMENTS_CONNUS.has(jeton)
    || /^[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?$/u.test(jeton)
    || UNITES_INVARIANTES.has(jeton);
  const invariants = contenu.filter(invariant);
  const variantes = (rubrique: string): string[] => {
    const pleine = [rubrique, ...contenu].join(" ");
    const minimale = [rubrique, ...invariants].join(" ");
    return minimale === pleine || invariants.length === 0 ? [pleine] : [pleine, minimale];
  };
  for (const r of [...rubriques, ...generiques]) {
    for (const requete of variantes(r)) {
      if (!requetes.includes(requete)) requetes.push(requete);
      if (requetes.length >= MAX_REQUETES_BILINGUES) break;
    }
    if (requetes.length >= MAX_REQUETES_BILINGUES) break;
  }
  if (requetes.length === 0) return PLAN_BILINGUE_VIDE;
  return { requetes, concepts, version: VERSION_TERMINOLOGIE, actif: true };
}

/**
 * Les rubriques(Intitulés de rubrique du corpus) listées par les
 * correspondances d'origine `livre` — la liste que le test de couverture
 * vérifie contre le corpus indexé.
 */
export function rubriquesDeOrigine(origine: OrigineRealisation): string[] {
  const sortie: string[] = [];
  for (const correspondance of CORRESPONDANCES) {
    if (correspondance.origine !== origine) continue;
    for (const r of correspondance.rubriques) if (!sortie.includes(r)) sortie.push(r);
  }
  return sortie;
}

/** Les concepts reconnus dans une question normalisée (traçabilité, tests). */
export function conceptsReconnus(questionNormalisee: string): string[] {
  const base = normaliserForme(questionNormalisee);
  const trouves: string[] = [];
  for (const correspondance of CORRESPONDANCES) {
    const formes = [...correspondance.fr, ...correspondance.en];
    if (formes.some((f) => motifForme(f).test(base))) {
      trouves.push(correspondance.id);
    }
  }
  return trouves;
}

/** Jetons d'une forme (utilitaire de test : exclusion des jetons du concept). */
export function jetonsDeForme(forme: string): string[] {
  return normaliserForme(forme).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Utilitaire : le nom du livre est-il dans la table ? (cohérence interne). */
export function rubricExiste(rubrique: string): boolean {
  return jetoniser(rubrique).length > 0;
}
