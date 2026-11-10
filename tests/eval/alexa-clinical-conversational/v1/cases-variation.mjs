/**
 * C200 · domain "variation": 10 cases that put one intention in several registers
 * (formal, familiar, very short, conversational). French only.
 * The point is meaning, not phrase recognition: each register must give the same correct answer.
 */
import { c, t } from "./helpers.mjs";

const D = "variation";
const G = { type: "global" };
const AT = { asOf: "2026-10-26T09:30:00+01:00" };
const onPatient = (role) => ({ type: "patient", role });

export const cases = [
  // Current treatment
  c("C191", D, "main", onPatient("T1"), [t("Pourriez-vous m'indiquer le traitement médicamenteux actuellement suivi par ce patient ?", { k: "treat", r: "T1" })]),
  c("C192", D, "main", onPatient("T2"), [t("Il prend quoi comme cachets en ce moment ?", { k: "treat", r: "T2" })]),
  c("C193", D, "main", onPatient("T3"), [t("Ses médicaments ?", { k: "treat", r: "T3" })]),
  c("C194", D, "main", onPatient("T4"), [t("Dis, tu peux me rappeler ce qu'il prend comme traitement ces temps-ci ?", { k: "treat", r: "T4" })]),
  // How many patients today
  c("C195", D, "main", G, [t("Pourriez-vous m'indiquer le nombre de patients attendus aujourd'hui ?", { k: "a_count", day: "today" })], AT),
  c("C196", D, "main", G, [t("J'ai combien de monde aujourd'hui ?", { k: "a_count", day: "today" })], AT),
  c("C197", D, "main", G, [t("Patients aujourd'hui ?", { k: "a_count", day: "today" })], AT),
  c("C198", D, "main", G, [t("Dis-moi, j'ai beaucoup de patients aujourd'hui ? Combien exactement ?", { k: "a_count", day: "today" })], AT),
  // Last visit
  c("C199", D, "main", onPatient("R1"), [t("Pourriez-vous me rappeler la date de la dernière visite de ce patient ?", { k: "lastdate", r: "R1" })]),
  c("C200", D, "main", onPatient("R2"), [t("Il est passé quand la dernière fois, lui ?", { k: "lastdate", r: "R2" })]),
];
