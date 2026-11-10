/**
 * C200 · domain "patient": 55 everyday patient questions (information, history, summaries).
 * Utterances are French only, single intent, and written before any fix was made.
 * `{R1}` etc. are role placeholders: the name is injected at run time from the private oracle file.
 * Role rules live in generate-oracles.mjs. No patient name is stored in this repository.
 */
import { c, t } from "./helpers.mjs";

const D = "patient";
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const G = { type: "global" };

export const cases = [
  // ── Summaries (8) ──────────────────────────────────────────────────────────
  c("C001", D, "main", onPatient("R1"), [t("Fais-moi un résumé de ce patient.", { k: "summary", r: "R1" })]),
  c("C002", D, "main", G, [t("Qu'est-ce qu'on sait sur {R2} ?", { k: "summary", r: "R2" })]),
  c("C003", D, "main", onConsult("R3"), [t("Donne-moi les points importants avant que je commence la consultation.", { k: "summary", r: "R3" })]),
  c("C004", D, "main", onPatient("R4"), [t("Je le vois dans une minute, rappelle-moi l'essentiel de son dossier.", { k: "summary", r: "R4" })]),
  c("C005", D, "main", G, [t("Synthèse clinique de {R5}, s'il te plaît.", { k: "summary", r: "R5" })]),
  c("C006", D, "main", onPatient("R6"), [t("Où en est ce patient ?", { k: "summary", r: "R6" })]),
  c("C007", D, "main", G, [t("Présente-moi le dossier de {R1}.", { k: "summary", r: "R1" })]),
  c("C008", D, "main", onPatient("R2"), [t("Un petit point sur lui ?", { k: "summary", r: "R2" })]),

  // ── History (6) ────────────────────────────────────────────────────────────
  c("C009", D, "main", onPatient("R3"), [t("Donne-moi son historique.", { k: "history", r: "R3" })]),
  c("C010", D, "main", G, [t("Quel est l'historique médical de {R4} ?", { k: "history", r: "R4" })]),
  c("C011", D, "main", onPatient("R5"), [t("Retrace son parcours dans le cabinet.", { k: "history", r: "R5" })]),
  c("C012", D, "main", G, [t("Montre-moi l'historique des consultations de {R6}.", { k: "history", r: "R6" })]),
  c("C013", D, "main", onPatient("R1"), [t("Il est venu combien de fois depuis le début ?", { k: "count", r: "R1" })]),
  c("C014", D, "main", onPatient("R2"), [t("Depuis quand je le suis ?", { k: "firstdate", r: "R2" })]),

  // ── Last consultation (8) ──────────────────────────────────────────────────
  c("C015", D, "main", onPatient("R3"), [t("De quoi avons-nous parlé à la dernière séance ?", { k: "lastnote", r: "R3" })]),
  c("C016", D, "main", G, [t("Quelle était la dernière consultation de {R4} ?", { k: "lastnote", r: "R4" })]),
  c("C017", D, "main", onPatient("R5"), [t("Résume sa dernière consultation.", { k: "lastnote", r: "R5" })]),
  c("C018", D, "main", onPatient("R6"), [t("Qu'est-ce que j'ai noté la dernière fois ?", { k: "lastnote", r: "R6" })]),
  c("C019", D, "main", G, [t("Rappelle-moi la dernière séance de {R1}.", { k: "lastnote", r: "R1" })]),
  c("C020", D, "main", onPatient("R2"), [t("C'est quand, sa dernière visite ?", { k: "lastdate", r: "R2" })]),
  c("C021", D, "main", onPatient("R3"), [t("À quelle date est-il venu pour la dernière fois ?", { k: "lastdate", r: "R3" })]),
  c("C022", D, "main", G, [t("La dernière consultation de {R4}, c'était quand ?", { k: "lastdate", r: "R4" })]),

  // ── Current medication (6) ─────────────────────────────────────────────────
  c("C023", D, "main", onPatient("T1"), [t("Il prend quoi comme traitement en ce moment ?", { k: "treat", r: "T1" })]),
  c("C024", D, "main", G, [t("Quels médicaments {T2} prend-il actuellement ?", { k: "treat", r: "T2" })]),
  c("C025", D, "main", onPatient("T3"), [t("Quel est son traitement actuel ?", { k: "treat", r: "T3" })]),
  c("C026", D, "main", onPatient("T4"), [t("Rappelle-moi son ordonnance en cours.", { k: "treat", r: "T4" })]),
  c("C027", D, "main", onPatient("T5"), [t("À quelle dose est-il actuellement ?", { k: "treat", r: "T5" })]),
  c("C028", D, "main", onPatient("N1"), [t("Quel traitement suit ce patient ?", { k: "treat", r: "N1" })]),

  // ── Previous medication (3) ────────────────────────────────────────────────
  c("C029", D, "main", onPatient("T1"), [t("Quel était son traitement précédent ?", { k: "prevtreat", r: "T1" })]),
  c("C030", D, "main", G, [t("Qu'est-ce que {N2} prenait avant ?", { k: "prevtreat", r: "N2" })]),
  c("C031", D, "main", onPatient("T2"), [t("Son traitement a-t-il changé récemment ?", { k: "prevtreat", r: "T2" })]),

  // ── Consultation dates and counts (10) ─────────────────────────────────────
  c("C032", D, "main", onPatient("R4"), [t("Combien de consultations a-t-il eues ?", { k: "count", r: "R4" })]),
  c("C033", D, "main", G, [t("Combien de fois {R5} est-il venu au cabinet ?", { k: "count", r: "R5" })]),
  c("C034", D, "main", onPatient("R6"), [t("Quel est le nombre total de séances ?", { k: "count", r: "R6" })]),
  c("C035", D, "main", onPatient("R1"), [t("Combien de fois l'ai-je vu en tout ?", { k: "count", r: "R1" })]),
  c("C036", D, "main", G, [t("Nombre de consultations pour {R2}.", { k: "count", r: "R2" })]),
  c("C037", D, "main", onPatient("R3"), [t("Quand l'ai-je vu pour la première fois ?", { k: "firstdate", r: "R3" })]),
  c("C038", D, "main", G, [t("Date de la première consultation de {R4} ?", { k: "firstdate", r: "R4" })]),
  c("C039", D, "main", onPatient("F1"), [t("Il a déjà eu une consultation ?", { k: "count", r: "F1" })]),
  c("C040", D, "main", onPatient("Z1"), [t("Combien de consultations a ce patient ?", { k: "count", r: "Z1" })]),
  c("C041", D, "main", G, [t("Quelles sont les trois dernières dates de visite de {R5} ?", { k: "prev", r: "R5", n: 3 })]),

  // ── Previous sessions (4) ──────────────────────────────────────────────────
  c("C042", D, "main", onPatient("R6"), [t("Montre-moi ses consultations précédentes.", { k: "prev", r: "R6", n: 3 })]),
  c("C043", D, "main", onPatient("R1"), [t("Qu'est-ce qui s'est dit pendant les séances d'avant ?", { k: "prev", r: "R1", n: 2 })]),
  c("C044", D, "main", G, [t("Les deux dernières consultations de {R2}, s'il te plaît.", { k: "prev", r: "R2", n: 2 })]),
  c("C045", D, "main", onPatient("R3"), [t("Montre-moi sa récente histoire de consultations.", { k: "prev", r: "R3", n: 3 })]),

  // ── Follow-up / next appointment (4) ───────────────────────────────────────
  c("C046", D, "main", onPatient("U1"), [t("A-t-il un prochain rendez-vous ?", { k: "nextappt", r: "U1" })]),
  c("C047", D, "main", G, [t("Quand revient {U2} ?", { k: "nextappt", r: "U2" })]),
  c("C048", D, "main", onPatient("R4"), [t("Est-ce que je l'ai programmé pour une prochaine séance ?", { k: "nextappt", r: "R4" })]),
  c("C049", D, "main", onPatient("U3"), [t("Quel est son prochain rendez-vous ?", { k: "nextappt", r: "U3" })]),

  // ── Clinical evolution / recent news (3) ───────────────────────────────────
  c("C050", D, "main", onPatient("R5"), [t("Comment a-t-il évolué ces derniers temps ?", { k: "evolution", r: "R5" })]),
  c("C051", D, "main", G, [t("Fais-moi un résumé de l'évolution clinique de {R6}.", { k: "evolution", r: "R6" })]),
  c("C052", D, "main", onPatient("R1"), [t("Quoi de neuf sur ce patient ?", { k: "evolution", r: "R1" })]),

  // ── Available records (3) ──────────────────────────────────────────────────
  c("C053", D, "main", onPatient("R2"), [t("Quels documents a-t-il dans son dossier ?", { k: "documents", r: "R2" })]),
  c("C054", D, "main", onPatient("S1"), [t("A-t-il des échelles enregistrées ?", { k: "scales", r: "S1" })]),
  c("C055", D, "main", onPatient("R3"), [t("Quels diagnostics sont enregistrés pour lui ?", { k: "diag", r: "R3" })]),
];
