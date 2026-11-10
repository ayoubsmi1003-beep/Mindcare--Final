/**
 * C200 · domain "finance": 25 straightforward finance and activity questions. French only.
 * Finance runs on the disposable fixture database (the main synthetic database has no payments),
 * anchored on Sunday 2026-09-27 18:00. Truth comes from the application's own finance gate
 * (cash basis: revenue = collected payments), called directly by generate-oracles.mjs.
 * Activity questions run on the main synthetic database, anchored on Monday 2026-10-26 09:30.
 */
import { c, t } from "./helpers.mjs";

const D = "finance";
const G = { type: "global" };
const FIN = { asOf: "2026-09-27T18:00:00+01:00" };
const ACT = { asOf: "2026-10-26T09:30:00+01:00" };
const f = (id, say, expect) => c(id, D, "fixture", G, [t(say, expect)], FIN);
const n = (id, say, expect) => c(id, D, "main", G, [t(say, expect)], ACT);

export const cases = [
  // ── Finance (15) ───────────────────────────────────────────────────────────
  f("C131", "Combien le cabinet a-t-il encaissé aujourd'hui ?", { k: "f_revenue", range: "today" }),
  f("C132", "Quelles sont les recettes de ce mois ?", { k: "f_revenue", range: "month" }),
  f("C133", "Combien d'argent avons-nous encaissé cette semaine ?", { k: "f_revenue", range: "week" }),
  f("C134", "Quels sont les impayés ?", { k: "f_outstanding", range: "month" }),
  f("C135", "Combien avons-nous reçu en espèces ce mois-ci ?", { k: "f_cash", range: "month" }),
  f("C136", "Combien a été payé par un autre moyen que les espèces ?", { k: "f_other_methods", range: "month" }),
  f("C137", "Quelles sont les dépenses du cabinet ce mois-ci ?", { k: "f_expenses", range: "month" }),
  f("C138", "Compare ce mois avec le mois dernier.", { k: "f_compare", a: "month", b: "lastmonth" }),
  f("C139", "Quel est le chiffre d'affaires de cette année ?", { k: "f_revenue", range: "year" }),
  f("C140", "Donne-moi un aperçu de la situation financière du cabinet.", { k: "f_overview", range: "month" }),
  f("C141", "Combien avons-nous gagné hier ?", { k: "f_revenue", range: "yesterday" }),
  f("C142", "Quel est le résultat net de ce mois ?", { k: "f_net", range: "month" }),
  f("C143", "Quel est le montant total des charges de septembre ?", { k: "f_expenses", range: "month" }),
  f("C144", "Combien de séances ont été payées ce mois-ci ?", { k: "f_sessions", range: "month" }),
  c("C145", D, "fixture", G, [
    t("Combien avons-nous encaissé aujourd'hui ?", { k: "f_revenue", range: "today" }),
    t("Et hier ?", { k: "f_revenue", range: "yesterday" }),
    t("Et cette semaine ?", { k: "f_revenue", range: "week" })], FIN),

  // ── Activity and counts (10) ───────────────────────────────────────────────
  n("C146", "Combien de patients avons-nous reçus ce mois-ci ?", { k: "n_patients_seen", range: "month" }),
  n("C147", "Combien de consultations ont eu lieu ce mois-ci ?", { k: "n_consults", range: "month" }),
  n("C148", "Combien de consultations la semaine dernière ?", { k: "n_consults", range: "lastweek" }),
  n("C149", "Combien de nouveaux patients se sont inscrits ce mois-ci ?", { k: "n_new", range: "month" }),
  n("C150", "Quels sont les jours les plus chargés ?", { k: "n_busiest", range: "month" }),
  n("C151", "Compare le nombre de consultations de ce mois avec le mois dernier.", { k: "n_compare", a: "month", b: "lastmonth" }),
  n("C152", "Combien de patients différents avons-nous vus en septembre ?", { k: "n_patients_seen", range: "lastmonth" }),
  n("C153", "Combien de consultations y a-t-il eu en août ?", { k: "n_consults", range: "2026-08" }),
  n("C154", "Combien de patients sont suivis au cabinet ?", { k: "n_active_patients" }),
  n("C155", "Donne-moi un aperçu de l'activité du cabinet ce mois-ci.", { k: "n_overview", range: "month" }),
];
