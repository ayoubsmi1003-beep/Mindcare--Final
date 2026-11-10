/**
 * C202 · domain "finance": 25 French questions on money (15, finance fixture, anchored 2026-09-27) and practice activity
 * (10, main synthetic database, anchored Monday 2026-10-26). Cash basis, Africa/Algiers. Worded differently from C200 and C201.
 */
import { c, t } from "./helpers.mjs";

const D = "finance";
const G = { type: "global" };
const FIN = { asOf: "2026-09-27T18:00:00+01:00" };
const ACT = { asOf: "2026-10-26T09:30:00+01:00" };
const f = (id, tag, say, expect) => c(id, D, "fixture", G, [t(say, expect, tag)], FIN);
const fseq = (id, ...turns) => c(id, D, "fixture", G, turns, FIN);
const n = (id, tag, say, expect) => c(id, D, "main", G, [t(say, expect, tag)], ACT);
const nseq = (id, ...turns) => c(id, D, "main", G, turns, ACT);
const F = "fr";

export const cases = [
  f("W131", [F, "direct"], "Quel est le montant encaissé aujourd'hui ?", { k: "f_revenue", range: "today" }),
  f("W132", [F, "direct"], "Quelles ont été nos recettes cette semaine ?", { k: "f_revenue", range: "week" }),
  f("W133", [F, "conversational"], "Combien est rentré dans la caisse ce mois-ci ?", { k: "f_revenue", range: "month" }),
  f("W134", [F, "short"], "Chiffre d'affaires du mois ?", { k: "f_revenue", range: "month" }),
  f("W135", [F, "synonym"], "Où en sont les paiements en attente ?", { k: "f_outstanding", range: "month" }),
  f("W136", [F, "formal"], "Quel est le total de nos charges ce mois-ci ?", { k: "f_expenses", range: "month" }),
  f("W137", [F, "informal"], "Qu'est-ce qu'on a dépensé ce mois ?", { k: "f_expenses", range: "month" }),
  f("W138", [F, "synonym"], "Quel est le solde net du mois ?", { k: "f_net", range: "month" }),
  f("W139", [F, "conversational"], "Quels modes de paiement les patients utilisent-ils ?", { k: "f_other_methods", range: "month" }),
  f("W140", [F, "formal"], "Combien le cabinet a-t-il généré depuis le début de l'année ?", { k: "f_revenue", range: "year" }),
  fseq("W141",
    t("Recettes de la semaine ?", { k: "f_revenue", range: "week" }, [F, "short"]),
    t("Et celles de la semaine précédente ?", { k: "f_revenue", range: "lastweek" }, [F, "period"])),
  fseq("W142",
    t("Combien d'argent est entré aujourd'hui ?", { k: "f_revenue", range: "today" }, [F, "conversational"]),
    t("Et la veille ?", { k: "f_revenue", range: "yesterday" }, [F, "period"])),
  fseq("W143",
    t("Nos dépenses de ce mois ?", { k: "f_expenses", range: "month" }, [F, "short"]),
    t("Et le mois précédent ?", { k: "f_expenses", range: "lastmonth" }, [F, "period"])),
  f("W144", [F, "direct"], "Compare les recettes d'août et de septembre.", { k: "f_compare", a: "2026-08", b: "2026-09" }),
  f("W145", [F, "conversational"], "Combien de consultations ont été payées cette semaine ?", { k: "f_sessions", range: "week" }),

  n("W146", [F, "direct"], "Combien de patients différents sont venus ce mois-ci ?", { k: "n_patients_seen", range: "month" }),
  n("W147", [F, "short"], "Combien de nouveaux dossiers ce mois-ci ?", { k: "n_new", range: "month" }),
  n("W148", [F, "direct"], "Combien de consultations ont été réalisées cette semaine ?", { k: "n_consults", range: "week" }),
  n("W149", [F, "short"], "Quelle journée est la plus remplie chez nous ?", { k: "n_busiest", range: "month" }),
  n("W150", [F, "short"], "Nombre de séances réalisées en octobre ?", { k: "n_consults", range: "2026-10" }),
  n("W151", [F, "formal"], "Où en est l'activité du cabinet ce mois-ci ?", { k: "n_overview", range: "month" }),
  n("W152", [F, "direct"], "Combien de dossiers actifs au cabinet ?", { k: "n_active_patients" }),
  nseq("W153",
    t("La semaine passée, on a réalisé combien de séances ?", { k: "n_consults", range: "lastweek" }, [F, "direct"]),
    t("Même chose pour la semaine en cours.", { k: "n_consults", range: "week" }, [F, "period"])),
  n("W154", [F, "direct"], "Compare l'activité de la semaine dernière avec celle de cette semaine.", { k: "n_compare", a: "lastweek", b: "week" }),
  n("W155", [F, "direct"], "Combien de patients ont été vus en septembre ?", { k: "n_patients_seen", range: "2026-09" }),
];
