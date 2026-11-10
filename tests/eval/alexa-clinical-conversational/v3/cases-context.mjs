/**
 * C202 · domain "context": 45 French conversations on patient identity and context, worded differently from C200 and C201:
 * the consultation screen, pronouns and follow-ups, a patient other than the one on screen, same first names, similar names,
 * unrelated turns in between, "next patient". Roles are resolved from SQL by generate-oracles.mjs, never read by the assistant.
 */
import { c, t } from "./helpers.mjs";

const D = "context";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const NEXT_DAY = { asOf: "2026-11-10T08:00:00+01:00" };
const AGENDA_DAY = { asOf: "2026-10-26T09:30:00+01:00" };
const one = (id, page, say, expect, tag) => c(id, D, "main", page, [t(say, expect, tag)]);
const F = "fr";

export const cases = [
  // On the consultation screen, nobody is named (8)
  one("W056", onConsult("R2"), "Combien de fois on l'a vu ?", { k: "count", r: "R2" }, [F, "pronoun"]),
  one("W057", onConsult("T2"), "Traitement en cours ?", { k: "treat", r: "T2" }, [F, "implicit"]),
  one("W058", onConsult("R4"), "Date de dernière venue ?", { k: "lastdate", r: "R4" }, [F, "short"]),
  one("W059", onConsult("R5"), "Il est suivi ici depuis quelle époque ?", { k: "firstdate", r: "R5" }, [F, "informal"]),
  one("W060", onConsult("R6"), "Je voudrais un point sur ce patient avant d'entrer.", { k: "summary", r: "R6" }, [F, "conversational"]),
  one("W061", onConsult("T5"), "Pourriez-vous m'indiquer ses médicaments actuels ?", { k: "treat", r: "T5" }, [F, "formal"]),
  one("W062", onConsult("R8"), "De ce patient, l'historique complet, s'il te plaît.", { k: "history", r: "R8" }, [F, "wordorder"]),
  one("W063", onConsult("R10"), "Quel est le dernier compte rendu de séance ?", { k: "lastnote", r: "R10" }, [F, "synonym"]),

  // A patient is named, then only pronouns and follow-ups (8)
  c("W064", D, "main", G, [
    t("Qu'a-t-on dans le dossier de {R5} ?", { k: "summary", r: "R5" }, [F, "direct"]),
    t("Il a eu combien de séances ?", { k: "count", r: "R5" }, [F, "pronoun"]),
    t("C'était pour quel jour, la plus récente ?", { k: "lastdate", r: "R5" }, [F, "followup"])]),
  c("W065", D, "main", G, [
    t("{T1} : traitement actuel ?", { k: "treat", r: "T1" }, [F, "short"]),
    t("Et sa plus récente venue, à quelle date ?", { k: "lastdate", r: "T1" }, [F, "followup"])]),
  c("W066", D, "main", G, [
    t("Je voudrais des informations sur {R3}.", { k: "summary", r: "R3" }, [F, "direct"]),
    t("Et son historique ?", { k: "history", r: "R3" }, [F, "followup"])]),
  c("W067", D, "main", G, [
    t("Dossier de {R6}, résumé rapide.", { k: "summary", r: "R6" }, [F, "short"]),
    t("Combien de consultations a-t-il à son actif ?", { k: "count", r: "R6" }, [F, "pronoun"])]),
  c("W068", D, "main", G, [
    t("Fais-moi le point sur le suivi de {R9}.", { k: "summary", r: "R9" }, [F, "direct"]),
    t("Et la toute première consultation ?", { k: "firstdate", r: "R9" }, [F, "followup"])]),
  c("W069", D, "main", onPatient("T3"), [
    t("Quelles molécules a-t-on prescrites en ce moment ?", { k: "treat", r: "T3" }, [F, "direct"]),
    t("À combien de séances est-ce que ça monte ?", { k: "count", r: "T3" }, [F, "followup"])]),
  c("W070", D, "main", G, [
    t("Donne-moi les dernières nouvelles de {R4}.", { k: "summary", r: "R4" }, [F, "conversational"]),
    t("Montre-moi ses deux dernières consultations.", { k: "prev", r: "R4", n: 2 }, [F, "followup"])]),
  c("W071", D, "main", G, [
    t("{R7} : à quelle date a-t-il été reçu pour la dernière fois ?", { k: "lastdate", r: "R7" }, [F, "wordorder"]),
    t("Et à ses débuts chez nous ?", { k: "firstdate", r: "R7" }, [F, "followup"])]),

  // The doctor names a patient other than the one on screen (7)
  c("W072", D, "main", onPatient("R1"), [t("Laisse celui-là, ouvre plutôt le dossier de {R2}.", { k: "summary", r: "R2", decoys: ["R1"] }, [F, "otherpatient"])]),
  c("W073", D, "main", onConsult("R3"), [t("Je voudrais plutôt savoir combien de séances a eues {R4}.", { k: "count", r: "R4", decoys: ["R3"] }, [F, "otherpatient"])]),
  c("W074", D, "main", onPatient("R5"), [t("Ce n'est pas lui que je veux : donne-moi la dernière visite de {R6}.", { k: "lastdate", r: "R6", decoys: ["R5"] }, [F, "otherpatient"])]),
  c("W075", D, "main", onPatient("R7"), [t("Change de patient : le traitement de {T2}, s'il te plaît.", { k: "treat", r: "T2", decoys: ["R7"] }, [F, "otherpatient"])]),
  c("W076", D, "main", onConsult("T1"), [t("Maintenant je veux voir {R9} : historique de ses consultations.", { k: "history", r: "R9", decoys: ["T1"] }, [F, "otherpatient"])]),
  c("W077", D, "main", onPatient("R9"), [t("Pour {R10} et non pour celui-ci : résume son dossier.", { k: "summary", r: "R10", decoys: ["R9"] }, [F, "otherpatient"])]),
  c("W078", D, "main", onConsult("R2"), [t("Oublie ce dossier, c'est {R3} : quelle est sa première consultation ?", { k: "firstdate", r: "R3", decoys: ["R2"] }, [F, "otherpatient"])]),

  // Same first name or identical name: ask, never guess (5)
  c("W079", D, "main", G, [t("Je voudrais des informations sur {HA.first}.", { k: "clarify", decoys: ["HA", "HB"] }, [F, "direct"])]),
  c("W080", D, "main", G, [
    t("{HC.first} : on l'a reçu en dernier quel jour ?", { k: "clarify", decoys: ["HC", "HD"] }, [F, "short"]),
    t("{HC} bien sûr.", { k: "lastdate", r: "HC", decoys: ["HD"] }, [F, "followup"])]),
  c("W081", D, "main", G, [t("Montre-moi le profil de {HB.first}", { k: "clarify", decoys: ["HA", "HB"] }, [F, "short"])]),
  c("W082", D, "main", G, [t("Nombre de séances de {HD.first} ?", { k: "clarify", decoys: ["HC", "HD"] }, [F, "short"])]),
  c("W083", D, "main", G, [t("Résume le dossier de {DA}.", { k: "clarify", decoys: ["DA", "DB"] }, [F, "direct"])]),

  // Similar names (3)
  c("W084", D, "main", G, [t("Un aperçu de {SA}, s'il vous plaît.", { k: "summary", r: "SA", decoys: ["SB"] }, [F, "direct"])]),
  c("W085", D, "main", G, [t("Pour {SB}, quel est le total de séances déjà faites ?", { k: "count", r: "SB", decoys: ["SA"] }, [F, "short"])]),
  c("W086", D, "main", G, [t("Date de la dernière séance de {SA} ?", { k: "lastdate", r: "SA", decoys: ["SB"] }, [F, "direct"])]),

  // Unrelated turns in between (3)
  c("W087", D, "main", G, [
    t("Une vue d'ensemble de {R1}.", { k: "summary", r: "R1" }, [F, "short"]),
    t("Dis-moi bonjour.", { k: "plain" }, [F, "short"]),
    t("Quelle était sa dernière visite ?", { k: "lastdate", r: "R1" }, [F, "pronoun"])]),
  c("W088", D, "main", G, [
    t("Quelle est l'ordonnance de {T3} ?", { k: "treat", r: "T3" }, [F, "short"]),
    t("Combien de consultations aujourd'hui ?", { k: "a_count", day: "today", noPatientRead: true }, [F, "direct"]),
    t("Et son nombre de séances ?", { k: "count", r: "T3" }, [F, "followup"])], AGENDA_DAY),
  c("W089", D, "main", G, [
    t("Rappelle-moi ce qu'on sait de {R8}.", { k: "summary", r: "R8" }, [F, "direct"]),
    t("Merci, c'est noté.", { k: "plain" }, [F, "short"]),
    t("Et ses trois dernières consultations ?", { k: "prev", r: "R8", n: 3 }, [F, "followup"])]),

  // "Next patient" (3), on the fixture with the clock-controlled appointment
  c("W090", D, "fixture", G, [
    t("Qui est mon patient suivant ?", { k: "nextpatient", day: "today" }, [F, "direct"]),
    t("Résume-moi son dossier.", { k: "summary", r: "NP1" }, [F, "pronoun"])], NEXT_DAY),
  c("W091", D, "fixture", G, [
    t("Passe au patient suivant.", { k: "nextpatient", day: "today" }, [F, "informal"]),
    t("Et qu'est-ce qu'on lui prescrit ?", { k: "treat", r: "NP1" }, [F, "pronoun"])], NEXT_DAY),
  c("W092", D, "fixture", G, [
    t("C'est quoi le prochain dossier à ouvrir ?", { k: "nextpatient", day: "today" }, [F, "conversational"]),
    t("Combien de séances a-t-il eues ?", { k: "count", r: "NP1" }, [F, "pronoun"])], NEXT_DAY),

  // Who is on screen (2)
  one("W093", onConsult("OPEN", "open"), "Peux-tu me redonner l'identité du patient affiché ?", { k: "who", r: "OPEN" }, [F, "formal"]),
  one("W094", onPatient("R1"), "De qui parle-t-on ici ?", { k: "who", r: "R1" }, [F, "short"]),

  // Few or no consultations (3)
  one("W095", G, "Quelles sont les consultations de {F1} ?", { k: "prev", r: "F1", n: 2 }, [F, "direct"]),
  one("W096", G, "{Z1} a-t-il été reçu au moins une fois ici ?", { k: "count", r: "Z1" }, [F, "conversational"]),
  one("W097", onPatient("Z1"), "Quel est son nombre de passages ici ?", { k: "count", r: "Z1" }, [F, "direct"]),

  // More everyday turns (3)
  one("W098", onPatient("T2"), "Peux-tu me dire ce qu'il prend comme médicaments ?", { k: "treat", r: "T2" }, [F, "conversational"]),
  one("W099", onConsult("R7"), "En quelques phrases, qui est ce patient et où en est-il ?", { k: "summary", r: "R7" }, [F, "conversational"]),
  one("W100", G, "Quand {T5} est-il venu en dernier ?", { k: "lastdate", r: "T5" }, [F, "wordorder"]),
];
