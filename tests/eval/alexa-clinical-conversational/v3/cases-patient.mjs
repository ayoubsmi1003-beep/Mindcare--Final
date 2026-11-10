/**
 * C202 · domain "patient": 55 patient questions, French only, worded differently from every C200 and C201 question.
 * Same everyday intents, other words: formal, familiar, telegraphic, other word order, typing mistakes, implicit subject.
 * `{R7}` etc. are role placeholders resolved at run time from the private oracle. No patient name is stored in this repository.
 */
import { c, t } from "./helpers.mjs";

const D = "patient";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const p = (id, tag, page, say, expect) => c(id, D, "main", page, [t(say, expect, tag)]);
const F = "fr";

export const cases = [
  // Summaries (8)
  p("W001", [F, "formal"], onPatient("R1"), "Peux-tu me préparer une synthèse du dossier de ce patient avant la séance ?", { k: "summary", r: "R1" }),
  p("W002", [F, "informal"], G, "Allez, balance-moi l'essentiel sur {R2}.", { k: "summary", r: "R2" }),
  p("W003", [F, "short"], onPatient("R3"), "Synthèse.", { k: "summary", r: "R3" }),
  p("W004", [F, "conversational"], onConsult("R4"), "J'ai oublié où on en était avec lui, tu peux me remettre au clair ?", { k: "summary", r: "R4" }),
  p("W005", [F, "wordorder"], G, "Sur {R5}, je voudrais un tour d'horizon.", { k: "summary", r: "R5" }),
  p("W006", [F, "typo"], G, "syntese du patien {R6}", { k: "summary", r: "R6" }),
  p("W007", [F, "synonym"], onPatient("R7"), "Fais-moi un état des lieux de sa prise en charge.", { k: "summary", r: "R7" }),
  p("W008", [F, "implicit"], onPatient("R8"), "Les grandes lignes ?", { k: "summary", r: "R8" }),

  // History (6)
  p("W009", [F, "direct"], onPatient("R9"), "Liste ses consultations passées.", { k: "history", r: "R9" }),
  p("W010", [F, "conversational"], G, "J'aimerais revoir toutes les séances qu'a eues {R10} avec nous.", { k: "history", r: "R10" }),
  p("W011", [F, "short"], onPatient("R2"), "Chronologie.", { k: "history", r: "R2" }),
  p("W012", [F, "formal"], onConsult("R6"), "Veuillez afficher la chronologie complète de ses consultations.", { k: "history", r: "R6" }),
  p("W013", [F, "informal"], G, "Ça remonte à quand et ça a donné quoi, le suivi de {R3} ?", { k: "history", r: "R3" }),
  p("W014", [F, "synonym"], onPatient("R5"), "Le déroulé de son suivi depuis le début ?", { k: "history", r: "R5" }),

  // Number of consultations (7)
  p("W015", [F, "direct"], onPatient("R10"), "Au bout du compte, combien de séances ce patient a-t-il à son actif ?", { k: "count", r: "R10" }),
  p("W016", [F, "informal"], G, "{R4}, on l'a vu combien de fois en tout ?", { k: "count", r: "R4" }),
  p("W017", [F, "short"], onPatient("R7"), "Total des séances ?", { k: "count", r: "R7" }),
  p("W018", [F, "wordorder"], onPatient("R1"), "En tout, combien de séances a-t-il eues ?", { k: "count", r: "R1" }),
  p("W019", [F, "typo"], G, "combien de seances a eu {R8} ?", { k: "count", r: "R8" }),
  p("W020", [F, "conversational"], onConsult("R2"), "Dis-moi, il en est à combien de consultations depuis qu'il vient ?", { k: "count", r: "R2" }),
  p("W021", [F, "synonym"], onPatient("R6"), "Ça représente combien de passages cumulés ?", { k: "count", r: "R6" }),

  // Date of the last visit (7)
  p("W022", [F, "formal"], onPatient("R3"), "Pourriez-vous m'indiquer la date de sa consultation la plus récente ?", { k: "lastdate", r: "R3" }),
  p("W023", [F, "direct"], G, "Date de la dernière consultation de {R9} ?", { k: "lastdate", r: "R9" }),
  p("W024", [F, "informal"], onPatient("R5"), "Sa dernière apparition au cabinet, c'était quel jour ?", { k: "lastdate", r: "R5" }),
  p("W025", [F, "short"], onPatient("R10"), "Dernière séance ?", { k: "lastdate", r: "R10" }),
  p("W026", [F, "wordorder"], G, "Quand {R7} a-t-il été reçu en dernier ?", { k: "lastdate", r: "R7" }),
  p("W027", [F, "typo"], onPatient("R2"), "date de sa derniere consultaton", { k: "lastdate", r: "R2" }),
  p("W028", [F, "conversational"], onConsult("R8"), "Je voudrais la date de sa dernière visite, s'il te plaît.", { k: "lastdate", r: "R8" }),

  // Date of the first visit (4)
  p("W029", [F, "direct"], onPatient("R4"), "Le jour de sa toute première venue ?", { k: "firstdate", r: "R4" }),
  p("W030", [F, "formal"], G, "À quelle date {R6} a-t-il été reçu pour la première fois ?", { k: "firstdate", r: "R6" }),
  p("W031", [F, "informal"], onPatient("R9"), "Il a débuté son suivi chez nous quand ?", { k: "firstdate", r: "R9" }),
  p("W032", [F, "short"], onConsult("R3"), "Début du suivi ?", { k: "firstdate", r: "R3" }),

  // The last three consultations (4)
  p("W033", [F, "direct"], onPatient("R2"), "Affiche les trois séances les plus récentes de ce patient.", { k: "prev", r: "R2", n: 3 }),
  p("W034", [F, "conversational"], G, "Rappelle-moi les dernières fois où j'ai vu {R10}, les trois dernières.", { k: "prev", r: "R10", n: 3 }),
  p("W035", [F, "short"], onPatient("R5"), "Trois dernières séances ?", { k: "prev", r: "R5", n: 3 }),
  p("W036", [F, "formal"], onConsult("R7"), "Pourriez-vous lister les trois consultations les plus récentes de ce patient ?", { k: "prev", r: "R7", n: 3 }),

  // The last note (4)
  p("W037", [F, "direct"], onPatient("R4"), "Affiche ma dernière note clinique pour ce patient.", { k: "lastnote", r: "R4" }),
  p("W038", [F, "informal"], G, "Sur {R1}, quelles observations avais-je consignées lors de la séance précédente ?", { k: "lastnote", r: "R1" }),
  p("W039", [F, "short"], onPatient("R9"), "Note de la dernière séance ?", { k: "lastnote", r: "R9" }),
  p("W040", [F, "synonym"], onConsult("R10"), "Remets-moi sous les yeux mon compte rendu de sa précédente visite.", { k: "lastnote", r: "R10" }),

  // Current treatment (7)
  p("W041", [F, "direct"], onPatient("T3"), "Que lui a-t-on prescrit pour le moment ?", { k: "treat", r: "T3" }),
  p("W042", [F, "informal"], G, "Côté ordonnance, {T4} est sous quelles molécules ?", { k: "treat", r: "T4" }),
  p("W043", [F, "short"], onPatient("T5"), "Sa prescription courante ?", { k: "treat", r: "T5" }),
  p("W044", [F, "wordorder"], onConsult("T1"), "Quelles substances lui prescrit-on à l'heure actuelle ?", { k: "treat", r: "T1" }),
  p("W045", [F, "typo"], G, "traitment en cour de {T2}", { k: "treat", r: "T2" }),
  p("W046", [F, "formal"], onPatient("T4"), "Quelle est la prescription médicamenteuse actuelle de ce patient ?", { k: "treat", r: "T4" }),
  p("W047", [F, "conversational"], onConsult("T3"), "Je ne me rappelle plus ce qu'il prend, tu peux me le dire ?", { k: "treat", r: "T3" }),

  // Next appointment (3)
  p("W048", [F, "direct"], onPatient("U2"), "Pour quelle date l'ai-je reprogrammé ?", { k: "nextappt", r: "U2" }),
  p("W049", [F, "informal"], G, "{U1} revient à quelle date ?", { k: "nextappt", r: "U1" }),
  p("W050", [F, "formal"], onPatient("U3"), "Pourriez-vous m'indiquer la date de sa prochaine consultation programmée ?", { k: "nextappt", r: "U3" }),

  // Documents, scales, identity (5)
  p("W051", [F, "short"], onPatient("R2"), "Nombre de documents au dossier ?", { k: "documents", r: "R2" }),
  p("W052", [F, "informal"], G, "{R7} a des papiers dans son dossier ? Combien ?", { k: "documents", r: "R7" }),
  p("W053", [F, "conversational"], onPatient("S1"), "Quels scores d'échelles ont été relevés pour lui ?", { k: "scales", r: "S1" }),
  p("W054", [F, "direct"], onPatient("S1"), "A-t-il passé des échelles d'évaluation ?", { k: "scales", r: "S1" }),
  p("W055", [F, "conversational"], onConsult("OPEN", "open"), "Rappelle-moi le nom du patient dont je consulte le dossier.", { k: "who", r: "OPEN" }),
];
