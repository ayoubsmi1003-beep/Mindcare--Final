/**
 * C201 · domain "variation": 10 more ways of asking everyday patient questions: very formal, very short, chatty, typos, Darija.
 */
import { c, t } from "./helpers.mjs";

const D = "variation";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const v = (id, tag, page, say, expect) => c(id, D, "main", page, [t(say, expect, tag)]);

export const cases = [
  v("V191", ["fr", "formal"], onPatient("T1"), "Auriez-vous l'obligeance de me communiquer la liste des médicaments actuellement prescrits à ce patient ?", { k: "treat", r: "T1" }),
  v("V192", ["fr", "informal"], onPatient("R2"), "Bon alors lui, il vient depuis longtemps ?", { k: "firstdate", r: "R2" }),
  v("V193", ["fr", "short"], onPatient("R3"), "Visites ?", { k: "count", r: "R3" }),
  v("V194", ["fr", "conversational"], onPatient("R4"), "Dis-moi tout ce que tu sais sur lui, j'ai cinq minutes.", { k: "summary", r: "R4" }),
  v("V195", ["mx", "informal"], onPatient("R5"), "Had l patient ja bzaf d l marat ?", { k: "count", r: "R5" }),
  v("V196", ["la", "short"], onPatient("T3"), "Dwa dyalou ?", { k: "treat", r: "T3" }),
  v("V197", ["ar", "informal"], onPatient("R7"), "آخر مرة جا فيها إمتى؟", { k: "lastdate", r: "R7" }),
  v("V198", ["fr", "typo"], onPatient("R8"), "kel est sa derniere note", { k: "lastnote", r: "R8" }),
  v("V199", ["fr", "synonym"], G, "Quand est-ce que {R9} a été examiné pour la dernière fois ?", { k: "lastdate", r: "R9" }),
  v("V200", ["fr", "wordorder"], onConsult("T4"), "Aujourd'hui, à ce patient, quels médicaments sont donnés ?", { k: "treat", r: "T4" }),
];
