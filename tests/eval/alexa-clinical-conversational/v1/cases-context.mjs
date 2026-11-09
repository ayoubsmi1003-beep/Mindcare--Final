/**
 * C200 · domain "context": 45 conversations testing patient identity and context across turns.
 * Each case is one conversation; every turn is judged. French only.
 * Roles (R*, T*, N*, H*, S*, D*, OPEN, NP1) are resolved by generate-oracles.mjs from SQL.
 */
import { c, t } from "./helpers.mjs";

const D = "context";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const NEXT_DAY = { asOf: "2026-11-10T08:00:00+01:00" };
const AGENDA_DAY = { asOf: "2026-10-26T09:30:00+01:00" };

export const cases = [
  // ── On the consultation screen: "ce patient" needs no name (10) ────────────
  c("C056", D, "main", onConsult("T1"), [t("Quels sont ses derniers médicaments ?", { k: "treat", r: "T1" })]),
  c("C057", D, "main", onConsult("R2"), [t("Combien de fois est-il venu ?", { k: "count", r: "R2" })]),
  c("C058", D, "main", onConsult("R3"), [t("Son historique, s'il te plaît.", { k: "history", r: "R3" })]),
  c("C059", D, "main", onConsult("T2"), [t("Il a déjà pris quoi ?", { k: "treat", r: "T2" })]),
  c("C060", D, "main", onConsult("R4"), [t("Résume ce malade.", { k: "summary", r: "R4" })]),
  c("C061", D, "main", onConsult("R5"), [t("C'est quand, sa dernière visite ?", { k: "lastdate", r: "R5" })]),
  c("C062", D, "main", onConsult("T3"), [t("Son traitement actuel ?", { k: "treat", r: "T3" })]),
  c("C063", D, "main", onConsult("R6"), [t("Qu'est-ce qu'on sait sur ce malade ?", { k: "summary", r: "R6" })]),
  c("C064", D, "main", onConsult("OPEN", "open"), [t("Qui est ce patient ?", { k: "who", r: "OPEN" })]),
  c("C065", D, "main", onConsult("OPEN", "open"), [t("Depuis quand il vient chez nous ?", { k: "firstdate", r: "OPEN" })]),

  // ── Named patient, then pronouns (8) ───────────────────────────────────────
  c("C066", D, "main", G, [
    t("Donne-moi les informations de {R1}.", { k: "summary", r: "R1" }),
    t("Et son dernier traitement ?", { k: "treat", r: "R1" }),
    t("Et ses consultations précédentes ?", { k: "prev", r: "R1", n: 3 })]),
  c("C067", D, "main", G, [
    t("Parle-moi de {T1}.", { k: "summary", r: "T1" }),
    t("Et ses médicaments ?", { k: "treat", r: "T1" }),
    t("Combien de fois est-il venu ?", { k: "count", r: "T1" })]),
  c("C068", D, "main", G, [
    t("Je voudrais le dossier de {R2}.", { k: "summary", r: "R2" }),
    t("Quand est-il venu la dernière fois ?", { k: "lastdate", r: "R2" }),
    t("Et la première fois ?", { k: "firstdate", r: "R2" })]),
  c("C069", D, "main", G, [
    t("Que sait-on sur {R3} ?", { k: "summary", r: "R3" }),
    t("Son historique ?", { k: "history", r: "R3" }),
    t("Et sa dernière consultation ?", { k: "lastnote", r: "R3" })]),
  c("C070", D, "main", G, [
    t("Informations sur {T2}.", { k: "summary", r: "T2" }),
    t("Quels médicaments prend-il ?", { k: "treat", r: "T2" }),
    t("Depuis quand je le suis ?", { k: "firstdate", r: "T2" })]),
  c("C071", D, "main", G, [
    t("Résume {R4}.", { k: "summary", r: "R4" }),
    t("Et combien de séances ?", { k: "count", r: "R4" }),
    t("Quelle est sa dernière date de visite ?", { k: "lastdate", r: "R4" })]),
  c("C072", D, "main", G, [
    t("Dis-moi ce que tu as sur {N1}.", { k: "summary", r: "N1" }),
    t("Il prend un traitement ?", { k: "treat", r: "N1" }),
    t("Et ses documents ?", { k: "documents", r: "N1" })]),
  c("C073", D, "main", G, [
    t("Donne-moi le dossier de {R5}.", { k: "summary", r: "R5" }),
    t("Et son traitement ?", { k: "treat", r: "R5" }),
    t("Et sa dernière consultation ?", { k: "lastdate", r: "R5" })]),

  // ── Explicit switching between patients (8) ────────────────────────────────
  c("C074", D, "main", G, [
    t("Parle-moi de {R1}.", { k: "summary", r: "R1" }),
    t("Maintenant, parle-moi de {R2}.", { k: "summary", r: "R2", decoys: ["R1"] }),
    t("Et son dernier traitement ?", { k: "treat", r: "R2", decoys: ["R1"] })]),
  c("C075", D, "main", G, [
    t("Quel est le traitement de {T1} ?", { k: "treat", r: "T1" }),
    t("Et celui de {T2} ?", { k: "treat", r: "T2", decoys: ["T1"] }),
    t("Combien de consultations a-t-il eues ?", { k: "count", r: "T2", decoys: ["T1"] })]),
  c("C076", D, "main", G, [
    t("Combien de consultations a {R3} ?", { k: "count", r: "R3" }),
    t("Et {R4} ?", { k: "count", r: "R4", decoys: ["R3"] }),
    t("Reviens à {R3} : quand est-il venu la dernière fois ?", { k: "lastdate", r: "R3", decoys: ["R4"] })]),
  c("C077", D, "main", G, [
    t("Dernière consultation de {R5}.", { k: "lastdate", r: "R5" }),
    t("Pour {R6} maintenant.", { k: "lastdate", r: "R6", decoys: ["R5"] }),
    t("Et sa première visite ?", { k: "firstdate", r: "R6", decoys: ["R5"] })]),
  c("C078", D, "main", onPatient("R1"), [
    t("Son historique ?", { k: "history", r: "R1" }),
    t("Et {R2} ?", { k: "summary", r: "R2", decoys: ["R1"] }),
    t("Son traitement ?", { k: "treat", r: "R2", decoys: ["R1"] })]),
  c("C079", D, "main", G, [
    t("Donne-moi les infos de {R3}.", { k: "summary", r: "R3" }),
    t("Maintenant celles de {R1}.", { k: "summary", r: "R1", decoys: ["R3"] }),
    t("Et sa dernière date de visite ?", { k: "lastdate", r: "R1", decoys: ["R3"] })]),
  c("C080", D, "main", G, [
    t("Traitement de {N1} ?", { k: "treat", r: "N1" }),
    t("Maintenant celui de {T3}.", { k: "treat", r: "T3", decoys: ["N1"] }),
    t("Combien de visites ?", { k: "count", r: "T3", decoys: ["N1"] })]),
  c("C081", D, "main", G, [
    t("Résumé de {R2}.", { k: "summary", r: "R2" }),
    t("Passons à {R5}.", { k: "summary", r: "R5", decoys: ["R2"] }),
    t("Qu'est-ce qu'on a dit à sa dernière séance ?", { k: "lastnote", r: "R5", decoys: ["R2"] })]),

  // ── Same first name: never guess (4) ───────────────────────────────────────
  c("C082", D, "main", G, [
    t("Je voudrais des nouvelles de {HA.first}.", { k: "clarify", decoys: ["HA", "HB"] }),
    t("{HA}.", { k: "summary", r: "HA", decoys: ["HB"] }),
    t("Et son traitement ?", { k: "treat", r: "HA", decoys: ["HB"] })]),
  c("C083", D, "main", G, [
    t("Qu'est-ce qu'on a sur {HC.first} ?", { k: "clarify", decoys: ["HC", "HD"] }),
    t("Je parle de {HC}.", { k: "summary", r: "HC", decoys: ["HD"] })]),
  c("C084", D, "main", G, [
    t("Dernière consultation de {HB.first} ?", { k: "clarify", decoys: ["HA", "HB"] }),
    t("{HB}.", { k: "lastdate", r: "HB", decoys: ["HA"] })]),
  c("C085", D, "main", G, [
    t("Combien de consultations a {HD.first} ?", { k: "clarify", decoys: ["HC", "HD"] }),
    t("C'est {HD}.", { k: "count", r: "HD", decoys: ["HC"] })]),

  // ── Similar names (3) ──────────────────────────────────────────────────────
  c("C086", D, "main", G, [t("Informations sur {SA}.", { k: "summary", r: "SA", decoys: ["SB"] })]),
  c("C087", D, "main", G, [t("Informations sur {SB}.", { k: "summary", r: "SB", decoys: ["SA"] })]),
  c("C088", D, "main", G, [t("Quelle est la dernière consultation de {SA} ?", { k: "lastdate", r: "SA", decoys: ["SB"] })]),

  // ── Identical full names: must ask (2) ─────────────────────────────────────
  c("C089", D, "main", G, [t("Donne-moi le dossier de {DA}.", { k: "clarify", decoys: ["DA", "DB"] })]),
  c("C090", D, "main", G, [t("Combien de consultations a {DB} ?", { k: "clarify", decoys: ["DA", "DB"] })]),

  // ── The same name written differently (3) ──────────────────────────────────
  c("C091", D, "main", G, [t("Résumé de {R1.up}.", { k: "summary", r: "R1" })]),
  c("C092", D, "main", G, [t("Que sait-on sur {R2.rev} ?", { k: "summary", r: "R2" })]),
  c("C093", D, "main", G, [t("Dernière visite de {R3.plain} ?", { k: "lastdate", r: "R3" })]),

  // ── The screen overrides stale conversation context (3) ────────────────────
  c("C094", D, "main", G, [
    t("Parle-moi de {R1}.", { k: "summary", r: "R1" }),
    t("Quel est son dernier traitement ?", { k: "treat", r: "R2", decoys: ["R1"] }, { page: onConsult("R2") })]),
  c("C095", D, "main", onPatient("R3"), [
    t("Son historique ?", { k: "history", r: "R3" }),
    t("Ce patient prend quoi ?", { k: "treat", r: "T4", decoys: ["R3"] }, { page: onConsult("T4") })]),
  c("C096", D, "main", onConsult("R5"), [
    t("Ce patient a combien de consultations ?", { k: "count", r: "R5" }),
    t("Combien de consultations a ce patient ?", { k: "count", r: "R6", decoys: ["R5"] }, { page: onConsult("R6") })]),

  // ── After unrelated turns (2) ──────────────────────────────────────────────
  c("C097", D, "main", G, [
    t("Dernière consultation de {R1} ?", { k: "lastdate", r: "R1" }),
    t("Quelle heure est-il ?", { k: "plain", noPatientRead: true }),
    t("Merci.", { k: "plain" }),
    t("Et son dernier traitement ?", { k: "treat", r: "R1" })]),
  c("C098", D, "main", G, [
    t("Résumé de {T1}.", { k: "summary", r: "T1" }),
    t("Combien de patients ai-je aujourd'hui ?", { k: "a_count", day: "today", noPatientRead: true }),
    t("Et ses médicaments ?", { k: "treat", r: "T1" })], AGENDA_DAY),

  // ── "Patient suivant" through the existing agenda workflow (2) ─────────────
  c("C099", D, "fixture", G, [
    t("Patient suivant.", { k: "nextpatient", day: "today" }),
    t("Quels sont ses derniers médicaments ?", { k: "treat", r: "NP1" }),
    t("Son historique ?", { k: "history", r: "NP1" })], NEXT_DAY),
  c("C100", D, "fixture", G, [
    t("Qui est le prochain ?", { k: "nextpatient", day: "today" }),
    t("Combien de fois est-il venu ?", { k: "count", r: "NP1" })], NEXT_DAY),
];
