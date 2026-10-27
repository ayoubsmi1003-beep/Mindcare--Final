import { jetoniser } from "@/server/knowledge/rerank";
import { medicationNames } from "@/shared/alexa/medications";
import {knowledgeComparisonRequested} from './knowledge-evidence-content';
import { META_MOTS_LIVRE, planifierExpansionBilingue, VERSION_TERMINOLOGIE } from "@/server/knowledge/terminologie-bilingue";
// Titles observed in the approved local corpus. Aliases never approve a source.
const BOOKS = [
  { marker: /\bdsm(?:\s*-?\s*5)?\b/u,
    title: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux", language: "fr" },
  { marker: /\b(?:maudsley|taylor)\b/u,
    title: "The Maudsley Prescribing Guidelines in Psychiatry", language: "en" },
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
  "quels", "quelles", "comment", "explique", "expliquer", "parle", "parler", "dit", "dis", "dire",
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
  "pendant", "faire", "cas", "selon", "concernant",
  "واش", "يقول", "حسب", "اشرح", "شرح", "شنو", "وش", "كتاب", "مرجع", "مراجع", "chno", "wach", "3la",
]);

// Closed, literal retrieval aliases (FR / EN), not a diagnosis or translation model.
// Unknown clinical words remain in the query; no fallback to a guessed topic.
const ALIASES: Readonly<Record<string, readonly [string, string]>> = {
  criteres: ["criteres", "criteria"], diagnostiquer: ["criteres", "criteria"],
  traitement: ["traitement", "treatment"], traitements: ["traitements", "treatments"],
  trouble: ["trouble", "disorder"], troubles: ["troubles", "disorders"], bipolaire: ["bipolaire", "bipolar"],
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
  indesirables: ["indesirables", "adverse"], grave: ["grave", "severe"], graves: ["graves", "severe"],
  initiale: ["initiale", "initial"], initial: ["initial", "initial"],
  adolescent: ["adolescent", "adolescent"], adolescents: ["adolescents", "adolescents"],
  agee: ["agee", "elderly"], agees: ["agees", "elderly"],
  cible: ["cible", "level"], lithemie: ["lithemie", "lithium"], lithiemie: ["lithiemie", "lithium"],
  recommandee: ["recommandee", "recommended"], recommande: ["recommande", "recommended"],
  decrits: ["decrits", "described"], decrit: ["decrit", "described"],
  serotoninergique: ["serotoninergique", "serotonin"],
  serotonine: ["serotonine", "serotonin"],
  arreter: ["arreter", "stop"], arret: ["arret", "discontinuation"], eviter: ["eviter", "avoid"],
  antidepresseur: ["antidepresseur", "antidepressant"], antidepresseurs: ["antidepresseurs", "antidepressants"],
  titrer: ["titrer", "titrate"], titration: ["titration", "titration"],
  schizophrene: ["schizophrene", "schizophrenia"], antipsychotiques: ["antipsychotiques", "antipsychotics"],
  precautions: ["precautions", "precautions"], renales: ["renales", "renal"],
  agitation: ["agitation", "agitation"], aigue: ["aigue", "acute"], aigu: ["aigu", "acute"],
  syndrome: ["syndrome", "syndrome"], patient: ["patient", "patient"], patients: ["patients", "patients"],
  qt: ["qt", "qt"], prise: ["prise", "management"], charge: ["charge", "management"],
  frequence: ["frequence", "frequency"], signes: ["signes", "signs"], signe: ["signe", "sign"],
  mecanisme: ["mecanisme", "mechanism"], mecanismes: ["mecanismes", "mechanism"],
  metabolique: ["metabolique", "metabolic"], metaboliques: ["metaboliques", "metabolic"],
  cardiaque: ["cardiaque", "cardiac"], cardiaques: ["cardiaques", "cardiac"],
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
  readonly language: "fr" | "en" | "toutes";
  readonly sourceTitle: string | null;
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
  /** Legacy root-section chunks may contain comorbidity under the same locator. */
  readonly embeddedCriteriaOnly?: boolean;
  /**
   * Version de la couche de terminologie bilingue qui a produit ce plan.
   * Absent si aucune expansion n'a eu lieu. Trace d'audit de la requête.
   */
  readonly terminologieVersion?: string;
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/٫/gu, ".");
}

/** Local query planning only. SQL still decides approval, lifecycle and access. */
export function planKnowledgeQuery(question: string): KnowledgeQueryPlan | null {
  // Never truncate away a final book, population, dose or other restriction.
  if (question.length > 500) return null;
  let normalized = normalize(question);
  // Stahl is not yet qualified by the user. Its index and approvals remain untouched.
  if(/\bstahl\b/u.test(normalized))return null;
  // Only DSM-5 is observed locally. A different edition or text revision must
  // fail closed before its book label can be stripped or mapped to that source.
  for (const edition of normalized.matchAll(/\bdsm\s*-?\s*(\d+|[ivx]+)(?:\s*-?\s*(tr|r))?\b/gu)) {
    if (edition[1] !== "5" || edition[2]) return null;
  }
  const books = BOOKS.filter(book => book.marker.test(normalized));
  if (books.length > 1) return null; // No implicit substitution for a multi-book request.
  const book = books[0];
  const named = normalized.match(/(?:\b(?:selon|d['’]apres|according to)|حسب)\s+(?:(?:le|la|les|the)\s+)?(?:(?:livre|ouvrage|manuel|book|كتاب|مرجع)\s+)?([\p{L}\p{N}-]+)/u)?.[1];
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
  // Aucun livre nommé : on cherche dans les DEUX ouvrages. La requête
  // française ne peut pas matcher Taylor (anglais). On ajoute donc UNE
  // variante anglaise bornée, construite des seules réalisations connues +
  // invariants (médicament, nombre, unité). Jamais pour un livre français
  // nommé (là, la requête d'origine est la bonne).
  if (book === undefined) {
    // Traduction des SEULES formes dont une réalisation anglaise est connue ;
    // le reste (français inconnu) est écarté plutôt que de casser l'ET.
    const motsAnglais = termes
      .map((token) => ALIASES[token]?.[1] ?? token)
      .filter((token) => anglaisConnus.has(token) && !MOTS_FAIBLES_ANGLAIS.has(token));
    const nombres = tokens.filter((token) => /^[+-]?\d/u.test(token) || UNITES_INVARIANTES.has(token));
    // GARDE D'INTÉGRALITÉ : si un mot de CONTENU reste intraduisible, la
    // variante anglaise serait une question amputée (« prix lithium Algérie »
    // → « lithium »), et répondrait à côté. On ne l'ajoute pas.
    const nonTraduits = termes.filter((token) =>
      ALIASES[token] === undefined
      && !anglaisConnus.has(token)
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
    if (coeur.length >= 2 && requeteCoeur !== "" && requeteCoeur !== requeteAnglaise
      && !queries.includes(requeteCoeur)) {
      queries.push(requeteCoeur);
      references.push(requeteCoeur);
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
  // Type I must survive the baseline's one-letter token exclusion. A comparison
  // gets two exact lexical AND queries, never an OR query or a drug-only fallback.
  const typeI = /\btype\s+i\b/u.test(normalized);
  const typeII = /(?:\btype\s+ii\b|\b(?:et|vs|versus)\s+ii\b)/u.test(normalized);
  if (typeI && typeII) {
    const common = tokens.filter(token => !["type", "ii", "vs", "versus"].includes(token)).join(" ");
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
    [/\bepisode depressif caracterise\b/u,'trouble depressif caracterise'],
    [/\btrouble panique\b/u,'trouble panique'],
    [/\b(?:hypomanie|hypomaniaque)\b/u,'episode hypomaniaque'],
    [/\b(?:manie|maniaque)\b/u,'episode maniaque'],
    [/\bschizophrenie\b/u,'schizophrenie'],
    [/\banxiete generalisee\b/u,'anxiete generalisee'],
    [/\b(?:trouble obsessionnel[- ]compulsif|toc)\b/u,'trouble obsessionnel-compulsif'],
    [/\bstress post[- ]traumatique\b/u,'trouble stress post-traumatique'],
    [/\bdysphorique premenstruel\b/u,'trouble dysphorique premenstruel'],
    [/\b(?:trouble lie a l'usage|trouble de l'usage|usage d'une substance)\b/u,'trouble de l usage'],
  ];
  const recognizedFocuses=focusRules.filter(([pattern])=>pattern.test(normalized)).map(([,focus])=>focus);
  const sectionFocus=book?.language==='fr'&&(!comparison||recognizedFocuses.length===1)?recognizedFocuses[0]:undefined;
  const comparisonFocuses=book?.language==='fr'&&comparison?focusRules.filter(([pattern])=>pattern.test(normalized)).map(([,focus])=>focus):[];
  // Aucun livre nommé + entité diagnostique reconnue : on AJOUTE les requêtes
  // de rubrique (concept + « critères diagnostiques ») SANS poser
  // `sectionFocus`. Sans filtre, Taylor reste interrogeable ; avec la requête,
  // la rubrique DSM remonte au lieu de perdre un départage arbitraire entre
  // sections à couverture égale (mesuré : 5/5 partout, gagnant par hash).
  if (book === undefined && recognizedFocuses.length === 1 && !comparison) {
    const focus = recognizedFocuses[0] as string;
    const criteres = /\b(?:criteres|symptomes|signes|duree|combien)\b/u.test(normalized);
    for (const requete of [focus, criteres ? `${focus} criteres diagnostiques` : null]) {
      if (requete !== null && requete !== "" && !queries.includes(requete)) {
        queries.push(requete);
        references.push(requete);
      }
    }
  }
  // These two approved chapters contain their criteria directly under the topic heading.
  const embeddedCriteria=sectionFocus==='anxiete generalisee'||sectionFocus==='trouble obsessionnel-compulsif';
  const criteriaRequested=/\b(?:criteres|symptomes|signes)\b/u.test(normalized),descriptionRequested=/\b(?:definit|definir|definition|decrit|decrire)\b/u.test(normalized);
  const sectionLeaf = sectionFocus ? embeddedCriteria&&(criteriaRequested||descriptionRequested)?sectionFocus:!embeddedCriteria&&criteriaRequested?'criteres diagnostiques':!embeddedCriteria&&/\b(?:definit|definir|definition)\b/u.test(normalized)?'caracteristiques diagnostiques':undefined : undefined;
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
      : undefined);
  if(sectionFocus){
    const primary=[sectionFocus,embeddedCriteria&&criteriaRequested?'criteres diagnostiques':sectionLeaf].filter(Boolean).join(' ');
    if(!queries.includes(primary)){queries.push(primary);references.push(primary);}
    // In legacy root-locator chapters, common topic words can rank comorbidity
    // ahead of the actual criteria within the lexical candidate limit.
    if(embeddedCriteria&&criteriaRequested){const structured=sectionFocus+' a b';queries.push(structured);references.push(structured);}
  }
  if(comparisonFocuses.length>1)for(const primary of comparisonFocuses)if(!queries.includes(primary)){queries.push(primary);references.push(primary);}
  return { queries, references, relevanceQuery: queries.join(" "), language, sourceTitle: book?.title ?? null, ...(recognizedFocuses.length > 0 ? { focusHints: recognizedFocuses } : {}), ...(leafHint !== undefined ? { leafHint } : {}), ...(sectionFocus ? { sectionFocus } : {}), ...(comparisonFocuses.length>1?{sectionFocuses:comparisonFocuses}:{}), ...(sectionLeaf ? { sectionLeaf } : {}), ...(embeddedCriteria&&criteriaRequested?{embeddedCriteriaOnly:true}:{}), ...(bilingue.actif ? { terminologieVersion: bilingue.version } : {}) };
}
export const matchesSectionFocus=(section:string|null,focus:string)=>!!section&&normalize(section).split('›').some(part=>part.trim()===focus);

/** La feuille de section correspond-elle exactement à l'indice attendu ? */
export const matchesLeafHint=(section:string|null,leaf:string)=>!!section&&normalize(section).split('›').at(-1)?.trim()===leaf;

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
