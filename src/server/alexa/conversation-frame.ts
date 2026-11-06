import { requestedMedicationNames } from "./knowledge-evidence-content";
import { parsePatientMention } from "./patient-mention";
import { requestsCabinetWideScope } from "./request-plan";

/**
 * Resolves a short follow-up from what the conversation is about, by replacing slots.
 * Appending words to the last question ("la sertraline la clozapine") made retrieval fail.
 * This only rewrites a question: reads still go through their own gates.
 */
const plain = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr").replace(/[’‘]/gu, "'").trim();
const tailOf = (text: string) => text.trim().replace(/[?.!]+$/u, "").trim();

const ASPECTS: readonly (readonly [RegExp, string])[] = [
  [/\beffets?(?: indesirables?| secondaires?)?\b/u, "Quels sont les effets indésirables"],
  [/\b(?:posologie|dose|dosage)s?\b/u, "Quelle est la posologie"],
  [/\binteractions?\b/u, "Quelles sont les interactions"],
  [/\bcontre[- ]?indications?\b/u, "Quelles sont les contre-indications"],
  [/\bprecautions?\b/u, "Quelles sont les précautions"],
  [/\b(?:surveillance|suivi biologique|bilans?)\b/u, "Quelle est la surveillance"],
  [/\b(?:mecanisme|mode d'action)\b/u, "Quel est le mécanisme d'action"],
  [/\bindications?\b/u, "Quelles sont les indications"],
];
const CONDITIONS: readonly (readonly [RegExp, string])[] = [
  [/\bgrossesse\b|\benceinte\b/u, "pendant la grossesse"],
  [/\ballaitement\b/u, "pendant l’allaitement"],
  [/\binsuffisance renale\b/u, "en cas d'insuffisance rénale"],
  [/\binsuffisance hepatique\b/u, "en cas d'insuffisance hépatique"],
  [/\b(?:sujet|personne|patient)s? age(?:e)?s?\b/u, "chez le sujet âgé"],
  [/\benfants?\b/u, "chez l'enfant"],
  [/\badolescents?\b/u, "chez l'adolescent"],
];
const anyCondition = (value: string) => CONDITIONS.find(([pattern]) => pattern.test(value));
const anyAspect = (value: string) => ASPECTS.find(([pattern]) => pattern.test(value));

/** Wording of a question with its condition removed, so conditions replace each other. */
function withoutCondition(question: string): string {
  return question
    .replace(/\s+(?:pendant|durant|lors de)\s+(?:la\s+|l['’])?(?:grossesse|allaitement)\b/iu, "")
    .replace(/\s+en cas d['’]insuffisance\s+\p{L}+/iu, "")
    .replace(/\s+chez\s+(?:le\s+|la\s+|l['’]|les\s+)?(?:sujets?\s+âgés?|personnes?\s+âgées?|enfants?|adolescents?)\b/iu, "");
}

export function knowledgeFollowupQuestion(previous: string, text: string): string {
  const tail = tailOf(text), stem = tailOf(previous), folded = plain(tail);
  const named = requestedMedicationNames(tail), prior = requestedMedicationNames(stem);
  const condition = anyCondition(folded)?.[1];
  const aspect = anyAspect(folded)?.[1];
  const subject = named[0] ?? prior[0];
  if (subject && aspect) return `${aspect} de ${subject}${condition ? ` ${condition}` : ""} ?`;
  let base = stem;
  if (named[0] && prior[0]) {
    const accentless = new RegExp(`[\\p{L}]*`, "gu");
    base = stem.replace(accentless, word => word && plain(word) === prior[0] ? named[0]! : word);
    if (requestedMedicationNames(base).includes(named[0]) && !condition) return `${base} ?`;
  }
  if (condition) return `${withoutCondition(base)} ${condition} ?`;
  if (named[0]) return `${stem} ${tail.replace(/^et\s+/iu, "")} ?`;
  return `${stem} ${tail.replace(/^et\s+/iu, "")} ?`;
}

const SCOPED_WORDS = /\b(?:patiente?s?|combien|dossiers?)\b/iu;
const OTHER_DOMAIN = /\b(?:patiente?s?|dossiers?|consultations?|agendas?|rendez|paiements?|documents?)\b/iu;

/** A short continuation of the last book question. Without a drug, the last turn must have been about books. */
export function isKnowledgeFollowup(previous: string, text: string, previousWasKnowledge = false, plannable: (question: string) => boolean = () => true): boolean {
  const opening = /^(?:et|pour|en cas de|quid|et si|chez)\b/iu.test(text.trim());
  return text.length <= 80 && opening && !OTHER_DOMAIN.test(text) && !SCOPED_WORDS.test(previous)
    && (requestedMedicationNames(previous).length > 0 || previousWasKnowledge) && plannable(previous);
}

/** "Et chez cette patiente ?" after a book question: same subject, against the working patient. */
export function knowledgeAppliedToPatient(previous: string, text: string): string | null {
  if (!/^et\s+(?:chez|pour)\s+(?:cette patiente|ce patient|elle|lui)\s*[?.!]*$/u.test(plain(text))) return null;
  if (!requestedMedicationNames(previous).length && /\bcriter/u.test(plain(previous))) return "Quels diagnostics du patient sélectionné sont documentés dans le DSM-5 ?";
  return `${tailOf(previous)} : compare avec le traitement du patient sélectionné selon les sources.`;
}

const PATIENT_SECTIONS: readonly (readonly [RegExp, string])[] = [
  [/^(?:traitements?|medicaments?|ordonnances?)(?: actuels?| en cours)?$/u, "Quels traitements sont en cours pour le patient sélectionné ?"],
  [/^diagnostics?$/u, "Quels diagnostics actifs pour le patient sélectionné ?"],
  [/^(?:echelles?|scores?)$/u, "Montre les résultats d’échelles pour le patient sélectionné."],
  [/^(?:paiements?|reglements?|impayes?|solde)$/u, "Quel est le solde à encaisser pour le patient sélectionné ?"],
  [/^(?:rendez-vous|rdv)$/u, "Quels rendez-vous du patient sélectionné ?"],
  [/^(?:documents?|certificats?)$/u, "Quels documents du patient sélectionné ?"],
  [/^(?:derniere )?consultations?$/u, "Résume la dernière consultation du patient sélectionné."],
  [/^(?:coordonnees|telephone|numero)$/u, "Affiche le profil du patient sélectionné."],
];
const NOT_A_PATIENT_SUBJECT = /^(?:il|elle)\s+(?:faut|y a|existe|est (?:possible|important|necessaire|recommande))\b/u;

export type PatientFollowup = { kind: "rewrite"; text: string } | { kind: "reuse" } | { kind: "none" };

/** Short references to the working patient. Naming someone or the whole cabinet is never one. */
export function resolvePatientFollowup(text: string): PatientFollowup {
  const folded = plain(text).replace(/[?.!]+$/u, "").trim();
  // The name parser reads "elle prend quoi" as a name; a leading pronoun is not one.
  const leadingPronoun = /^(?:(?:et|au fait)\s+)?(?:elle|il)\s/u.test(folded);
  if ((parsePatientMention(text).status !== "none" && !leadingPronoun) || requestsCabinetWideScope(text)) return { kind: "none" };
  if (/^(?:resume|resumez|synthetise|synthese)(?:[- ](?:moi|nous))?\s+(?:tout\s+)?(?:ca|cela)$/u.test(folded)) return { kind: "rewrite", text: "Résume le dossier du patient sélectionné." };
  const bare = /^(?:(?:et|au fait)\s+)?(?:(?:son|sa|ses|le|la|les)\s+)?(.+)$/u.exec(folded)?.[1];
  const section = bare ? PATIENT_SECTIONS.find(([pattern]) => pattern.test(bare)) : undefined;
  if (section) return { kind: "rewrite", text: section[1] };
  if (/\bcombien\b.*\b(?:a[- ]t[- ](?:elle|il)|ont[- ]ils)\s+paye\b/u.test(folded)) return { kind: "rewrite", text: "Quel est le solde à encaisser pour le patient sélectionné ?" };
  const pronoun = folded.replace(/^(?:et|au fait)\s+/u, "");
  if (/^(?:elle|il)\b/u.test(pronoun) && !NOT_A_PATIENT_SUBJECT.test(pronoun)) return { kind: "reuse" };
  return { kind: "none" };
}
