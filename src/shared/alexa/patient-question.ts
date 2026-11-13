import { mayBeAName, mentionsClinicalTopic, namedFrenchPeriod } from "./request-contract";

/**
 * A doctor asks about a patient in many ways ("Il prend quoi comme cachets ?", "Depuis quand je le suis ?",
 * "Un petit point sur lui ?"). Routing by whole sentences misses most of them, and the 1B model that
 * catches the rest takes minutes. This reads the MEANING of such a question from its concepts, never from
 * a phrase, and restates it as the closed question the audited read gates already answer:
 *
 *   concept words  →  one patient section (and a count)      who it is about  →  context patient | named patient
 *
 * It only rewrites. Every read still goes through its own gate, under the caller's rights, and the
 * canonical sentence is re-checked by the same name parser. A doubt returns no frame (the previous route, which asks); a name
 * the patient search does not know never becomes "the patient on screen" (capitalised, or no pronoun: no frame).
 * It never decides that a word is NOT a name unless a closed vocabulary knows that word.
 */
export type PatientSectionKey =
  | "summary" | "history" | "treatments" | "treatchanges" | "bounds" | "count" | "lastdate" | "firstdate" | "lastnote" | "firstnote" | "prev"
  | "nextappt" | "documents" | "scales" | "diagnoses" | "evolution" | "identity";
export interface PatientQuestion { readonly section: PatientSectionKey; readonly n?: number }
export type PatientSubject = { readonly kind: "context" } | { readonly kind: "named"; readonly name: string };

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘ʼ`]/gu, "'").replace(/\s+/gu, " ").trim();

// ── Concepts ──────────────────────────────────────────────────────────────────
const VISIT = /\b(?:la derniere fois|la premiere fois|venu\w*|revenu\w*|vu|vue|vus|voir|revoir|visites?|passe|passage|passages|consultations?|seances?|rendez-vous|rdv|vient|viens|viennent|suis|suit|suivi|consulte\w*)\b/u;
const PLURAL_VISIT = /\b(?:consultations|seances|visites|passages|rendez-vous|rdv)\b/u;
const COUNT = /\b(?:combien|nombre|total)\b/u;
const ALREADY = /\bdeja\b/u;
const LAST = /\b(?:derni(?:er|ere|eres|ers)|la derniere fois|recent\w*|dernierement)\b/u;
const FIRST = /\b(?:premi(?:er|ere|eres|ers)|toute premiere|depuis quand|au debut)\b/u;
const PREVIOUS = /\b(?:precedent\w*|d'avant|anterieur\w*|passees?|d'hier)\b/u;
const DATE_CUE = /\b(?:quand|date|dates|quel jour|a quelle date)\b/u;
const TREAT = /\b(?:traitements?|medicaments?|medocs?|ordonnances?|prescriptions?|prescrit\w*|cachets?|comprimes?|gelules?|posologie|doses?|molecules?|prend\w*|prenait|prenaient|prendre|pris|sous quoi)\b/u;
const HISTORY = /\b(?:historiques?|parcours|retrace\w*|antecedents?)\b/u;
const EVOLVE = /\b(?:evolu\w*|evolution)\b/u;
const SUMMARY = /\b(?:resum\w*|synthese|essentiel|dois-je savoir|dois savoir|faut savoir|faut-il savoir|ou on en est|ou en est-on|on en est ou|points? (?:importants?|cles?)|a retenir|sait|on a sur|qu'a-t-on|avons[- ]nous sur|savons[- ]nous|savez[- ]vous|informations?|infos?|dossier|presente\w*|ou en est|quoi de neuf|nouvelles|petit point|le point|fiche|parle(?:s|z)?(?:-moi)?|ce que (?:tu|vous) (?:as|avez))\b/u;
const DOCS = /\b(?:documents?|certificats?)\b/u;
const SCALES = /\b(?:echelles?|scores?|phq|gad|questionnaires?)\b/u;
const DIAG = /\bdiagnostics?\b/u;
const NEXT = /\b(?:prochain\w*|revient|reviendra|reconvoqu\w*|reprogramm\w*|programme\w*|prevus?|prevues?|planifie\w*|a venir)\b/u;
// A treatment's history in the doctor's words: "a bougé", "augmentée", "dose de départ", "l'historique de ses prescriptions".
const CHANGED = /\b(?:avant|change\w*|modifi\w*|ancien\w*|prenait|prenaient|precedemment|auparavant|bouge\w*|augment\w*|diminu\w*|baiss\w*|ajust\w*|initial\w*|de depart|au depart|au debut|depuis le debut|historiques?|evolu\w*|retrace\w*)\b/u;
// The person in front of the doctor: "qui est en face de moi", "la personne que j'ai devant moi", "de qui s'agit-il".
const WHO =/\bqui est (?:ce|cette|le|la) (?:patient|patiente|malade)\b|\bqui (?:j'ai|ai-je|est|se trouve) (?:en face|devant moi)\b|\b(?:la personne|le patient|la patiente) que j'ai (?:en face|devant moi)\b|\bde qui s'agit-il\b/u;

// ── Who it is about ───────────────────────────────────────────────────────────
const PRONOUN_CUE = /\b(?:il|elle)\b(?!\s+(?:y\s+a|faut|existe|s'agit|suffit|reste|se\s+peut|vaut))|\blui\b|\b[a-z]+-(?:t-)?(?:il|elle)\b|\b(?:son|sa|ses)\b|\bce (?:patient|malade|monsieur|dernier)\b|\bcette (?:patiente|malade|dame|personne)\b|\b(?:le|la) (?:patient|patiente|malade)\b|\b(?:l'ai-je|l'ai je)\b|\bje l'ai\b|\bje (?:le|la) (?:ai|avais|vois|revois|suis|connais)\b|\bje (?:le|la|l') ?(?:suis|vois|revois|connais|ai vu|ai vue)\b|\b(?:le|la) (?:voir|revoir|suivre)\b|\b(?:le|la) [a-z]+-(?:t-)?on\b|\bl'[a-z]+-(?:t-)?on\b|\b(?:celui|celle)-(?:ci|la)\b|\b(?:le|la) (?:faire|fasse|fais) (?:entrer|venir|monter)\b/u;
const NOT_THE_PATIENT = /\b(?:mere|pere|frere|soeur|epoux|epouse|conjoint\w*|fils|fille|famille|parents?|enfants?|amis?|proches?)\b/u;
const GROUP_SCOPE = /\b(?:patients|patientes|(?:du|de tout le|dans tout le|de l'ensemble du|pour tout le) cabinet|agenda|planning|tous|toutes|recettes?|impayes?)\b/u;
const CALENDAR_SCOPE = /\b(?:aujourd'hui|demain|hier|semaine|semaines|mois|annee|matin|soir|midi|apres-midi)\b/u;
// A rank among visits ("la dernière séance", "les trois dernières fois") is not a calendar period.
const RANKED_VISIT = /\b(?:\d+ |deux |trois |quatre |cinq )?(?:avant-)?(?:derni\w*|preced\w*|prochain\w*|premi\w*)\s+(?:seances?|consultations?|visites?|fois|rendez-vous|rdv|notes?|entretiens?|passages?)\b|\bla (?:derniere|premiere|prochaine) fois\b/gu;
const PERIOD_WORD = /\b(?:(?:19|20)\d{2}|an|annees?|mois|semaines?|trimestres?|semestres?|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|aujourd'hui|avant-hier|hier|apres-demain|demain|entre|jusqu\w*)\b|\bdepuis (?!quand\b|combien\b|(?:le |son |leur )?debut\b(?!\s+(?:du|de la|de l'|de cette|de ce)\b))|\d{1,2}\/\d{1,2}/u;
/** Whether the question names a calendar period: read (its bounds), unreadable, or none. */
function namedPeriod(text: string, asOf: string | undefined): { from: string; to: string } | "unreadable" | null {
  // "Depuis combien d'années ?" asks a duration, not over which period.
  if (!PERIOD_WORD.test(fold(text).replace(RANKED_VISIT, " ").replace(/\b(?:depuis|il y a) combien (?:de |d')\w+/gu, " ").replace(/\b(?:depuis|a partir de) (?:la|le) (?:plus )?(?:recent\w*|derni\w*|premi\w*)\b/gu, " "))) return null;
  return namedFrenchPeriod(text, asOf) ?? "unreadable";
}
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const lastDay = (iso: string) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** The bounds in the form the admission reads back: "du 01/01/2025 au 31/12/2025" (inclusive). */
export const periodWords = (period: { from: string; to: string }) => `du ${shortDate(period.from)} au ${shortDate(lastDay(period.to))}`;
/** Words of the frame itself; anything else Latin and unknown to the question vocabularies may be a name. */
const FRAME_WORDS = /^(?:alexa|cabinet|clinique|dates|periode|cote|celui-ci|celle-ci|celui-la|celle-la|consulte|consultee|consultes|consulter|reprise|reprises|dis|dites|moi|me|stp|svp|plait|merci|oui|non|et|ou|mais|donc|alors|aussi|bien|bon|ben|euh|ah|tu|vous|peux|pouvez|peut|pourrais|pourriez|voudrais|veux|souhaite|sais|savez|sait|dire|rappelle|rappeler|rappelez|montre|montrer|affiche|afficher|donne|donner|fais|faire|fait|vois|voir|trouve|cherche|ouvre|passe|passons|reviens|revenons|maintenant|encore|aussi|toujours|petit|petite|gros|grand|beaucoup|peu|moins|plus|tres|trop|ici|la|là|quoi|comme|comment|quand|combien|quel|quelle|quels|quelles|qui|que|qu|dont|ceci|cela|ca|ce|cet|cette|ces|celui|celle|ceux|celles|mon|ma|mes|notre|nos|votre|vos|son|sa|ses|leur|leurs|il|elle|ils|elles|lui|eux|je|j|nous|on|y|en|le|les|un|une|des|du|de|d|au|aux|sur|sous|dans|chez|par|pour|avec|sans|selon|vers|entre|apres|avant|depuis|pendant|jusqu|est|sont|etait|etaient|ete|etre|a|ai|as|avons|avez|ont|avait|avaient|eu|eues|eue|aurait|va|vont|faut|doit|dois|dit|dire|ces|temps|fois|moment|jour|jours|toute|tous|tout|toutes|rien|chose|choses|truc|machin|cas|monde|gens|personne|personnes|mme|mlle|madame|mademoiselle|monsieur|docteur|dr|patient|patiente|patients|malade|dossier|fiche|etat|situation|nouvelles|essentiel|point|points|resume|synthese|informations|information|infos|info|historique|parcours|traitement|traitements|medicament|medicaments|medocs|cachets|comprimes|gelules|ordonnance|prescription|posologie|dose|doses|molecule|molecules|consultation|consultations|seance|seances|visite|visites|rendez|vous|rdv|dernier|derniere|dernieres|derniers|premier|premiere|premieres|premiers|precedent|precedente|precedentes|precedents|recent|recente|recentes|recents|prochain|prochaine|actuel|actuelle|actuellement|avant|apres|deja|jamais|evolue|evolution|diagnostic|diagnostics|echelle|echelles|score|scores|document|documents|certificat|certificats|venu|venue|venus|vu|vue|vus|recu|recue|recus|recues|recevoir|recoit|passe|suis|suit|suivi|suivre|sais|savoir|parle|parler|raconte|retrace|prend|prends|prenait|pris|sous|noter|note|ecrit|ecrits|ecrite|ecrites|consigne|consignee|dit|dits|parle|parles|presente|presentes|resume|resumes|explique|dresse|indique|indiquer|vient|revient|reviendra|deux|trois|quatre|cinq|autant|exactement|vraiment|seulement|concernant|propos|sujet)$/u;

const NUMBER_WORDS: Record<string, number> = { deux: 2, trois: 3, quatre: 4, cinq: 5, "2": 2, "3": 3, "4": 4, "5": 5, deuxieme: 2, second: 2, seconde: 2, troisieme: 3, quatrieme: 4, cinquieme: 5 };
// A visit ranked before the last one: "l'avant-dernière", "juste avant sa dernière", "la troisième en remontant". The latest-visits list holds it.
const BEFORE_LAST = /\bavant-derni\w*|\bavant (?:sa|la|son|leur) derni\w*|\b(deuxieme|second|seconde|troisieme|quatrieme|cinquieme)\b[^?]*\b(?:en remontant|en partant de la fin|avant la derniere|depuis la (?:plus )?recente)\b/u;
// How long the patient has been followed is the date of the first visit, not a number of visits.
const SINCE_HOW_LONG = /\bdepuis combien (?:de temps|d'annees|d'ans|de mois)\b/u;
const requestedCount = (plain: string) => {
  const match = /\b(deux|trois|quatre|cinq|[2-5])\s+derni\w*/u.exec(plain);
  return match ? NUMBER_WORDS[match[1]!] ?? 3 : 3;
};

/** What the question asks about the patient, from its concepts only. Null when it asks about no patient section. */
export function classifyPatientQuestion(text: string): PatientQuestion | null {
  const p = fold(text);
  if (WHO.test(p) || /\b(?:profil|identite|age)\b/u.test(p)) return { section: "identity" };
  if (SCALES.test(p)) return { section: "scales" };
  if (DIAG.test(p)) return { section: "diagnoses" };
  if (DOCS.test(p)) return { section: "documents" };
  // Every appointment, past and to come, is the record's history, not only the next one.
  if (/\b(?:passe\w*|anterieur\w*) et (?:a venir|futur\w*|prevu\w*)\b|\b(?:tous|l'ensemble de) (?:ses|les) (?:rendez-vous|rdv)\b/u.test(p)) return { section: "history" };
  // Any word of a visit ("la prochaine fois qu'il vient", "son prochain passage", "attendu quand") names the next appointment.
  if (NEXT.test(p) && (VISIT.test(p) || /\b(?:revien\w*|repass\w*|reconvoqu\w*|attendue?s?)\b/u.test(p))) return { section: "nextappt" };
  // "Il vient quand ?", "a-t-elle un rendez-vous ?": coming, or holding an appointment, in the present is the next one.
  if (!LAST.test(p) && !PREVIOUS.test(p) && !FIRST.test(p) && (/\b(?:vient|viennent|viendra|viendront|passera|repasse)\b[^?]*\bquand\b|\bquand\b[^?]*\b(?:vient|viennent|viendra|viendront|passera|repasse)\b/u.test(p)
    || /\b(?:a|a-t-il|a-t-elle|ont-ils|ont-elles)\s+(?:bien\s+|toujours\s+|encore\s+)?(?:un\s+)?(?:rendez-vous|rdv)\b/u.test(p))) return { section: "nextappt" };
  // "son traitement précédent", "a-t-il changé de traitement", "il prenait quoi avant": the recorded changes, not the current state.
  if (TREAT.test(p) && (PREVIOUS.test(p) || CHANGED.test(p))) return { section: "treatchanges" };
  if (TREAT.test(p)) return { section: "treatments" };
  // "Combien de fois en tout ?", once no treatment is in question, counts the visits.
  if (/\bcombien de (?:fois|reprises)\b/u.test(p)) return { section: "count" };
  const before = BEFORE_LAST.exec(p);
  if (before && VISIT.test(p)) return { section: "prev", n: NUMBER_WORDS[before[1] ?? ""] ?? 2 };
  if (SINCE_HOW_LONG.test(p) && (VISIT.test(p) || /\bsui[st]?\w*\b/u.test(p))) return { section: "firstdate" };
  if ((LAST.test(p) || PREVIOUS.test(p)) && VISIT.test(p) && /\b(?:deux|trois|quatre|cinq|[2-5])\s+derni\w*/u.test(p)) return { section: "prev", n: requestedCount(p) };
  if (HISTORY.test(p)) return { section: "history" };
  if (EVOLVE.test(p)) return { section: "evolution" };
  if (COUNT.test(p) && VISIT.test(p)) return { section: "count" };
  if (ALREADY.test(p) && /\b(?:eu|venu\w*|vu|vue)\b/u.test(p) && VISIT.test(p)) return { section: "count" };
  // What was written at the very first visit is that visit's note, not its date.
  if (/\bpremi\w*\s+(?:consultation|seance|visite|note|entretien)\b|\bla premiere fois\b/u.test(p) && !LAST.test(p) && /\b(?:note\w*|ecrit\w*|disait|contenu\w*|contenait|consigne\w*|observ\w*|qu'est-ce qui|que s'est-il)\b/u.test(p)) return { section: "firstnote" };
  if (FIRST.test(p) && LAST.test(p) && VISIT.test(p)) return { section: "bounds" };
  if (FIRST.test(p) && (VISIT.test(p) || /\bdepuis quand\b/u.test(p))) return { section: "firstdate" };
  if ((LAST.test(p) || PREVIOUS.test(p)) && VISIT.test(p)) {
    const asksDate = DATE_CUE.test(p);
    if (/\b(?:deux|trois|quatre|cinq|[2-5])\s+derni\w*/u.test(p) || (PLURAL_VISIT.test(p) && !asksDate) || PREVIOUS.test(p) || (LAST.test(p) && PLURAL_VISIT.test(p))) return { section: "prev", n: requestedCount(p) };
    return { section: asksDate ? "lastdate" : "lastnote" };
  }
  if (SUMMARY.test(p)) return { section: "summary" };
  // "Ouvre-moi <prénom nom>": the record of a person named in full is read as its summary. A screen ("ouvre l'agenda", "ouvre le
  // planning") is never a person: only two to four words no screen name, then nothing else.
  const open = /^(?:alexa\W+)?(?:ouvre|ouvrez|ouvrir)(?:-moi| moi)?\s+(?:le dossier de\s+|la fiche de\s+)?(\p{L}+(?:[\s-]\p{L}+){1,3})\s*[.!?]*$/u.exec(p);
  if (open && !/\b(?:le|la|les|l|un|une|mon|ma|mes|agenda|planning|finances?|comptabilite|documents?|parametres|reglages|jarvis|alexa|tableau|bord|dashboard|liste|patients?|accueil|consultations?|notes?)\b/u.test(open[1]!)) return { section: "summary" };
  return null;
}

/** A question about the record, answered from the doctor's own record: never from a book. */
const COLLIDES_WITH_BOOKS: ReadonlySet<PatientSectionKey> = new Set(["treatments", "diagnoses"]);

interface Run { readonly words: string[]; readonly upper: boolean; readonly before: string }

/** Contiguous runs of words no vocabulary knows, keeping the doctor's own spelling. */
export function unknownNameRuns(text: string): Run[] { return unknownRuns(text); }
/**
 * Which family of reads a request is about: "patient" when it speaks of one person (a name, a pronoun, "ce patient", "on l'a
 * reçu"), "practice" when it names nobody but a day, a period or the patients as a group, null when nothing tells.
 * "Le patient suivant" and "il nous reste" belong to the agenda and the till. "[X]" is the catalogue's own stand-in for a name.
 */
export function readFamily(text: string): "patient" | "practice" | null {
  const p = fold(text).replace(/\b(?:le|la|mon|ma) (?:patient|patiente) (?:suivant|suivante|prochain|prochaine|d'apres|precedent|precedente)\b|\bil (?:nous|me|vous) reste\b|\bs'il (?:te|vous) plait\b/gu, " ");
  // Days and slots are not names, even typed in lower case next to an unknown verb ("viennent vendredi").
  const calendar = /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|journ[ée]e|cr[ée]neaux?|programme)\b/giu;
  if (PRONOUN_CUE.test(p) || /\bon (?:le|la|l')|\b(?:le|la|l')(?: ?[a-z]+)-on\b|\[x\]/u.test(p) || unknownRuns(text.replace(calendar, " ")).some((run) => run.words.length >= 2 || run.upper)) return "patient";
  return GROUP_SCOPE.test(p) || CALENDAR_SCOPE.test(p) || calendar.test(fold(text)) ? "practice" : null;
}
function unknownRuns(text: string): Run[] {
  const tokens = [...text.matchAll(/[\p{L}][\p{L}'’-]*/gu)].flatMap((match) => {
    const raw = match[0], split = /^(?:d|l|qu|j|s|n|c|m|t)['’]/iu.exec(raw);
    return split ? [{ raw: raw.slice(split[0].length), index: match.index + split[0].length }] : [{ raw, index: match.index }];
  });
  const unknown = (raw: string) => {
    // "Présente-moi", "Rappelle-lui", "prend-il": a verb with its pronoun is vocabulary, not a name.
    const stripped = raw.replace(/-(?:t-)?(?:il|elle|ils|elles|on|je|tu|vous|nous|moi|toi|lui|le|la|les|leur)$/iu, "");
    const word = fold(stripped).replace(/^[-']+|[-']+$/gu, "");
    return !FRAME_WORDS.test(word) && mayBeAName(stripped);
  };
  const runs: Run[] = [];
  let current: { words: string[]; upper: boolean; before: string; end: number } | null = null;
  tokens.forEach((token, position) => {
    if (!unknown(token.raw)) { current = null; return; }
    const gap = current ? text.slice(current.end, token.index) : "";
    if (current && /^\s+$/u.test(gap)) { current.words.push(token.raw); current.end = token.index + token.raw.length; return; }
    const before = fold(tokens[position - 1]?.raw ?? "");
    current = { words: [token.raw], upper: /^\p{Lu}/u.test(token.raw), before, end: token.index + token.raw.length };
    runs.push(current);
  });
  return runs.map((run) => ({ words: run.words, upper: run.upper, before: run.before }));
}

/**
 * Who the question is about. `named` when two to four unknown words in a row can only be a name; `context` when it
 * speaks of the patient on screen or in the conversation; null when unsure (the previous route then asks).
 */
export function patientSubject(text: string, options: { contextPatient: boolean; followup: boolean; ignoreUnknownWords?: boolean; periodRead?: boolean }, section: PatientSectionKey): PatientSubject | null {
  const p = fold(text);
  // A day or a period speaks of the practice, unless the caller reads that period for this patient.
  if (NOT_THE_PATIENT.test(p) || GROUP_SCOPE.test(p) || (!options.periodRead && CALENDAR_SCOPE.test(p))) return null;
  // The caller found no patient of that name: the unknown words are vocabulary the lists lack ("changé récemment"), not a name.
  // A capitalised unknown word is a name by every reading; if the search found nobody of that name, the question is not about the
  // patient on screen either (it must never turn into a read of the patient already selected): the previous route asks.
  if (options.ignoreUnknownWords && unknownRuns(text).some((run) => run.upper)) return null;
  const runs = options.ignoreUnknownWords ? [] : unknownRuns(text);
  // Two to four unknown words in a row can only be a name; two separate groups of them are two names or a muddle.
  const names = runs.filter(run => run.words.length >= 2);
  if (names.length > 1 || runs.some(run => run.words.length > 4)) return null;
  const name = names[0];
  // Beside one full name, a lone lower-case word ("a consulté", "les passages") or the capitalised first word of the sentence is
  // vocabulary the lists lack, not a second name. The patient search still has to find the name (caller).
  if (name) return runs.every((run) => run === name || (run.words.length === 1 && (!run.upper || run.before === ""))) ? { kind: "named", name: name.words.join(" ") } : null;
  // One unknown word alone: after "de", "sur", "chez"... or capitalised it is a first name. It is passed on as a name; the patient search
  // then finds one patient (read) or several (the doctor is asked which), and finds none for vocabulary the lists lack (caller falls back).
  const firstNames = runs.filter(run => run.upper || /^(?:de|du|des|d|sur|chez|pour|a|avec|concernant|propos)$/u.test(run.before));
  if (firstNames.length > 1) return null;
  if (firstNames.length === 1) return { kind: "named", name: firstNames[0]!.words.join(" ") };
  if (!options.contextPatient && !options.followup) return null;
  const cue = PRONOUN_CUE.test(p);
  // "au cabinet" with nobody in the sentence asks about the clinic, not about the patient on screen.
  if (/\bcabinet\b/u.test(p) && !cue) return null;
  if (cue) return { kind: "context" };
  // "Combien de séances la semaine dernière ?": a day or a week with no pronoun is the practice's count, as before.
  if (options.periodRead && CALENDAR_SCOPE.test(p)) return null;
  // Words that were taken for a name and found nobody: without a pronoun or "ce patient", nothing says the question is about the patient on screen.
  if (options.ignoreUnknownWords) return null;
  // Without a pronoun, only questions that no book could answer may speak of the patient on screen.
  if (mentionsClinicalTopic(text) && section !== "treatments" && section !== "diagnoses") return null;
  if (COLLIDES_WITH_BOOKS.has(section)) return null;
  const short = text.trim().split(/\s+/u).length <= 14;
  return short && (options.contextPatient || options.followup) ? { kind: "context" } : null;
}

const SELECTED = "du patient sélectionné";
/** The closed question the audited gates answer. Named subjects use forms the name parser reads reliably. */
export function renderPatientQuestion(question: PatientQuestion, subject: PatientSubject, period?: { from: string; to: string }): string {
  const named = subject.kind === "named" ? subject.name : null;
  if (question.section === "count" && period) return named ? `Nombre de consultations pour ${named} ${periodWords(period)}.` : `Combien de consultations a le patient sélectionné ${periodWords(period)} ?`;
  switch (question.section) {
    case "summary": return named ? `Résumé de ${named}.` : "Résume le dossier du patient sélectionné.";
    case "history": return named ? `Quel est l'historique médical de ${named} ?` : "Montre l'historique du patient sélectionné.";
    case "treatments": return named ? `Quel est le traitement de ${named} ?` : "Quels traitements sont en cours pour le patient sélectionné ?";
    case "count": return named ? `Nombre de consultations pour ${named}.` : "Combien de consultations a le patient sélectionné ?";
    // The first and the last visit are read together: the audited read answers both, and says so when the record is too long to read whole.
    case "bounds": case "lastdate": case "firstdate": return named ? `Quelles sont les dates de la première à la dernière consultation de ${named} ?` : `Quelles sont les dates de la première à la dernière consultation ${SELECTED} ?`;
    case "treatchanges": return named ? `Quels changements de traitement sont enregistrés pour ${named} ?` : "Quels changements de traitement sont enregistrés pour le patient sélectionné ?";
    case "lastnote": return named ? `Résume la dernière consultation de ${named}.` : "Résume la dernière consultation du patient sélectionné.";
    case "firstnote": return named ? `Quelle est la note de la toute première consultation de ${named} ?` : "Quelle est la note de la toute première consultation du patient sélectionné ?";
    // The model-free history lists the dates of the five latest visits, which covers up to five requested: no wording of "N dernières consultations", it would also read as a consultation list.
    case "prev": return named ? `Quel est l'historique médical de ${named} ?` : "Montre l'historique du patient sélectionné.";
    case "nextappt": return named ? `Quel est le prochain rendez-vous de ${named} ?` : "Quel est le prochain rendez-vous du patient sélectionné ?";
    case "documents": return named ? `Quels documents de ${named} ?` : "Quels documents du patient sélectionné ?";
    case "scales": return named ? `Montre les résultats d’échelles de ${named}.` : "Montre les résultats d’échelles pour le patient sélectionné.";
    case "diagnoses": return named ? `Quels diagnostics actifs pour ${named} ?` : "Quels diagnostics actifs pour le patient sélectionné ?";
    // The evolution of a record is read from the same recorded fields as its summary: dates, treatment, latest notes, no interpretation.
    case "evolution": return renderPatientQuestion({ section: "summary" }, subject);
    case "identity": return named ? `Affiche le profil du patient ${named}.` : "Affiche le profil du patient sélectionné.";
  }
}

/** The whole step: the closed question for this utterance, or null when the utterance is not clearly one. */
export function patientQuestionFrame(text: string, options: { contextPatient: boolean; followup: boolean; ignoreUnknownWords?: boolean }, asOf?: string):{ text: string; subject: PatientSubject; section: PatientSectionKey } | null {
  const question = classifyPatientQuestion(text);
  if (!question) return null;
  const period = patientPeriod(text, question.section, asOf);
  if (period === "refuse") return null;
  const subject = patientSubject(text, { ...options, periodRead: !!period }, question.section);
  if (!subject) return null;
  return { text: renderPatientQuestion(question, subject, period ?? undefined), subject, section: question.section };
}

/**
 * "Même calcul pour l'année d'avant", "Et en 2024 ?": a visit count asked again for another period, for the same patient.
 * "D'avant" is counted from the previous period, not from today. Null unless the previous question was such a count.
 */
export function patientCountPeriodFollowup(text: string, previousRequest: string | undefined, asOf: string): string | null {
  const prior = previousRequest ? /^(.*?) du (\d{2})\/(\d{2})\/(\d{4}) au \d{2}\/\d{2}\/\d{4}(\s?[.?])$/u.exec(previousRequest) : null;
  if (!prior || !/^(?:Combien de consultations a le patient sélectionné|Nombre de consultations pour )/u.test(prior[1]!)) return null;
  const rest = fold(text).replace(/[?.!]+$/u, "").replace(/^(?:(?:et|alors)\s+)?(?:(?:le |la )?meme (?:calcul|question|chose|compte)|pareil|idem)?\s*(?:pour|sur|en)?\s*/u, "").trim();
  if (!rest || rest.split(" ").length > 5) return null;
  const year = Number(prior[4]), month = Number(prior[3]);
  const before = /^(?:l'annee|l'an) (?:d'avant|precedente)$/u.test(rest) ? { from: `${year - 1}-01-01T00:00:00+01:00`, to: `${year}-01-01T00:00:00+01:00` }
    : /^le mois (?:d'avant|precedent)$/u.test(rest) ? { from: `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}-01T00:00:00+01:00`, to: `${year}-${String(month).padStart(2, "0")}-01T00:00:00+01:00` } : null;
  const period = before ?? namedPeriod(rest, asOf);
  if (!period || period === "unreadable") return null;
  return `${prior[1]} ${periodWords(period)}${prior[5]}`;
}

/**
 * "Son traitement actuel et sa prochaine consultation ?": two sections of one record asked together, each restated as its own
 * closed question for the same patient, so neither is answered in silence by the other's read. Null unless two parts name
 * different sections; a question naming a period keeps its single frame.
 */
export function patientQuestionParts(text: string, options: { contextPatient: boolean; followup: boolean; ignoreUnknownWords?: boolean }, asOf?: string): { text: string; subject: PatientSubject; section: PatientSectionKey }[] | null {
  const pieces = text.split(/\s*[:;]\s+|,?\s+(?:et|puis|ainsi que)\s+/u).filter(piece => /\p{L}{3}/u.test(piece));
  if (pieces.length < 2 || namedPeriod(text, asOf) !== null) return null;
  const questions = pieces.map(piece => classifyPatientQuestion(piece)).filter((question): question is PatientQuestion => question !== null)
    .filter((question, index, all) => all.findIndex(other => other.section === question.section) === index);
  if (questions.length < 2) return null;
  const subject = patientSubject(text, { ...options, periodRead: false }, questions[0]!.section);
  if (!subject) return null;
  return questions.map(question => ({ text: renderPatientQuestion(question, subject), subject, section: question.section }));
}

/**
 * The period a patient question carries. Only a visit count is read over a period; any other section, or a period the
 * readers cannot bound, is refused ("refuse"): never the whole record in silence. Null when the question names no period.
 */
export function patientPeriod(text: string, section: PatientSectionKey, asOf: string | undefined): { from: string; to: string } | "refuse" | null {
  const period = namedPeriod(text, asOf);
  if (period === null) return null;
  return section === "count" && period !== "unreadable" ? period : "refuse";
}

/**
 * "Et celui de Nazim Hamza ?", "Passons à Imed Zarat.", "Pour Samir Test maintenant.": a sentence that holds only a
 * name asks the previous question again, for that patient. Nothing is carried over if the sentence asks something itself,
 * speaks of a relative, or holds anything else a name could be.
 */
export function patientSwitchFollowup(text: string, previousRequest: string | undefined): { text: string; section: PatientSectionKey; name: string } | null {
  if (!previousRequest || classifyPatientQuestion(text)) return null;
  const previous = classifyPatientQuestion(previousRequest);
  if (!previous || NOT_THE_PATIENT.test(fold(text))) return null;
  const runs = unknownRuns(text);
  const run = runs[0];
  if (runs.length !== 1 || !run || run.words.length < 2 || run.words.length > 4) return null;
  const name = run.words.join(" ");
  return { text: renderPatientQuestion(previous, { kind: "named", name }), section: previous.section, name };
}

/** The question asked before a patient was chosen from a list, restated for the chosen patient. */
export function reaskForSelectedPatient(previousRequest: string | undefined): string | null {
  const previous = previousRequest ? classifyPatientQuestion(previousRequest) : null;
  return previous ? renderPatientQuestion(previous, { kind: "context" }) : null;
}
