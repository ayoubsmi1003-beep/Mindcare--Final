/**
 * C270 · domain "variation": 15 French turns that push the wording itself: typing and dictation slips, filler words,
 * telegraphic fragments, long polite detours, reversed and lowercase names. Each intent is an ordinary one; only the
 * form is unusual.
 */
import { c, t } from "./helpers.mjs";

const D = "variation";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const F = "fr";
const DAY = { asOf: "2026-10-26T09:30:00+01:00" };
const FIN = { asOf: "2026-09-27T18:00:00+01:00" };
const v = (id, form, page, say, expect, db = "main", options = {}) => c(id, D, db, page, [t(say, expect, [F, form])], options);

export const cases = [
  v("V001", "typo", onPatient("R1"), "traitemnt actuel du patiant", { k: "treat", r: "R1" }),
  v("V002", "conversational", onPatient("R2"), "Euh… on l'a reçu la dernière fois… c'était quel jour, déjà ?", { k: "lastdate", r: "R2" }),
  v("V003", "typo", G, "conslutations combien pour {R3.plain}", { k: "count", r: "R3" }),
  v("V004", "formal", onPatient("R4"), "Tu pourrais, si ça ne t'embête pas, me rappeler en quelques mots où on en est avec ce monsieur ?", { k: "summary", r: "R4" }),
  v("V005", "short", G, "rdv demain combien", { k: "a_count", range: "tomorrow" }, "main", DAY),
  v("V006", "informal", G, "les sous rentrés ce mois", { k: "f_revenue", range: "month" }, "fixture", FIN),
  v("V007", "short", onPatient("R5"), "Le plan, la dernière fois ?", { k: "note_area", area: "plan", r: "R5" }),
  v("V008", "conversational", onPatient("T4"), "Sa sertraline, il la prend depuis quand ?", { k: "treat_start", r: "T4" }),
  v("V009", "typo", onConsult("R6"), "premiere consultation date", { k: "firstdate", r: "R6" }),
  v("V010", "wordorder", G, "{R7.rev}, son passage le plus récent remonte à quand ?", { k: "lastdate", r: "R7" }),
  v("V011", "informal", onPatient("R8"), "Ça fait combien de fois qu'il vient, en tout et pour tout ?", { k: "count", r: "R8" }),
  v("V012", "informal", G, "qui c'est qui vient en premier demain matin", { k: "a_first", range: "tomorrow" }, "main", DAY),
  v("V013", "short", onPatient("R9"), "allergie ?", { k: "absent", section: "allergies", r: "R9" }),
  v("V014", "typo", G, "anulations de la semaine passée", { k: "a_cancelled", range: "lastweek" }, "main", DAY),
  v("V015", "short", onPatient("S1"), "score échelle", { k: "scales", r: "S1" }),
];
