/**
 * C202 · domain "variation": 10 more French ways of asking everyday patient questions: very formal, telegraphic, chatty, other word order.
 */
import { c, t } from "./helpers.mjs";

const D = "variation";
const G = { type: "global" };
const onPatient = (role) => ({ type: "patient", role });
const onConsult = (role, which = "last") => ({ type: "consultation", role, which });
const v = (id, tag, page, say, expect) => c(id, D, "main", page, [t(say, expect, tag)]);
const F = "fr";

export const cases = [
  v("W191", [F, "formal"], onPatient("T1"), "Je souhaiterais connaître la posologie actuelle suivie par ce patient.", { k: "treat", r: "T1" }),
  v("W192", [F, "informal"], onPatient("R2"), "Ça date de quand sa première fois chez nous ?", { k: "firstdate", r: "R2" }),
  v("W193", [F, "short"], onPatient("R3"), "Séances ?", { k: "count", r: "R3" }),
  v("W194", [F, "conversational"], onPatient("R4"), "Allez, fais-moi un topo rapide, il arrive.", { k: "summary", r: "R4" }),
  v("W195", [F, "synonym"], onPatient("R5"), "Quel nombre de passages totalise ce patient ?", { k: "count", r: "R5" }),
  v("W196", [F, "short"], onPatient("T3"), "Cachets ?", { k: "treat", r: "T3" }),
  v("W197", [F, "wordorder"], onPatient("R7"), "La date de sa venue la plus récente, c'est quoi ?", { k: "lastdate", r: "R7" }),
  v("W198", [F, "direct"], onPatient("R8"), "Que contient ma dernière note ?", { k: "lastnote", r: "R8" }),
  v("W199", [F, "formal"], G, "Quel jour a-t-on revu {R9} pour la dernière fois ?", { k: "lastdate", r: "R9" }),
  v("W200", [F, "synonym"], onConsult("T4"), "Quelle médication reçoit ce patient aujourd'hui ?", { k: "treat", r: "T4" }),
];
