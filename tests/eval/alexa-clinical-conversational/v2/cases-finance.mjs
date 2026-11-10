/**
 * C201 · domain "finance": 25 new questions on money (15, on the disposable finance fixture, anchored on 2026-09-27) and on the
 * practice's activity (10, on the main synthetic database, anchored on Monday 2026-10-26). Cash basis, Africa/Algiers, as in C200.
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

export const cases = [
  // ── Money (15) ─────────────────────────────────────────────────────────────
  f("V131", ["fr", "informal"], "On a gagné combien aujourd'hui ?", { k: "f_revenue", range: "today" }),
  f("V132", ["fr", "conversational"], "Les rentrées d'argent de septembre, ça fait combien ?", { k: "f_revenue", range: "month" }),
  f("V133", ["la", "direct"], "Chhal dkhel lcabinet had simana ?", { k: "f_revenue", range: "week" }),
  f("V134", ["ar", "direct"], "شحال دخل للعيادة هاد الشهر", { k: "f_revenue", range: "month" }),
  f("V135", ["mx", "conversational"], "Chhal khlasso les patients lyoum ?", { k: "f_revenue", range: "today" }),
  f("V136", ["fr", "short"], "Impayés ?", { k: "f_outstanding", range: "month" }),
  f("V137", ["fr", "wordorder"], "Ce mois-ci, nos dépenses s'élèvent à combien ?", { k: "f_expenses", range: "month" }),
  f("V138", ["fr", "synonym"], "Quel bénéfice net ce mois ?", { k: "f_net", range: "month" }),
  f("V139", ["fr", "informal"], "Et par chèque ou par carte, on a eu quelque chose ?", { k: "f_other_methods", range: "month" }),
  f("V140", ["fr", "formal"], "Pourriez-vous me donner le chiffre d'affaires de l'année en cours ?", { k: "f_revenue", range: "year" }),
  fseq("V141",
    t("Combien a-t-on encaissé ce mois-ci ?", { k: "f_revenue", range: "month" }, ["fr", "direct"]),
    t("Et le mois passé ?", { k: "f_revenue", range: "lastmonth" }, ["fr", "period"])),
  fseq("V142",
    t("Les dépenses de ce mois ?", { k: "f_expenses", range: "month" }, ["fr", "short"]),
    t("Et le mois dernier ?", { k: "f_expenses", range: "lastmonth" }, ["fr", "period"])),
  fseq("V143",
    t("Chhal dkhel had chhar ?", { k: "f_revenue", range: "month" }, ["la", "direct"]),
    t("W chhar li fat ?", { k: "f_revenue", range: "lastmonth" }, ["la", "period"])),
  f("V144", ["fr", "conversational"], "Compare septembre et août pour moi", { k: "f_compare", a: "2026-09", b: "2026-08" }),
  f("V145", ["fr", "informal"], "Combien de séances ont été réglées ce mois ?", { k: "f_sessions", range: "month" }),

  // ── Practice activity (10) ─────────────────────────────────────────────────
  n("V146", ["fr", "conversational"], "Combien de personnes différentes ai-je reçues ce mois-ci ?", { k: "n_patients_seen", range: "month" }),
  n("V147", ["fr", "informal"], "On a pris combien de nouveaux dossiers ce mois ?", { k: "n_new", range: "month" }),
  n("V148", ["la", "direct"], "Chhal men consultation tdarou had chhar ?", { k: "n_consults", range: "month" }),
  n("V149", ["ar", "direct"], "شحال من استشارة دارو هاد الشهر", { k: "n_consults", range: "month" }),
  n("V150", ["fr", "wordorder"], "Quel jour de la semaine est le plus chargé ce mois-ci ?", { k: "n_busiest", range: "month" }),
  n("V151", ["fr", "synonym"], "Combien de séances ont été réalisées en septembre ?", { k: "n_consults", range: "2026-09" }),
  n("V152", ["fr", "short"], "Activité du cabinet cette semaine", { k: "n_overview", range: "week" }),
  n("V153", ["mx", "informal"], "Chhal men patient kaynin f cabinet en tout ?", { k: "n_active_patients" }),
  nseq("V154",
    t("Combien de séances ce mois-ci ?", { k: "n_consults", range: "month" }, ["fr", "short"]),
    t("Et le mois dernier ?", { k: "n_consults", range: "lastmonth" }, ["fr", "period"])),
  n("V155", ["fr", "conversational"], "Compare le nombre de séances de ce mois à celui du mois dernier", { k: "n_compare", a: "month", b: "lastmonth" }),
];
