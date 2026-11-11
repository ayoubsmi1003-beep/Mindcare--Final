/**
 * C270 · domain "context": 45 French turns about conversation and patient identity. Mostly real conversations: a section asked
 * after a patient is opened, a period changed, another patient named while a consultation is open and then the return to it,
 * a correction of the patient, shorter / more detailed answers, a detour to the agenda or finance and back, record → book
 * knowledge on the same molecule → record, a first name that needs a question. Every turn is scored on its own.
 * `{R7}` etc. are role placeholders resolved from SQL at run time.
 */
import { c, t } from "./helpers.mjs";

const D = "context";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const F = "fr";
const AGENDA_DAY = { asOf: "2026-10-26T09:30:00+01:00" };
const FIN = { asOf: "2026-09-27T18:00:00+01:00" };
const one = (id, page, say, expect, form) => c(id, D, "main", page, [t(say, expect, [F, form])]);
const conv = (id, page, ...turns) => c(id, D, "main", page, turns, AGENDA_DAY);
const book = (facts) => ({ k: "book", alts: [{ textAll: facts }], quoteFacts: facts, requiredTools: ["search_knowledge"] });

export const cases = [
  // A patient opened by name, then sections without the name (3)
  conv("X001", G,
    t("On s'occupe de {R1} : qu'est-ce qui ressort de son dossier ?", { k: "summary", r: "R1" }, [F, "direct"]),
    t("Son plan de la dernière fois ?", { k: "note_area", area: "plan", r: "R1" }, [F, "followup"]),
    t("Côté médicaments, il en est où ?", { k: "treat", r: "R1" }, [F, "followup"])),

  // The period changes, the patient stays (2)
  conv("X002", onPatient("R2"),
    t("Depuis janvier, combien de séances au compteur ?", { k: "count_period", range: "year", r: "R2" }, [F, "short"]),
    t("Même calcul pour l'année d'avant.", { k: "count_period", range: "lastyear", r: "R2" }, [F, "period"])),

  // Another patient named during an open consultation, then back to the consultation's patient (3)
  conv("X003", onConsult("R3"),
    t("Quel âge a {R4} ?", { k: "age", r: "R4" }, [F, "otherpatient"]),
    t("Il remonte à quand, son dernier rendez-vous honoré ?", { k: "lastdate", r: "R4" }, [F, "followup"]),
    t("Revenons à mon patient : sa dernière note ?", { k: "lastnote", r: "R3" }, [F, "followup"])),

  // The doctor corrects the patient (3)
  conv("X004", G,
    t("Je cherche la dernière venue de {T1}.", { k: "lastdate", r: "T1" }, [F, "short"]),
    t("Non, je voulais dire {T2}.", { k: "lastdate", r: "T2", decoys: ["T1"] }, [F, "otherpatient"]),
    t("Et pour celui-ci, quelle ordonnance en cours ?", { k: "treat", r: "T2", decoys: ["T1"] }, [F, "followup"])),

  // Record → books on the same molecule → record (3)
  conv("X005", onPatient("T3"),
    t("Rappelle-moi ce qu'il a sur son ordonnance.", { k: "treat", r: "T3" }, [F, "direct"]),
    t("Et d'après les références, quels effets indésirables donne la sertraline ?", book(["sexual dysfunction", "gastrointestinal"]), [F, "followup"]),
    t("Sa dose à lui, elle a changé depuis le début ?", { k: "prevtreat", r: "T3" }, [F, "followup"])),

  // A first name shared by two patients, then the answer (2)
  conv("X006", G,
    t("J'ai besoin des infos administratives de {HA.first}.", { k: "clarify", decoys: ["HA", "HB"] }, [F, "short"]),
    t("Le bon, c'est {HA}.", { k: "who", r: "HA", decoys: ["HB"] }, [F, "followup"])),

  // Shorter, then more detail (3)
  conv("X007", onPatient("R5"),
    t("Synthèse rapide de son dossier.", { k: "summary", r: "R5" }, [F, "short"]),
    t("Plus court, s'il te plaît.", { k: "summary", r: "R5" }, [F, "followup"]),
    t("Donne-moi plus de détails sur la dernière séance.", { k: "lastnote", r: "R5" }, [F, "followup"])),

  // Agenda, then a patient named in the middle (3)
  conv("X008", G,
    t("Demain, le planning compte combien de créneaux pris ?", { k: "a_count", range: "tomorrow" }, [F, "synonym"]),
    t("Et lequel est le premier ?", { k: "a_first", range: "tomorrow" }, [F, "followup"]),
    t("Au fait, {U1} vient quand ?", { k: "nextappt", r: "U1" }, [F, "otherpatient"])),

  // A detour to the agenda and back to the patient on screen (3)
  conv("X009", onPatient("R6"),
    t("Son passage le plus récent, tu as la date ?", { k: "lastdate", r: "R6" }, [F, "short"]),
    t("Des désistements la semaine passée ?", { k: "a_cancelled", range: "lastweek" }, [F, "direct"]),
    t("Retour à lui : sa toute première séance ?", { k: "firstdate", r: "R6" }, [F, "followup"])),

  // Finance follow-up (2)
  c("X010", D, "fixture", G, [
    t("Qu'a-t-on encaissé jusqu'ici ce mois-ci ?", { k: "f_revenue", range: "month" }, [F, "short"]),
    t("Cette somme correspond à combien de consultations réglées ?", { k: "f_sessions", range: "month" }, [F, "followup"]),
  ], FIN),

  // The consultation screen, three questions without a name (3)
  conv("X011", onConsult("R7"),
    t("Rappelle-moi qui j'ai en face.", { k: "who", r: "R7" }, [F, "conversational"]),
    t("Ses scores d'échelles ?", { k: "scales", r: "R7" }, [F, "followup"]),
    t("Depuis le début, ça lui fait combien de passages ?", { k: "count", r: "R7" }, [F, "followup"])),

  // Close names: the follow-up must stay on the named patient (2)
  conv("X012", G,
    t("Ouvre-moi {SA}.", { k: "summary", r: "SA", decoys: ["SB"] }, [F, "short"]),
    t("Son compteur de séances est à combien ?", { k: "count", r: "SA", decoys: ["SB"] }, [F, "pronoun"])),

  // Another patient named on a patient's page, then back (2)
  conv("X013", onPatient("R8"),
    t("Les allergies de {R9} ?", { k: "absent", section: "allergies", r: "R9" }, [F, "otherpatient"]),
    t("Et celles de ce patient-ci ?", { k: "absent", section: "allergies", r: "R8" }, [F, "followup"])),

  // Next patient, then a question about them (2)
  c("X014", D, "fixture", G, [
    t("Qui vient ensuite ?", { k: "nextpatient" }, [F, "short"]),
    t("Ce patient-là, on l'a déjà reçu souvent ?", { k: "count", r: "NP1" }, [F, "pronoun"]),
  ]),

  // Diagnosis and its onset (2)
  c("X015", D, "fixture", onPatient("DX1"), [
    t("Son diagnostic principal ?", { k: "diag", r: "DX1" }, [F, "short"]),
    t("Il a été posé à quelle date ?", { k: "diag_onset", r: "DX1" }, [F, "followup"]),
  ], FIN),

  // A summary, an unrelated agenda question, then back to the earlier patient (3)
  conv("X016", G,
    t("Où en est {R10} dans son suivi, en résumé ?", { k: "summary", r: "R10" }, [F, "direct"]),
    t("Merci. Combien de patients sont prévus aujourd'hui ?", { k: "a_count", range: "today" }, [F, "conversational"]),
    t("Et pour {R10}, son prochain passage est prévu quand ?", { k: "nextappt", r: "R10" }, [F, "followup"])),

  // One-turn cases: another patient than the one on screen (4)
  one("X017", onConsult("R1"), "Pour {R2}, pas celui-ci : sa dernière note ?", { k: "lastnote", r: "R2", decoys: ["R1"] }, "otherpatient"),
  one("X018", onPatient("R3"), "Je parle de {R4} : combien de séances ?", { k: "count", r: "R4", decoys: ["R3"] }, "otherpatient"),
  one("X019", onConsult("OPEN", "open"), "Il s'agit de quel patient ?", { k: "who", r: "OPEN" }, "conversational"),
  one("X020", onPatient("R5"), "Depuis combien d'années est-il suivi chez nous ?", { k: "firstdate", r: "R5" }, "conversational"),
];
