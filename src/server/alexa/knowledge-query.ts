import { jetoniser } from "@/server/knowledge/rerank";
import { medicationNames } from "@/shared/alexa/medications";
import {knowledgeComparisonRequested,requestedMedicationNames} from './knowledge-evidence-content';
import { requestedMonographNames } from "@/server/knowledge/monograph-roots";
import { BOOK_DISORDER_TERMS } from "@/shared/alexa/book-topics.generated";
import { cognatAnglais } from "@/server/knowledge/cognats";
import { META_MOTS_LIVRE, planifierExpansionBilingue, VERSION_TERMINOLOGIE } from "@/server/knowledge/terminologie-bilingue";
// Titles observed in the approved local corpus. Aliases never approve a source.
const BOOKS = [
  { marker: /\bdsm(?:\s*-?\s*5)?\b/u, label: "DSM-5",
    title: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux", language: "fr" },
  { marker: /\b(?:maudsley|taylor)\b/u, label: "Taylor",
    title: "The Maudsley Prescribing Guidelines in Psychiatry", language: "en" },
  // ADR-041 : troisième livre approuvé. Le titre doit rester IDENTIQUE à celui
  // écrit en base par le chargeur (la comparaison est normalisée des deux côtés).
  { marker: /(?:\bstahl\b|\bprescriber['’]s\s+guide\b)/u, label: "Stahl",
    title: "Prescriber's Guide (Stahl's Essential Psychopharmacology)", language: "en" },
] as const;

// Fermé : noms de médicaments du référentiel (jamais une invention).
const MEDICAMENTS_CONNUS: ReadonlySet<string> = new Set<string>(medicationNames);

/** Adjectifs/participes anglais sans valeur de recherche (jamais du contenu). */
const MOTS_FAIBLES_ANGLAIS: ReadonlySet<string> = new Set([
  "recommended", "described", "required", "used", "given", "performed",
  "reported", "observed", "considered", "including", "regarding",
]);

/** Verbes anglais génériques : ils décrivent l'intention (« stop », « avoid »),
 * jamais le contenu clinique. Dans une porte lexicale en ET, ils éliminent des
 * passages qui contiennent le médicament et le concept mais pas le verbe.
 * Retirés UNIQUEMENT de la variante anglaise minimale (jamais de la requête
 * d'origine, jamais du texte source, jamais de la synthèse). */
const VERBES_ANGLAIS_FAIBLES: ReadonlySet<string> = new Set([
  "stop", "avoid",
]);

/** Unités identiques en français et en anglais (jamais un mot de contenu). */
const UNITES_INVARIANTES: ReadonlySet<string> = new Set([
  "mg", "g", "mcg", "ug", "ml", "kg", "ui", "iu", "%",
]);

// Mots-outils de la QUESTION : ils ne sont pas du contenu clinique et
// n'existent pas dans le corpus indexe. La porte lexicale est un ET : un seul
// de ces mots dans la requete suffit a la faire echouer. Ils sont donc
// retires AVANT la porte, jamais du texte source.
const SCAFFOLD = new Set([
  "quels", "quelles", "qu", "comment", "explique", "expliquer", "parle", "parler", "dit", "dis", "dire",
  "definit", "definir", "decrit", "decrire", "decris", "donne", "donner", "presente", "presenter",
  "resume", "resumer", "figurent", "figure", "enumere", "enumerer", "distingue", "distinguer", "precise", "preciser",
  "montre", "selon", "apres", "livre", "livres", "ouvrage", "manuel", "references", "reference",
  "sources", "source", "difference", "compare", "comparer", "entre", "chez",
  "what", "which", "how", "explain", "tell", "says", "according", "to", "the", "of", "in", "and", "book",
  // Verbes et connecteurs de la question anglaise : « what does the book say
  // about X ? » — aucun de ces mots n'est du contenu clinique, et leur
  // presence rendrait la requete introuvable.
  "say", "does", "do", "did", "about", "shows", "show", "gives", "give", "means",
  "mean", "refers", "refer", "state", "states", "list", "lists", "describe",
  "describes", "mention", "mentions", "contain", "contains", "provide",
  "provides", "there", "here", "any", "all", "some", "same", "other", "others",
  // Mots de cadrage quantitatif français : ils demandent une quantité/durée,
  // ils ne décrivent pas le contenu. Dans une porte lexicale en ET, « combien »
  // ou « faut » suffit à rendre la requête introuvable (mesuré : 0 ligne).
  "combien", "faut",
  // Mots de liaison français sans contenu clinique : ils ne doivent pas
  // empêcher la variante anglaise (l'ET de la porte est strict).
  "pendant", "faire", "cas", "selon", "concernant", "avec", "emploi",
  "واش", "يقول", "حسب", "اشرح", "شرح", "شنو", "وش", "كتاب", "مرجع", "مراجع", "chno", "wach", "3la",
]);

// Closed, literal retrieval aliases (FR / EN), not a diagnosis or translation model.
// Unknown clinical words remain in the query; no fallback to a guessed topic.
const ALIASES: Readonly<Record<string, readonly [string, string]>> = {
  criteres: ["criteres", "criteria"], diagnostiquer: ["criteres", "criteria"],
  traitement: ["traitement", "treatment"], traitements: ["traitements", "treatments"],
  trouble: ["trouble", "disorder"], troubles: ["troubles", "disorders"], bipolaire: ["bipolaire", "bipolar"],
  tdah: ["tdah", "adhd"], entretien: ["entretien", "maintenance"], enfant: ["enfant", "children"],
  schizophrenie: ["schizophrenie", "schizophrenia"], anxiete: ["anxiete", "anxiety"],
  manie: ["maniaque", "mania"], hypomanie: ["hypomaniaque", "hypomania"],
  symptomes: ["symptomes", "symptoms"], enfants: ["enfants", "children"], adulte: ["adulte", "adult"],
  contreindications: ["contre indications", "contraindications"],
  // Termes de contenu fréquents : sans eux, une question française garde des
  // mots français dans la requête ANGLAISE et l'ET de la porte ne matche
  // jamais (mesuré : « risques ISRS grossesse » → 0 ligne chez Taylor).
  risque: ["risque", "risk"], risques: ["risques", "risks"],
  isrs: ["isrs", "ssri"], imao: ["imao", "maoi"],
  grossesse: ["grossesse", "pregnancy"], allaitement: ["allaitement", "breastfeeding"],
  posologie: ["posologie", "dosage"], dose: ["dose", "dose"], doses: ["doses", "doses"],
  renal: ["renal", "renal"], renale: ["renale", "renal"], rein: ["rein", "kidney"], reins: ["reins", "kidneys"],
  hepatique: ["hepatique", "hepatic"], sevrage: ["sevrage", "withdrawal"],
  interaction: ["interaction", "interaction"], interactions: ["interactions", "interactions"],
  surveillance: ["surveillance", "monitoring"], effets: ["effets", "effects"],
  precaution: ["precaution", "warnings"],
  indesirables: ["indesirables", "adverse"], grave: ["grave", "severe"], graves: ["graves", "severe"],
  initiale: ["initiale", "initial"], initial: ["initial", "initial"],
  adolescent: ["adolescent", "adolescent"], adolescents: ["adolescents", "adolescents"],
  agee: ["agee", "elderly"], agees: ["agees", "elderly"],
  cible: ["cible", "level"], lithemie: ["lithemie", "lithium"], lithiemie: ["lithiemie", "lithium"],
  recommandee: ["recommandee", "recommended"], recommande: ["recommande", "recommended"],
  decrits: ["decrits", "described"], decrit: ["decrit", "described"],
  serotoninergique: ["serotoninergique", "serotonin"],
  serotonine: ["serotonine", "serotonin"],
  // Same word in both languages once the accents are gone: without them the English variant is refused ("a content word stays untranslated").
  benzodiazepine: ["benzodiazepine", "benzodiazepine"], benzodiazepines: ["benzodiazepines", "benzodiazepines"],
  surveiller: ["surveiller", "monitoring"], antipsychotique: ["antipsychotique", "antipsychotic"],
  arreter: ["arreter", "stop"], arret: ["arret", "discontinuation"], eviter: ["eviter", "avoid"],
  antidepresseur: ["antidepresseur", "antidepressant"], antidepresseurs: ["antidepresseurs", "antidepressants"],
  titrer: ["titrer", "titrate"], titration: ["titration", "titration"],
  schizophrene: ["schizophrene", "schizophrenia"], antipsychotiques: ["antipsychotiques", "antipsychotics"],
  precautions: ["precautions", "warnings"], renales: ["renales", "renal"],
  agitation: ["agitation", "agitation"], aigue: ["aigue", "acute"], aigu: ["aigu", "acute"],
  syndrome: ["syndrome", "syndrome"], patient: ["patient", "patient"], patients: ["patients", "patients"],
  qt: ["qt", "qt"], prise: ["prise", "management"], charge: ["charge", "management"],
  frequence: ["frequence", "frequency"], signes: ["signes", "signs"], signe: ["signe", "sign"],
  agit: ["agit", "works"], agir: ["agir", "works"],
  action: ["action", "action"],
  diagnostiques: ["diagnostiques", "criteria"], diagnostique: ["diagnostique", "criteria"],
  majeure: ["majeure", "major"], majeur: ["majeur", "major"], generalisee: ["generalisee", "generalized"], generalise: ["generalise", "generalized"],
  messager: ["messager", "messenger"], messagers: ["messagers", "messenger"],
  intracellulaire: ["intracellulaire", "intracellular"], intracellulaires: ["intracellulaires", "intracellular"],
  mecanisme: ["mecanisme", "mechanism"], mecanismes: ["mecanismes", "mechanism"],
  metabolique: ["metabolique", "metabolic"], metaboliques: ["metaboliques", "metabolic"],
  cardiaque: ["cardiaque", "cardiac"], cardiaques: ["cardiaques", "cardiac"],
  regime: ["regime", "diet"], alimentaire: ["alimentaire", "dietary"], abus: ["abus", "abuse"],
  // Everyday words of a side-effect or use question ("prendre du poids", "le sucre dans le sang", "arrêter de fumer"): without their
  // English form a content word stays French and the English variant is refused. Each English word is in the books.
  poids: ["poids", "weight"], sucre: ["sucre", "glucose"], sang: ["sang", "blood"], foie: ["foie", "liver"], coeur: ["coeur", "cardiac"],
  croissance: ["croissance", "growth"], eruption: ["eruption", "rash"], peau: ["peau", "skin"], globules: ["globules", "cells"],
  blancs: ["blancs", "white"], tension: ["tension", "pressure"], epilepsie: ["epilepsie", "seizures"], convulsions: ["convulsions", "seizures"],
  fumer: ["fumer", "smoking"], tabac: ["tabac", "smoking"], cafe: ["cafe", "caffeine"], panique: ["panique", "panic"],
  synthese: ["synthese", "synthetic"], pic: ["pic", "peak"], somnambulisme: ["somnambulisme", "sleepwalking"],
  detournement: ["detournement", "misuse"], detournee: ["detournee", "misuse"], mesusage: ["mesusage", "misuse"],
  sanguin: ["sanguin", "blood"], sanguine: ["sanguine", "blood"],
  hematologique: ["hematologique", "haematological"], hematologiques: ["hematologiques", "haematological"],
  معايير: ["criteres", "criteria"], اكتياب: ["depression", "depression"], // hamza-normalized اكتئاب
  علاج: ["traitement", "treatment"], جرعة: ["dose", "dose"],
  اعراض: ["symptomes", "symptoms"], فصام: ["schizophrenie", "schizophrenia"], قلق: ["anxiete", "anxiety"],
  سيرترالين: ["sertraline", "sertraline"],
};

export interface KnowledgeQueryPlan {
  readonly queries: readonly string[];
  /**
   * Référence de classement PAR LOT, alignée sur `queries` : la requête `i`
   * est classée contre `references[i]`. Sans cela, un lot anglais (issu de
   * l'expansion bilingue) serait mesuré contre une référence française :
   * couverture ~0, score ~0, preuve jamais remontée.
   */
  readonly references: readonly string[];
  readonly relevanceQuery: string;
  /** Fewer-term retries for an empty lexical result, each ranked against the whole question. */
  readonly recoveryQueries?: readonly { readonly query: string; readonly reference: string }[];
  /** Section headings the question asks about. They order a drug's monograph, never filter it. */
  readonly aspectRubrics?: readonly string[];
  readonly language: "fr" | "en" | "toutes";
  readonly sourceTitle: string | null;
  /**
   * Libellé court du livre requis (`DSM-5`, `Taylor`, `Stahl`) : il sert à
   * réinjecter le bon marqueur quand l'outil appelant omet le nom du livre.
   * `null` = aucun livre nommé (recherche tous les livres approuvés).
   */
  readonly sourceLabel: string | null;
  readonly sectionFocus?: string;
  readonly sectionFocuses?: readonly string[];
  readonly sectionLeaf?: string;
  /**
   * Entités diagnostiques reconnues dans la question, MÊME quand aucun livre
   * n'est nommé. Ce ne sont PAS des filtres : elles servent au départage des
   * preuves à pertinence égale (mesuré : sections à couverture 5/5 ex æquo,
   * le gagnant sortait du hash du chunkId, pas de la question).
   */
  readonly focusHints?: readonly string[];
  /**
   * Rubrique FEUILLE attendue (« critères diagnostiques ») quand la question
   * demande des critères. Jamais un filtre ici : un départage. Mesuré : le lot
   * ciblé remontait la bonne rubrique, mais les 5 places étaient déjà prises
   * par le lot générique à score égal.
   */
  readonly leafHint?: string;
  /** The disorder whose criteria are asked: another disorder's criteria that merely mention it are not that leaf. */
  readonly leafSubject?: string;
  /** Legacy root-section chunks may contain comorbidity under the same locator. */
  readonly embeddedCriteriaOnly?: boolean;
  /**
   * Version de la couche de terminologie bilingue qui a produit ce plan.
   * Absent si aucune expansion n'a eu lieu. Trace d'audit de la requête.
   */
  readonly terminologieVersion?: string;
}

// What makes a disorder, asked in everyday words: what it is, how it shows, its thresholds of time or frequency, its forms, its onset.
const DISORDER_ITSELF=/\b(?:defini\w*|definition|designe\w*|appel\w*|recouvr\w*|signifi\w*|veut dire|c'est quoi|qu'est-ce qu\w*|consist\w*|manifest\w*|present\w*|tradui\w*|caracteris\w*|reconnai\w*|repere\w*|identifi\w*|evoqu\w*|poser|diagnostiqu\w*|retenir|retient|duree\w*|combien de temps|a partir de quand|a partir de quel\w*|frequence|combien de fois|fenetre|minimum|minimale|au moins|seuils?|formes?|sous-types?|variantes?|install\w*)\b/u;
// Another rubric of the manual, or a treatment: the criteria must not take its place.
const ANOTHER_RUBRIC=/\b(?:prevalen\w*|frequent(?:e|s|es)?|epidemiolog\w*|evolu\w*|pronostic\w*|facteurs?|risques?|cultur\w*|genre|sexe|suicid\w*|retentissement|consequences?|differentiel\w*|differenci\w*|comorbid\w*|associe\w*|marqueurs?|traitements?|traiter|prise en charge|medicament\w*|posolog\w*|doses?|causes?|origine)\b/u;
// The manual's own index terms, longest first; "dépersonnalisation/déréalisation" is named by either half.
const MANUAL_INDEX=BOOK_DISORDER_TERMS.flatMap(term=>term.split('/')).map(term=>({term,words:term.split(/[^\p{L}\p{N}-]+/u).filter(Boolean)})).sort((a,b)=>b.words.length-a.words.length||b.term.length-a.term.length);
/**
 * The disorder of the manual's index the question names, each term's words present in any order ("le jeu d'argent devient
 * pathologique"). Several terms add up ("personnalité" + "évitante"); a term inside a longer one found is not counted again.
 */
function manualDisorderTerm(normalized:string):string|undefined{
  const words=new Set(normalized.split(/[^\p{L}\p{N}-]+/u)),found:string[][]=[];
  for(const entry of MANUAL_INDEX)if(entry.words.every(word=>words.has(word))&&!found.some(longer=>entry.words.every(word=>longer.includes(word))))found.push(entry.words);
  return found.length?found.flat().join(' '):undefined;
}
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘]/gu, "'").trim()
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".");
}

/** Explicit source-location requests can be answered from a verified section/page pair. */
export function isKnowledgeLocationQuestion(question: string): boolean {
  const text = normalize(question);
  return /\b(?:dans\s+)?quel(?:le|s)?\s+(?:partie|section|rubrique|chapitre|page)s?\b/u.test(text)
    || /\b(?:ou|a)\s+(?:trouver|trouve|se\s+trouve|se\s+situe)\b/u.test(text)
    || /\bwhere\s+(?:in|can\s+i\s+find|do\s+i\s+find)\b|\bwhich\s+(?:part|section|chapter|page)\b/u.test(text);
}

/** Local query planning only. SQL still decides approval, lifecycle and access. */
/** The French manual's own wording for the conditions a doctor names in other words. Closed list; null when nothing applies. */
const MANUAL_TERMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:episodes?\s+depressifs?\s+majeurs?|troubles?\s+depressifs?\s+majeurs?|depressions?\s+(?:majeures?|caracterisees?|unipolaires?))\b/gu, "trouble depressif caracterise"],
  [/\b(?:troubles?\s+anxieux\s+generalises?|anxietes?\s+generalisees?)\b/gu, "anxiete generalisee"],
  [/\bdysthymies?\b/gu, "trouble depressif persistant"],
  [/\btdah\b/gu, "deficit attention hyperactivite"],
  [/\btoc\b/gu, "trouble obsessionnel compulsif"],
  [/\btspt\b/gu, "trouble stress post traumatique"],
];
/** Names a doctor gives a disorder whose section the focus rules know; used to recognise the focus only, never to rewrite a query. */
const FOCUS_ONLY_TERMS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:troubles?\s+)?bipolaires?\s+(?:de\s+)?(?:type\s+)?(?:ii|2|deux)\b/gu, "trouble bipolaire de type ii"],
  [/\b(?:troubles?\s+)?bipolaires?\s+(?:de\s+)?(?:type\s+)?(?:i|1)\b/gu, "trouble bipolaire de type i"],
];
export function frenchManualTerms(normalized: string): string | null {
  let changed = normalized;
  for (const [pattern, term] of MANUAL_TERMS) changed = changed.replace(pattern, term);
  return changed !== normalized ? changed : null;
}
export function planKnowledgeQuery(question: string): KnowledgeQueryPlan | null {
  // Never truncate away a final book, population, dose or other restriction.
  if (question.length > 500) return null;
  let normalized = normalize(question);
  // Only DSM-5 is observed locally. A different edition or text revision must
  // fail closed before its book label can be stripped or mapped to that source.
  for (const edition of normalized.matchAll(/\bdsm\s*-?\s*(\d+|[ivx]+)(?:\s*-?\s*(tr|r))?\b/gu)) {
    if (edition[1] !== "5" || edition[2]) return null;
  }
  const books = BOOKS.filter(book => book.marker.test(normalized));
  if (books.length > 1) return null; // No implicit substitution for a multi-book request.
  const book = books[0];
  const named = normalized.match(/(?:\b(?:selon|d['’]apres|according to)|حسب)\s+(?:(?:le|la|les|the)\s+)?(?:(?:livre|ouvrage|manuel|book|كتاب|مرجع)\s+)?(prescriber['’]s\s+guide|[\p{L}\p{N}-]+)/u)?.[1];
  const namedBook = normalized.match(/(?:\b(?:livre|ouvrage|book)|كتاب|مرجع)\s+(?:de\s+)?([\p{L}\p{N}-]+)/u)?.[1];
  // Mots qui NE sont PAS un nom de livre : verbes et connecteurs de la
  // question (« que dit le LIVRE de … », « what does the BOOK say about … »),
  // et mots STRUCTURELS (« le livre du TABLEAU », « the book SECTION »).
  // Sans eux, la garde « livre inconnu » confondait une tournure de question
  // avec le nom d'un livre et refusait la question sans raison.
  const generic = new Set(["references", "sources", "litterature", "criteres", "symptomes", "livres",
    "say", "says", "me", "dis", "dit", "contient", "mentionne", "parle", "donne",
    "tableau", "tableaux", "table", "tables", "chapitre", "section", "sections",
    "rubrique", "rubriques", "page", "pages", "figure", "figures",
    "the", "and", "for", "on", "in", "at", "with", "from", "to", "of", "us",
    "a", "an", "that", "this", "it", "its", "here", "there", "what", "which",
    "how", "why", "who", "about", "does", "do", "did", "means", "mean",
    // Connecteurs francais : « que dit le livre SUR … », « le livre DE LA … »
    "sur", "au", "aux", "en", "dans", "la", "le", "les", "un", "une", "du",
    "des", "que", "quoi", "quel", "quelle", "et", "ou", "mais", "donc", "alors",
    // « selon les recommandations », « selon l'âge » : aucun de ces mots ne nomme un livre.
    "recommandation", "recommandations", "guideline", "guidelines", "etudes", "etude", "experts", "expert", "auteurs",
    "age", "sexe", "poids", "gravite", "severite", "indication", "situation", "cas", "type", "dose", "patient", "patiente", "patients", "l", "d", "vous", "toi",
    "مراجع", "معايير"]);
  for (const name of [named, namedBook]) {
    if (name && !generic.has(name) && !BOOKS.some(known => known.marker.test(name))) return null;
  }
  if (book) normalized = normalized.replace(new RegExp(book.marker.source, "gu"), " ");
  normalized = normalized.replace(/ثنايي\s+(?:ال)?قطب/gu, "trouble bipolaire");
  normalized = normalized.replace(/\bcontre[-\s]+indications?\b/gu, "contreindications");
  const language = book?.language ?? "toutes";
  const english = language === "en";
  // The unchanged rank tokenizer drops one-digit, decimal and signed quantities.
  // Preserve their exact numeric lexemes at the SQL query boundary.
  const lexemes = normalized.match(/[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?|[\p{L}]+/gu) ?? [];
  const terms = lexemes.flatMap(token => /^[+-]?\d/u.test(token) ? [token] : jetoniser(token));
  const termes = [...new Set(terms.filter(token => !SCAFFOLD.has(token) && !MOTS_FAIBLES_ANGLAIS.has(token)))];
  const tokens = [...new Set(termes.map(token => ALIASES[token]?.[english ? 1 : 0] ?? token))]
    .filter((token) => !MOTS_FAIBLES_ANGLAIS.has(token));
  if (tokens.length === 0) return null;
  // Pour un livre ANGLAIS, un seul mot français résiduel annule l'ET de la
  // porte. On ne garde que les réalisations anglaises CONNUES et les
  // invariants (médicament fermé, nombre, unité) ; si le filtre vide tout, on
  // conserve la requête d'origine plutôt que de chercher dans le vide.
  const anglaisConnus = new Set([
    ...Object.values(ALIASES).flatMap(([, en]) => en.split(/\s+/u)),
    ...MEDICAMENTS_CONNUS,
  ]);
  const invariant = (token: string): boolean =>
    anglaisConnus.has(token)
    || /^[+-]?\d+(?:[.,]\d+)?(?:\/\d+)?$/u.test(token)
    || UNITES_INVARIANTES.has(token);
  const tokensRequete = english
    ? (() => { const gardes = tokens.filter(invariant); return gardes.length > 0 ? gardes : tokens; })()
    : tokens;
  // Une question qui ne porte QUE des mots META du livre (« que dit le livre
  // du tableau de la page 1109 ? ») n'a aucun terme de contenu : la porte
  // lexicale (un ET) ne peut rien matcher. On rend alors l'ANCRE DE PAGE
  // comme terme de recherche — le marqueur de page `[... p.NNN|src:NNN]` est
  // present dans le texte indexe. Sans cela, la question rendrait
  // « sans-preuve » au lieu de viser la page demandee.
  const metaSeulement = tokens.every(token => META_MOTS_LIVRE.has(token));
  if (metaSeulement) {
    const pages = lexemes.filter(l => /^\d+$/u.test(l));
    if (pages.length === 0) return null;
    tokens.push(...pages);
  }
  let queries = [tokensRequete.join(" ")];
  // Référence de classement PAR LOT : chaque requête est classée contre sa
  // PROPRE référence (celle qui l'a fait remonter). Sans cela, un lot anglais
  // serait mesuré contre une référence française : couverture ~0, score ~0,
  // et la preuve ne remonterait jamais.
  let references: string[] = [queries[0] as string];
  // Aucun livre nommé : on cherche dans toutes les sources approuvées.
  // Une requête française matche difficilement les sources anglaises
  // (Taylor et Stahl). On ajoute donc UNE
  // variante anglaise bornée, construite des seules réalisations connues +
  // invariants (médicament, nombre, unité). Jamais pour un livre français
  // nommé (là, la requête d'origine est la bonne).
  if (book === undefined) {
    // Traduction des SEULES formes dont une réalisation anglaise est connue ;
    // le reste (français inconnu) est écarté plutôt que de casser l'ET.
    // A glossary word, a word both languages share, or the English spelling of a French clinical word the books contain
    // ("myocardite" → "myocarditis", `cognats.ts`).
    const anglais = (token: string): string | undefined => ALIASES[token]?.[1] ?? (anglaisConnus.has(token) ? token : cognatAnglais(token));
    const motsAnglais = termes
      .map(anglais)
      .filter((token): token is string => token !== undefined && !MOTS_FAIBLES_ANGLAIS.has(token));
    const nombres = tokens.filter((token) => /^[+-]?\d/u.test(token) || UNITES_INVARIANTES.has(token));
    // GARDE D'INTÉGRALITÉ : si un mot de CONTENU reste intraduisible, la
    // variante anglaise serait une question amputée (« prix lithium Algérie »
    // → « lithium »), et répondrait à côté. On ne l'ajoute pas.
    const nonTraduits = termes.filter((token) =>
      anglais(token) === undefined
      && !UNITES_INVARIANTES.has(token)
      && !/^[+-]?\d/u.test(token));
    const requeteAnglaise = [...new Set([...motsAnglais, ...nombres])].join(" ");
    if (nonTraduits.length === 0 && motsAnglais.length > 0 && requeteAnglaise !== ""
      && !queries.includes(requeteAnglaise)) {
      queries.push(requeteAnglaise);
      references.push(requeteAnglaise);
    }
    // Variante « cœur » : sans les verbes génériques, pour les cas où le
    // passage clinique nomme le médicament et le concept mais pas l'intention
    // (« stop antidepressant avoid syndrome discontinuation » → aucun chunk ;
    // « antidepressant syndrome discontinuation » → chapitre 3 de Taylor).
    // Bornée, traçée comme les autres reformulations, jamais une question
    // amputée : elle exige au moins deux termes de contenu.
    const coeur = [...new Set([...motsAnglais.filter((t) => !VERBES_ANGLAIS_FAIBLES.has(t)), ...nombres])];
    const requeteCoeur = coeur.join(" ");
    // Compared with the queries sent, not with the full English variant: that one is not sent when a word stays untranslated,
    // and the core query was then dropped with it ("lithium abîme thyroïde" sent neither "lithium thyroid" query).
    if (coeur.length >= 2 && requeteCoeur !== "" && !queries.includes(requeteCoeur)) {
      queries.push(requeteCoeur);
      references.push(requeteCoeur);
    }
  }
  // "Withdrawal syndrome" is written "withdrawal" or "discontinuation" in the books: without the noun "syndrome" the same question finds the section.
  if (book === undefined) {
    const sansSyndrome = [...new Set(termes.map(token => ALIASES[token]?.[1] ?? token).filter(token => anglaisConnus.has(token) && !MOTS_FAIBLES_ANGLAIS.has(token) && !VERBES_ANGLAIS_FAIBLES.has(token) && token !== 'syndrome'))];
    const requeteSansSyndrome = sansSyndrome.join(' ');
    if (sansSyndrome.length >= 2 && /\b(?:withdrawal|discontinuation)\b/u.test(requeteSansSyndrome) && !queries.includes(requeteSansSyndrome)) {
      queries.push(requeteSansSyndrome);
      references.push(requeteSansSyndrome);
    }
  }
  // The doctor says "dépression majeure", the French manual writes "trouble dépressif caractérisé": a lexical gate in ET finds nothing
  // under the doctor's word. Add the manual's own term as one more query, never in place of the doctor's.
  if (book === undefined) {
    const manualTerms = frenchManualTerms(normalized);
    if (manualTerms) {
      const lexemesVariant = manualTerms.match(/[\p{L}]+/gu) ?? [];
      const termsVariant = [...new Set(lexemesVariant.flatMap(token => jetoniser(token)).filter(token => !SCAFFOLD.has(token) && !MOTS_FAIBLES_ANGLAIS.has(token)))];
      const variant = [...new Set(termsVariant.map(token => ALIASES[token]?.[0] ?? token))].join(" ");
      // First: the manual's own term is the query most likely to find the passage, and the doctor's wording finds noise beside it.
      // The French manual does not contain the doctor's wording, so that query can only add noise: it is replaced, the English one stays.
      if (variant && !queries.includes(variant)) { queries[0] = variant; references[0] = variant; }
    }
  }
  const recoveryQueries: { query: string; reference: string }[] = [];
  if (book === undefined) {
    const known = [...new Set(termes.map(token => ALIASES[token]?.[1] ?? token).filter(token => anglaisConnus.has(token) && !MOTS_FAIBLES_ANGLAIS.has(token)))];
    const unknown = termes.filter(token => ALIASES[token] === undefined && !anglaisConnus.has(token) && !UNITES_INVARIANTES.has(token) && !/^[+-]?\d/u.test(token));
    // Only a drug the books know can anchor a retry, so a retry never loses the subject of a
    // drug-less question: "dose de psilocybine" must not come back as another drug's dosing.
    // Known limit: an unknown word next to a known drug is still dropped from the retry.
    const reference = [...known, ...unknown].join(" "), anchor = requestedMedicationNames(question)[0] ?? requestedMonographNames(question)[0];
    const add = (query: string) => { if (query && !queries.includes(query) && !recoveryQueries.some(entry => entry.query === query) && recoveryQueries.length < 3) recoveryQueries.push({ query, reference }); };
    if (anchor) {
      if (unknown.length > 0 && known.length >= 2) add(known.join(" "));
      for (const other of known.filter(token => token !== anchor).slice(0, 2)) add(`${anchor} ${other}`);
      for (const other of unknown.filter(token => token !== anchor).slice(0, 1)) add(`${anchor} ${other}`);
    }
    // One filler word ("permettent", "retenir", "évoquent"...) empties the lexical AND. Retry once without question filler only
    // (verbs and connectors, never a medical word), so the retry never loses the subject.
    const FILLER = /^(?:permett\w*|retenir|evoqu\w*|equivau\w*|exist\w*|homolog\w*|provoqu\w*|frequent\w*|avant|debut\w*|faire|donner?|propos\w*|utilis\w*|attend\w*|reconnai\w*|correspond\w*|caracteris\w*|associe\w*|souvent|forcement|entrain\w*|peut|peuvent|doit|faut|ete|etre|avoir)$/u;
    const core = tokens.filter(token => !FILLER.test(token)), coreQuery = core.join(" ");
    if (core.length >= 2 && core.length < tokens.length && !queries.includes(coreQuery) && !recoveryQueries.some(entry => entry.query === coreQuery) && recoveryQueries.length < 3) recoveryQueries.push({ query: coreQuery, reference: tokens.join(" ") });
  }
  // The approved books often label monitoring requirements under "Tests".
  // Keep the literal monitoring query and add this bounded heading alternative.
  for (const query of [...queries]) {
    if (!/\bmonitoring\b/u.test(query)) continue;
    const testsHeadingQuery = query.replace(/\bmonitoring\b/gu, "tests");
    if (!queries.includes(testsHeadingQuery)) {
      queries.push(testsHeadingQuery);
      references.push(testsHeadingQuery);
    }
  }
  // Expansion bilingue gouvernée : le concept clinique (FR ou EN) est remplace
  // par les INTITULÉS DE RUBRIQUES REELS du corpus — le seul vocabulaire qui
  // existe dans l'index. Les requetes d'origine sont conservees : la couche
  // AJOUTE des candidats, elle n'en retire aucun.
  const bilingue = planifierExpansionBilingue(normalized, tokens);
  if (bilingue.actif && bilingue.requetes.length > 0) {
    queries = [...queries, ...bilingue.requetes];
    references = [...references, ...bilingue.requetes];
  }
  // Maudsley indexes the acute-agitation topic under this exact English heading.
  // A French "prise en charge" question otherwise leaves untranslated scaffolding
  // in the lexical AND query, so add the bounded heading query while preserving
  // the user's original wording. Do not apply this Maudsley heading to DSM or Stahl.
  if (/\bagitation\s+aigue\b/u.test(normalized) && (book === undefined || book.label === "Taylor")) {
    const acuteAgitationQuery = "acute agitation";
    if (!queries.includes(acuteAgitationQuery)) {
      queries.push(acuteAgitationQuery);
      references.push(acuteAgitationQuery);
    }
  }
  // Some approved English chapters use "How the Drug Works" where a French
  // question asks for a medication's mechanism of action. Preserve the literal
  // `action` query and add this heading variant only for all-English/invariant
  // terms, so it cannot become a mixed-language lexical AND query.
  if (book === undefined || book.language === "en") {
    for (const query of [...queries]) {
      if (!/\baction\b/u.test(query) || !query.split(/\s+/u).every(invariant)) continue;
      const worksHeadingQuery = query.replace(/\baction\b/gu, "works");
      if (!queries.includes(worksHeadingQuery)) {
        queries.push(worksHeadingQuery);
        references.push(worksHeadingQuery);
      }
    }
  }
  // Type I must survive the baseline's one-letter token exclusion. A comparison
  // gets two exact lexical AND queries, never an OR query or a drug-only fallback.
  const typeI = /\btypes?\s+i\b/u.test(normalized);
  const typeII = /(?:\btypes?\s+ii\b|\b(?:de|du|et|vs|versus)\s+(?:type\s+)?ii\b)/u.test(normalized);
  if (typeI && typeII) {
    const common = tokens.filter(token => !["type", "types", "ii", "vs", "versus"].includes(token)).join(" ");
    // Les lots d'expansion bilingue sont CONSERVES : la comparaison de types
    // ne doit pas supprimer les rubriques candidates du concept clinique.
    const conservees = references.slice(1);
    queries = [`${common} type i`, `${common} type ii`, ...conservees];
    references = [queries[0] as string, queries[1] as string, ...conservees];
  } else if (typeI) {
    const conservees = references.slice(1);
    queries = [`${queries[0]} i`, ...conservees];
    references = [queries[0] as string, ...conservees];
  }
  if (queries.some(query => query.length > 500)) return null;
  // An explicitly named diagnostic entity must not be substituted by a
  // differential diagnosis merely mentioning it in the body of another section.
  const comparison=knowledgeComparisonRequested(question);
  const focusRules:readonly (readonly [RegExp,string])[]=[
    [/\btrouble depressif caracterise\b/u,'trouble depressif caracterise'],
    [/\bepisode depressif(?: caracterise)?\b/u,'trouble depressif caracterise'],
    [/\btrouble bipolaire de type ii\b/u,'trouble bipolaire de type ii'],
    [/\btrouble bipolaire de type i\b/u,'trouble bipolaire de type i'],
    [/\btrouble panique\b/u,'trouble panique'],
    [/\b(?:hypomanie|hypomaniaque)\b/u,'episode hypomaniaque'],
    [/\b(?:manie|maniaque)\b/u,'episode maniaque'],
    [/\bschizophrenie\b/u,'schizophrenie'],
    [/\banxiete generalisee\b/u,'anxiete generalisee'],
    [/\b(?:trouble obsessionnel[- ]compulsif|toc)\b/u,'trouble obsessionnel-compulsif'],
    [/\bagoraphobie\b/u,'agoraphobie'],
    [/\bstress post[- ]traumatique\b/u,'trouble stress post-traumatique'],
    [/\bdysphorique premenstruel\b/u,'trouble dysphorique premenstruel'],
    [/\b(?:trouble lie a l[’']usage|trouble de l[’']usage|usage d[’']une substance)\b/u,"troubles de l'usage d'une substance"],
  ];
  // The manual's own name for the condition ("dépression majeure" → "trouble dépressif caractérisé"): the focus is a section of that manual.
  const focusNormalized=FOCUS_ONLY_TERMS.reduce((text,[pattern,term])=>text.replace(pattern,term),frenchManualTerms(normalized)??normalized);
  // Naming both bipolar types is a comparison, which keeps its own two queries: neither type is then "the" focus.
  const bothBipolarTypes=/\btypes?\s+i\b/u.test(normalized)&&/(?:\btypes?\s+ii\b|\b(?:de|du|et|vs|versus)\s+(?:type\s+)?ii\b)/u.test(normalized);
  const recognizedFocuses=focusRules.filter(([pattern])=>pattern.test(focusNormalized)).map(([,focus])=>focus).filter(focus=>!(bothBipolarTypes&&focus.startsWith('trouble bipolaire de type')));
  const locationRequest=isKnowledgeLocationQuestion(question)||/\b(?:localise|localiser|retrouve|trouve)\b[^.!?]{0,100}\b(?:passage|section|chapitre|page)\b/u.test(normalized)||/\blocalise\w*\b/u.test(normalized)||/\bou\s+est\s+(?:decrit|decrite|mentionne|mentionnee)\b/u.test(normalized);
  // A treatment question about this disorder must still reach Maudsley and Stahl.
  const focusedContent=['trouble depressif caracterise','trouble bipolaire de type ii','trouble bipolaire de type i'].includes(recognizedFocuses[0]??'')&&/\b(?:criteres?|symptomes?|signes?|duree|seuils?|definit|definir|definition|decrit|decrire)\b/u.test(normalized);
  const drugLocationFocus=locationRequest&&requestedMedicationNames(question).length>0&&!/\b(?:renal\w*|rein\w*|kidney\w*|hematolog\w*|neutrophil\w*|qt)\b/u.test(normalized)
    ? (/\b(?:mecanism\w*|agit|action\w*|fonctionn\w*)\b/u.test(normalized)?'how the drug works'
      :/\b(?:posologie|dose)\b/u.test(normalized)?'dosing tips'
        :/\b(?:cutan\w*|rash|grav\w*)\b/u.test(normalized)?'life-threatening or dangerous side effects'
          :/\b(?:metaboliqu\w*|poids|glycemie|diabete|moteur\w*|parkinson\w*|extrapyramid\w*)\b/u.test(normalized)?'notable side effects'
            :/\b(?:precaution\w*|mise en garde|avertissement\w*)\b/u.test(normalized)?'other warnings/precautions'
              :/\b(?:examens?|surveillance|bilan|tests?)\b/u.test(normalized)&&!/\b(?:hematolog|renal|rein)\b/u.test(normalized)?'tests'
                :undefined)
    : undefined;
  const sectionFocus=drugLocationFocus??(!comparison&&requestedMedicationNames(question).length===0&&(book?.language==='fr'||(!book&&(locationRequest||focusedContent)))?recognizedFocuses[0]:undefined);
  const comparisonFocuses=book?.language==='fr'&&comparison?focusRules.filter(([pattern])=>pattern.test(normalized)).map(([,focus])=>focus):[];
  // A disorder of the manual asked for what makes it ("à partir de quand", "comment se présente", "quelle fenêtre de temps"): its
  // diagnostic criteria answer, searched under the manual's own term, unless another rubric or a treatment is asked.
  const disorderTerm=book===undefined||book.language==='fr'?manualDisorderTerm(normalized):undefined;
  const disorderItself=!!disorderTerm&&!comparison&&requestedMedicationNames(question).length===0&&DISORDER_ITSELF.test(normalized)&&!ANOTHER_RUBRIC.test(normalized);
  if(disorderItself&&recognizedFocuses.length===0&&!sectionFocus){
    const requete=`${disorderTerm} criteres diagnostiques`;
    if(!queries.includes(requete)){queries.push(requete);references.push(requete);}
  }
  // Aucun livre nommé + entité diagnostique reconnue : on AJOUTE les requêtes
  // de rubrique (concept + « critères diagnostiques ») SANS poser
  // `sectionFocus`. Sans filtre, Taylor et Stahl restent interrogeables ; avec la requête,
  // la rubrique DSM remonte au lieu de perdre un départage arbitraire entre
  // sections à couverture égale (mesuré : 5/5 partout, gagnant par hash).
  if (book === undefined && recognizedFocuses.length === 1 && !comparison) {
    const focus = recognizedFocuses[0] as string;
    const criteres = disorderItself || /\b(?:criteres|symptomes|signes|duree|combien)\b/u.test(normalized);
    for (const requete of [focus, criteres ? `${focus} criteres diagnostiques` : null]) {
      if (requete !== null && requete !== "" && !queries.includes(requete)) {
        queries.push(requete);
        references.push(requete);
      }
    }
  }
  if (drugLocationFocus) {
    const medication = requestedMedicationNames(question)[0];
    const requete = medication ? `${medication} ${drugLocationFocus}` : drugLocationFocus;
    if (!queries.includes(requete)) {
      queries.push(requete);
      references.push(requete);
    }
  }
  // These two approved chapters contain their criteria directly under the topic heading.
  const embeddedCriteria=sectionFocus==='anxiete generalisee'||sectionFocus==='trouble obsessionnel-compulsif';
  // DSM substance criteria live at this topic heading without an A/B marker structure.
  const criteriaAtTopicSection=embeddedCriteria||sectionFocus==="troubles de l'usage d'une substance";
  const thresholdRequested=/\b(?:seuils?|duree|combien de temps|minimum temporel|periode minimale)\b/u.test(normalized);
 const criteriaWords=/\b(?:criteres|symptomes|signes)\b/u.test(normalized)||thresholdRequested,criteriaRequested=criteriaWords||disorderItself,descriptionRequested=/\b(?:definit|definir|definition|decrit|decrire)\b/u.test(normalized);
  const symptomFamiliesRequested=/\b(?:familles|groupes) de symptomes\b/u.test(normalized);
  // The strict leaf of a focused section keeps its own words (a named manual's "définit" is its "Caractéristiques diagnostiques").
  const sectionLeaf = sectionFocus ? criteriaAtTopicSection&&(criteriaWords||descriptionRequested)?sectionFocus:!criteriaAtTopicSection&&criteriaWords&&!symptomFamiliesRequested?'criteres diagnostiques':!criteriaAtTopicSection&&/\b(?:definit|definir|definition)\b/u.test(normalized)?'caracteristiques diagnostiques':undefined : undefined;
  // Indice de feuille pour un livre NON nommé : même logique, sans filtre.
  const leafHint = sectionLeaf !== undefined
    ? sectionLeaf
    : (recognizedFocuses.length === 1 && !comparison
      ? (() => {
          const focus = recognizedFocuses[0] as string;
          const criteresSousLeSujet = focus === 'anxiete generalisee' || focus === 'trouble obsessionnel-compulsif';
          if (criteresSousLeSujet) return criteresSousLeSujet && (criteriaRequested || descriptionRequested) ? focus : undefined;
          if (criteriaRequested) return 'criteres diagnostiques';
          return /\b(?:definit|definir|definition)\b/u.test(normalized) ? 'caracteristiques diagnostiques' : undefined;
        })()
      // A criteria question with no named disorder still prefers the "Critères diagnostiques" leaf (a tie-break, never a filter).
      : (!comparison && recognizedFocuses.length === 0 && (criteriaRequested || descriptionRequested || /\b(?:caracteris\w*|reconnai\w*|correspond\w*|repos\w*)\b/u.test(normalized)) ? 'criteres diagnostiques' : undefined));
  // A criteria or description question about a disorder no focus rule names: the DSM chunk to find opens "<Disorder> — critères diagnostiques —",
  // so ask for the subject words together with that aspect (the plain subject query fills its twenty places with other chunks).
  if(book===undefined&&!sectionFocus&&!comparison&&!disorderItself&&(criteriaWords||descriptionRequested||/\b(?:caracteris\w*|reconnai\w*|correspond\w*|repos\w*)\b/u.test(normalized))){
    const aspectWords=/^(?:criteres?|symptomes?|signes?|defini\w*|caracteris\w*|reconnai\w*|correspond\w*|repos\w*|diagnostic\w*|quoi|comment|qui|que|permett\w*|retenir|evoqu\w*)$/u;
    const subject=tokens.filter(token=>!aspectWords.test(token));
    if(subject.length>=1&&subject.length<=4){const aspectQuery=[...subject,'criteres diagnostiques'].join(' ');if(!queries.includes(aspectQuery)){queries.push(aspectQuery);references.push(aspectQuery);}}
  }
  if(sectionFocus){
    const primary=[sectionFocus,embeddedCriteria&&criteriaRequested?'criteres diagnostiques':sectionLeaf].filter(Boolean).join(' ');
    if(!queries.includes(primary)){queries.push(primary);references.push(primary);}
    // In legacy root-locator chapters, common topic words can rank comorbidity
    // ahead of the actual criteria within the lexical candidate limit.
    if(embeddedCriteria&&criteriaRequested){const structured=sectionFocus+' a b';queries.push(structured);references.push(structured);}
  }
  if(comparisonFocuses.length>1)for(const primary of comparisonFocuses)if(!queries.includes(primary)){queries.push(primary);references.push(primary);}
  return { queries, references, ...(recoveryQueries.length ? { recoveryQueries } : {}), ...(bilingue.rubriques?.length ? { aspectRubrics: bilingue.rubriques } : {}), relevanceQuery: queries.join(" "), language, sourceTitle: book?.title ?? null, sourceLabel: book?.label ?? null, ...(recognizedFocuses.length > 0 ? { focusHints: recognizedFocuses } : {}), ...(leafHint !== undefined ? { leafHint } : {}), ...(disorderItself && disorderTerm ? { leafSubject: disorderTerm } : {}), ...(sectionFocus ? { sectionFocus } : {}), ...(comparisonFocuses.length>1?{sectionFocuses:comparisonFocuses}:{}), ...(sectionLeaf ? { sectionLeaf } : {}), ...(embeddedCriteria&&criteriaRequested?{embeddedCriteriaOnly:true}:{}), ...(bilingue.actif ? { terminologieVersion: bilingue.version } : {}) };
}
export const matchesSectionFocus=(section:string|null,focus:string)=>!!section&&normalize(section).split('›').some(part=>part.trim()===focus);
/** La feuille de section correspond-elle exactement à l'indice attendu ? */
/** The DSM chunks open with "<Disorder> — <aspect> — …" (the aspect is not always the section leaf): true when that aspect is the one asked for. */
export const textOpensWithAspect=(text:string,aspect:string)=>new RegExp(`^[^—]{2,120}—\\s*${aspect}\\b`,'u').test(normalize(text));
export const matchesLeafHint=(section:string|null,leaf:string)=>!!section&&normalize(section).split('›').at(-1)?.trim()===leaf;
/**
 * The chunk belongs to that disorder: every word of its term in the heading that owns it, the words before the first "—" or the
 * section just above a "Critères diagnostiques" leaf. Never the chapter: "Troubles disruptifs" files several disorders.
 */
export const ownsLeafSubject=(section:string|null,text:string,subject:string)=>{
  const parts=normalize(section??'').split('›').map(part=>part.trim());
  const heading=`${normalize(text.split('—')[0]??'')} ${parts.length>1&&parts.at(-1)==='criteres diagnostiques'?parts.at(-2):''}`;
  return subject.split(/[^\p{L}\p{N}-]+/u).filter(Boolean).every(word=>heading.includes(word));
};

/**
 * Réinjecte le marqueur du livre requis quand l'outil appelant l'a omis.
 * Le libellé vient de `BOOKS` (jamais d'une liste recopiée) : DSM-5, Taylor
 * ou Stahl. Sans livre requis, la requête est rendue inchangée.
 */
export function requetePourLivreRequis(plan: KnowledgeQueryPlan, query: string): string {
  return plan.sourceLabel === null ? query : `${plan.sourceLabel} ${query}`;
}

/** Requested-book matching restricts already-governed rows; it grants no access. */
export function matchesRequestedBook(row: unknown, plan: KnowledgeQueryPlan): boolean {
  if (typeof row !== "object" || row === null || !("source_titre" in row) || typeof row.source_titre !== "string"
    || !BOOKS.some(book => normalize(book.title) === normalize(row.source_titre as string))) return false;
  if(plan.embeddedCriteriaOnly&&(!('texte' in row)||typeof row.texte!=='string'||!/(?:^|\s)A\.\s+\p{L}[\s\S]+(?:^|\s)B\.\s+\p{L}/u.test(row.texte)))return false;
  if (plan.sectionLeaf && !(typeof row === "object" && row !== null && "section" in row && typeof row.section === "string"
    && normalize(row.section).split("›").at(-1)?.trim() === plan.sectionLeaf)) return false;
  if (plan.sectionFocus && !(typeof row === "object" && row !== null && "section" in row && typeof row.section === "string"
    && matchesSectionFocus(row.section,plan.sectionFocus))) return false;
  if(plan.sectionFocuses&&!("section" in row&&typeof row.section==='string'&&plan.sectionFocuses.some(focus=>matchesSectionFocus(row.section as string,focus))))return false;
  if (plan.sourceTitle === null) return true;
  return typeof row === "object" && row !== null && "source_titre" in row
    && typeof row.source_titre === "string" && normalize(row.source_titre) === normalize(plan.sourceTitle);
}
