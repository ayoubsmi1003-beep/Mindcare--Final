/**
 * C270 · domain "finance": 35 French turns. Money (19, finance fixture, anchored Sunday 2026-09-27) and practice activity
 * (16, main synthetic database, anchored Monday 2026-10-26). Cash basis, Africa/Algiers. Other periods and other words
 * than C200–C202: named months, the past week, the year so far, net result, unpaid totals, period comparisons, follow-ups.
 */
import { c, t } from "./helpers.mjs";

const D = "finance";
const G = { type: "global" };
const F = "fr";
const FIN = { asOf: "2026-09-27T18:00:00+01:00" };
const ACT = { asOf: "2026-10-26T09:30:00+01:00" };
const f = (id, form, say, expect) => c(id, D, "fixture", G, [t(say, expect, [F, form])], FIN);
const fseq = (id, ...turns) => c(id, D, "fixture", G, turns, FIN);
const n = (id, form, say, expect) => c(id, D, "main", G, [t(say, expect, [F, form])], ACT);
const nseq = (id, ...turns) => c(id, D, "main", G, turns, ACT);

export const cases = [
  // Money (19 turns)
  f("F001", "conversational", "Qu'est-ce que le cabinet a rapporté le mois dernier ?", { k: "f_revenue", range: "lastmonth" }),
  f("F002", "short", "Le bénéfice du mois d'août ?", { k: "f_net", range: "2026-08" }),
  f("F003", "direct", "La caisse d'hier, ça donne quoi ?", { k: "f_revenue", range: "yesterday" }),
  f("F004", "formal", "À combien s'élèvent nos dépenses depuis janvier ?", { k: "f_expenses", range: "year" }),
  f("F005", "informal", "Il reste combien à encaisser ?", { k: "f_outstanding", range: "month" }),
  f("F006", "synonym", "Quel est le montant total des sommes impayées ?", { k: "f_outstanding", range: "month" }),
  f("F007", "short", "Le chiffre d'affaires de juillet ?", { k: "f_revenue", range: "2026-07" }),
  f("F008", "direct", "Fais-moi le bilan financier de septembre.", { k: "f_overview", range: "2026-09" }),
  f("F009", "direct", "Combien de séances ont été réglées en août ?", { k: "f_sessions", range: "2026-08" }),
  f("F010", "wordorder", "Les recettes de juillet, comparées à celles d'août ?", { k: "f_compare", a: "2026-07", b: "2026-08" }),
  f("F011", "formal", "Quel a été notre résultat net la semaine dernière ?", { k: "f_net", range: "lastweek" }),
  f("F012", "short", "Les dépenses de la semaine ?", { k: "f_expenses", range: "week" }),
  fseq("F013",
    t("Combien a-t-on encaissé en août ?", { k: "f_revenue", range: "2026-08" }, [F, "direct"]),
    t("Et en juillet ?", { k: "f_revenue", range: "2026-07" }, [F, "period"])),
  fseq("F014",
    t("Les charges de septembre ?", { k: "f_expenses", range: "2026-09" }, [F, "short"]),
    t("Et le résultat net du même mois ?", { k: "f_net", range: "2026-09" }, [F, "followup"])),
  fseq("F015",
    t("Recettes d'aujourd'hui ?", { k: "f_revenue", range: "today" }, [F, "short"]),
    t("Élargis à toute la semaine.", { k: "f_revenue", range: "week" }, [F, "period"]),
    t("Et sur le mois ?", { k: "f_revenue", range: "month" }, [F, "period"])),

  // Activity (16 turns)
  n("F016", "direct", "Combien de consultations en septembre ?", { k: "n_consults", range: "2026-09" }),
  n("F017", "conversational", "Combien de patients différents on a vus la semaine dernière ?", { k: "n_patients_seen", range: "lastweek" }),
  n("F018", "short", "Nouveaux patients inscrits cette année ?", { k: "n_new", range: "year" }),
  n("F019", "direct", "Combien de nouveaux dossiers ont été ouverts en octobre ?", { k: "n_new", range: "2026-10" }),
  n("F020", "formal", "Quel jour de la semaine concentre le plus de consultations cette année ?", { k: "n_busiest", range: "year" }),
  n("F021", "direct", "Compare le nombre de consultations de septembre et d'octobre.", { k: "n_compare", a: "2026-09", b: "2026-10" }),
  n("F022", "conversational", "Le cabinet suit combien de patients actuellement ?", { k: "n_active_patients" }),
  n("F023", "short", "Bilan d'activité de la semaine dernière.", { k: "n_overview", range: "lastweek" }),
  n("F024", "direct", "Combien de séances ont été faites hier ?", { k: "n_consults", range: "yesterday" }),
  nseq("F025",
    t("Combien de patients vus en août ?", { k: "n_patients_seen", range: "2026-08" }, [F, "direct"]),
    t("Et combien de consultations au total ce mois-là ?", { k: "n_consults", range: "2026-08" }, [F, "followup"])),
  nseq("F026",
    t("L'activité de ce mois-ci ?", { k: "n_overview", range: "month" }, [F, "short"]),
    t("Mets ça en regard de septembre.", { k: "n_compare", a: "lastmonth", b: "month" }, [F, "followup"])),
  n("F027", "direct", "Combien de consultations depuis le début de l'année ?", { k: "n_consults", range: "year" }),
  n("F028", "formal", "Combien de patients ont consulté au moins une fois cette année ?", { k: "n_patients_seen", range: "year" }),
  n("F029", "short", "Nombre de séances le 20 octobre ?", { k: "n_consults", range: "2026-10-20" }),
];
