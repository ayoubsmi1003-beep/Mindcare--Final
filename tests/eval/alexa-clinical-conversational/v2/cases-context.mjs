/**
 * C201 · domain "context": 45 new conversations on patient identity and context: the consultation screen, pronouns and follow-ups,
 * a patient other than the one on screen, same first names, similar names, neutral turns in between, "next patient".
 * Roles (R*, T*, N*, F*, Z*, U*, S*, H*, D*, OPEN, NP1) are resolved by generate-oracles.mjs from SQL, never read by the assistant.
 */
import { c, t } from "./helpers.mjs";

const D = "context";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const NEXT_DAY = { asOf: "2026-11-10T08:00:00+01:00" };
const AGENDA_DAY = { asOf: "2026-10-26T09:30:00+01:00" };
const one = (id, page, say, expect, tag) => c(id, D, "main", page, [t(say, expect, tag)]);

export const cases = [
  // ── On the consultation screen, nobody is named (8) ────────────────────────
  one("V056", onConsult("T2"), "Et côté médicaments, il est sous quoi ?", { k: "treat", r: "T2" }, ["fr", "implicit"]),
  one("V057", onConsult("R6"), "Chhal dar men consultation ?", { k: "count", r: "R6" }, ["la", "pronoun"]),
  one("V058", onConsult("R8"), "شحال من استشارة دار هاد المريض", { k: "count", r: "R8" }, ["ar", "pronoun"]),
  one("V059", onConsult("R3"), "Dernier passage ?", { k: "lastdate", r: "R3" }, ["fr", "short"]),
  one("V060", onConsult("T4"), "Wach kaykhod chi dwa ? Lesquels ?", { k: "treat", r: "T4" }, ["mx", "pronoun"]),
  one("V061", onConsult("R9"), "Depuis combien de temps on le suit ?", { k: "firstdate", r: "R9" }, ["fr", "pronoun"]),
  one("V062", onConsult("R10"), "Remets-moi dans le bain pour ce patient", { k: "summary", r: "R10" }, ["fr", "informal"]),
  one("V063", onConsult("R2"), "Akhir ziara dyalou ?", { k: "lastdate", r: "R2" }, ["la", "short"]),

  // ── A patient is named, then only pronouns and follow-ups (8) ──────────────
  c("V064", D, "main", G, [
    t("Je cherche des infos sur {R4}", { k: "summary", r: "R4" }, ["fr", "conversational"]),
    t("Ça fait combien de passages au total ?", { k: "count", r: "R4" }, ["fr", "pronoun"]),
    t("Et depuis quelle date ?", { k: "firstdate", r: "R4" }, ["fr", "followup"])]),
  c("V065", D, "main", G, [
    t("{T3} : quels médicaments ?", { k: "treat", r: "T3" }, ["fr", "short"]),
    t("On l'a vu pour la dernière fois quand ?", { k: "lastdate", r: "T3" }, ["fr", "pronoun"])]),
  c("V066", D, "main", G, [
    t("3tini ma3lomat 3la {T1}", { k: "summary", r: "T1" }, ["la", "direct"]),
    t("Chnou kayakhod daba ?", { k: "treat", r: "T1" }, ["la", "pronoun"])]),
  c("V067", D, "main", G, [
    t("ملخص على {R7}", { k: "summary", r: "R7" }, ["ar", "short"]),
    t("وآخر زيارة إمتى كانت؟", { k: "lastdate", r: "R7" }, ["ar", "followup"])]),
  c("V068", D, "main", G, [
    t("Dossier dyal {R8}", { k: "summary", r: "R8" }, ["mx", "short"]),
    t("Chhal men consultation 3ando ?", { k: "count", r: "R8" }, ["mx", "pronoun"])]),
  c("V069", D, "main", G, [
    t("Parle-moi de {R9}.", { k: "summary", r: "R9" }, ["fr", "direct"]),
    t("Donne-moi ses trois dernières consultations", { k: "prev", r: "R9", n: 3 }, ["fr", "followup"])]),
  c("V070", D, "main", onPatient("T4"), [
    t("Que prend-il ?", { k: "treat", r: "T4" }, ["fr", "short"]),
    t("Et combien de fois est-il venu ?", { k: "count", r: "T4" }, ["fr", "followup"]),
    t("Dernière note ?", { k: "lastnote", r: "T4" }, ["fr", "short"])]),
  c("V071", D, "main", G, [
    t("{R10}, dernière date de visite ?", { k: "lastdate", r: "R10" }, ["fr", "wordorder"]),
    t("Sa première aussi", { k: "firstdate", r: "R10" }, ["fr", "followup"])]),

  // ── The doctor names a patient other than the one on screen (7) ────────────
  c("V072", D, "main", onPatient("R1"), [t("Donne-moi plutôt le dossier de {R2}", { k: "summary", r: "R2", decoys: ["R1"] }, ["fr", "otherpatient"])]),
  c("V073", D, "main", onConsult("R3"), [t("Et {R4}, combien de fois est-il venu ?", { k: "count", r: "R4", decoys: ["R3"] }, ["fr", "otherpatient"])]),
  c("V074", D, "main", onPatient("R5"), [t("Pas lui : {R6}, quelle est sa dernière visite ?", { k: "lastdate", r: "R6", decoys: ["R5"] }, ["fr", "otherpatient"])]),
  c("V075", D, "main", onPatient("R7"), [t("Chouf li {R8} : chhal men consultation 3ando ?", { k: "count", r: "R8", decoys: ["R7"] }, ["mx", "otherpatient"])]),
  c("V076", D, "main", onConsult("T1"), [t("Et {T2}, il prend quoi ?", { k: "treat", r: "T2", decoys: ["T1"] }, ["fr", "otherpatient"])]),
  c("V077", D, "main", onPatient("R9"), [t("لا، بغيت ملف {R10}", { k: "summary", r: "R10", decoys: ["R9"] }, ["ar", "otherpatient"])]),
  c("V078", D, "main", onPatient("R2"), [t("Wakha, daba 3tini l'historique dyal {R3}", { k: "history", r: "R3", decoys: ["R2"] }, ["la", "otherpatient"])]),

  // ── Same first name or identical name: ask, never guess (5) ────────────────
  c("V079", D, "main", G, [
    t("Tu as quoi sur {HA.first} ?", { k: "clarify", decoys: ["HA", "HB"] }, ["fr", "informal"]),
    t("Celui qui s'appelle {HA.last}", { k: "summary", r: "HA", decoys: ["HB"] }, ["fr", "followup"])]),
  c("V080", D, "main", G, [
    t("Dossier de {HC.first}", { k: "clarify", decoys: ["HC", "HD"] }, ["fr", "short"]),
    t("{HC}, sa dernière visite ?", { k: "lastdate", r: "HC", decoys: ["HD"] }, ["fr", "followup"])]),
  c("V081", D, "main", G, [t("3tini dossier dyal {HB.first}", { k: "clarify", decoys: ["HA", "HB"] }, ["la", "direct"])]),
  c("V082", D, "main", G, [t("عطيني معلومات على {HD.first}", { k: "clarify", decoys: ["HC", "HD"] }, ["ar", "direct"])]),
  c("V083", D, "main", G, [t("Il y a {DA} dans la base, montre-moi ce qu'on a", { k: "clarify", decoys: ["DA", "DB"] }, ["fr", "conversational"])]),

  // ── Similar names (3) ──────────────────────────────────────────────────────
  c("V084", D, "main", G, [t("Montre-moi {SA} stp", { k: "summary", r: "SA", decoys: ["SB"] }, ["fr", "short"])]),
  c("V085", D, "main", G, [t("{SB} il a été vu quand pour la dernière fois ?", { k: "lastdate", r: "SB", decoys: ["SA"] }, ["fr", "informal"])]),
  c("V086", D, "main", G, [t("Chhal men consultation 3and {SA} ?", { k: "count", r: "SA", decoys: ["SB"] }, ["mx", "direct"])]),

  // ── Unrelated turns in between (3) ─────────────────────────────────────────
  c("V087", D, "main", G, [
    t("Parle-moi de {R3}.", { k: "summary", r: "R3" }, ["fr", "direct"]),
    t("On est quel jour aujourd'hui ?", { k: "plain", noPatientRead: true }, ["fr", "short"]),
    t("Et ses deux dernières visites ?", { k: "prev", r: "R3", n: 2 }, ["fr", "followup"])]),
  c("V088", D, "main", G, [
    t("{T2} : médicaments ?", { k: "treat", r: "T2" }, ["fr", "short"]),
    t("Il y a combien de consultations prévues demain ?", { k: "a_count", day: "tomorrow", noPatientRead: true }, ["fr", "direct"]),
    t("Et sa dernière note ?", { k: "lastnote", r: "T2" }, ["fr", "followup"])], AGENDA_DAY),
  c("V089", D, "main", G, [
    t("Dossier dyal {R6}", { k: "summary", r: "R6" }, ["mx", "short"]),
    t("Ok parfait, merci beaucoup", { k: "plain" }, ["fr", "short"]),
    t("Wakteh akhir mara ja ?", { k: "lastdate", r: "R6" }, ["mx", "pronoun"])]),

  // ── "Next patient" (3), on the fixture whose agenda holds the clock-controlled appointment ─
  c("V090", D, "fixture", G, [
    t("Patient suivant s'il vous plaît", { k: "nextpatient", day: "today" }, ["fr", "formal"]),
    t("Son dossier en résumé", { k: "summary", r: "NP1" }, ["fr", "pronoun"])], NEXT_DAY),
  c("V091", D, "fixture", G, [
    t("Chkoun l patient li jay ?", { k: "nextpatient", day: "today" }, ["la", "direct"]),
    t("Chnou kayakhod men dwa ?", { k: "treat", r: "NP1" }, ["la", "pronoun"])], NEXT_DAY),
  c("V092", D, "fixture", G, [
    t("Qui est-ce que je vois après ?", { k: "nextpatient", day: "today" }, ["fr", "informal"]),
    t("Et ses derniers médicaments ?", { k: "treat", r: "NP1" }, ["fr", "followup"])], NEXT_DAY),

  // ── Who is on screen (2) ───────────────────────────────────────────────────
  one("V093", onConsult("OPEN", "open"), "Peux-tu me dire le nom du patient en cours ?", { k: "who", r: "OPEN" }, ["fr", "formal"]),
  one("V094", onConsult("OPEN", "open"), "Chkoun had l mrid ?", { k: "who", r: "OPEN" }, ["la", "short"]),

  // ── Few or no consultations (3) ────────────────────────────────────────────
  one("V095", G, "Les consultations de {F1}, c'est quand ?", { k: "prev", r: "F1", n: 2 }, ["fr", "wordorder"]),
  one("V096", G, "{Z1} est déjà venu au cabinet ?", { k: "count", r: "Z1" }, ["fr", "conversational"]),
  one("V097", onPatient("Z1"), "3ando chi consultation ?", { k: "count", r: "Z1" }, ["mx", "pronoun"]),

  // ── More everyday turns (3) ────────────────────────────────────────────────
  one("V098", onPatient("T2"), "شنو الدوا اللي كياخد؟", { k: "treat", r: "T2" }, ["ar", "short"]),
  one("V099", onConsult("R7"), "Résume-moi son dossier en trois phrases", { k: "summary", r: "R7" }, ["fr", "formal"]),
  one("V100", G, "Akhir ziara dyal {T5} wakteh kanet ?", { k: "lastdate", r: "T5" }, ["la", "wordorder"]),
];
