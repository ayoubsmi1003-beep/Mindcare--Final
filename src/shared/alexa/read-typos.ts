/**
 * One slip in a word of the read vocabulary ("traitemnt", "conslutations", "patien"), corrected before the word frames read a
 * question. Only for building a closed READ question: the corrected text is never stored, dictated, quoted or written anywhere,
 * and a question no frame understands keeps the doctor's own words. Left as typed: a word with a capital, a word of four
 * letters or less, a word inside quotes, a word beside another unknown word (a name run: "amina combier"), a word right after
 * a name introducer ("pour …", "chez …", "le rendez-vous de …"), and any word two vocabulary words are equally close to.
 * shortcut: a lone lower-case name typed with no introducer ("dossier charles") can still be read as a slip; the name
 * resolver then finds no such patient and the frame is dropped. A dictionary of first names would close it.
 */
import { unknownNameRuns } from "./patient-question";

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’]/gu, "'");

// The words the agenda, practice and patient frames read, with their plural and feminine forms.
const VOCABULARY: ReadonlySet<string> = new Set([
  "traitement", "traitements", "patient", "patiente", "patients", "patientes", "consultation", "consultations", "seance", "seances",
  "ordonnance", "ordonnances", "medicament", "medicaments", "posologie", "posologies", "diagnostic", "diagnostics",
  "dernier", "derniere", "derniers", "dernieres", "prochain", "prochaine", "prochains", "prochaines", "premier", "premiere",
  "actuel", "actuelle", "actuels", "actuelles", "actuellement", "combien", "allergie", "allergies", "echelle", "echelles",
  "document", "documents", "certificat", "certificats", "recettes", "depenses", "charges", "encaisse", "encaissee",
  "semaine", "semaines", "demain", "absences", "absents", "annule", "annules", "annulations", "confirme", "confirmes",
  "planning", "agenda", "dossier", "dossiers", "historique", "antecedents", "synthese", "telephone",
  "adresse", "evolution", "dernierement", "journee", "statistiques", "activite", "impayes", "paiements", "resultat", "benefice",
  // Short or name-like words ("matin", "notes", "quand") are left out: "martin" typed in lower case is a name, not a slip.
]);

/** True when one deletion, insertion, substitution or swap of two neighbours turns `typed` into `word`. */
function oneSlip(typed: string, word: string): boolean {
  if (typed === word || Math.abs(typed.length - word.length) > 1) return false;
  if (typed.length === word.length) {
    const diff = [...typed].flatMap((char, index) => (char === word[index] ? [] : [index]));
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0]! + 1 && typed[diff[0]!] === word[diff[1]!] && typed[diff[1]!] === word[diff[0]!]);
  }
  const [short, long] = typed.length < word.length ? [typed, word] : [word, typed];
  let index = 0;
  while (index < short.length && short[index] === long[index]) index++;
  return short.slice(index) === long.slice(index + 1);
}

// After these, a word is a person before it is a slip: "pour amina", "chez karim", "le rendez-vous de charles".
const NAME_BEFORE = /^(?:pour|chez|avec|sur|a)$/u;
const RECORD_NOUN = /^(?:rendez-vous|rdv|dossiers?|traitements?|ordonnances?|notes?|consultations?|seances?|solde|profil|fiche|historique|resume|patiente?|diagnostics?|echelles?|documents?|allergies?|telephone|adresse)$/u;

export function correctReadTypos(text: string): string {
  // Two unknown words side by side are a name ("amina combier", "charles martin"): never "corrected" into "combien", "charges".
  const nameWords = new Set(unknownNameRuns(text).filter((run) => run.words.length >= 2).flatMap((run) => run.words.map(fold)));
  const words = [...text.matchAll(/[\p{L}][\p{L}'’-]*/gu)].map((match) => fold(match[0]));
  let quoted = false, seen = 0;
  return text.split(/([«»"“”]|[^\p{L}'’-]+)/u).map((piece) => {
    if (/^[«»"“”]$/u.test(piece)) { quoted = !quoted; return piece; }
    if (!/^\p{L}/u.test(piece)) return piece;
    const index = seen++, before = words[index - 1] ?? "", beforeThat = words[index - 2] ?? "";
    if (quoted || piece.length < 5 || !/^\p{Ll}[\p{L}'’-]*$/u.test(piece)) return piece;
    const word = fold(piece);
    if (VOCABULARY.has(word) || nameWords.has(word)) return piece;
    if (NAME_BEFORE.test(before) || (/^(?:de|d')$/u.test(before) && RECORD_NOUN.test(beforeThat))) return piece;
    const near = [...VOCABULARY].filter((candidate) => candidate.length >= 5 && oneSlip(word, candidate));
    return near.length === 1 ? near[0]! : piece;
  }).join("");
}
