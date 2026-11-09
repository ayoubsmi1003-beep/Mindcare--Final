/**
 * C200 · domain "agenda": 30 everyday scheduling questions. French only.
 * Anchored on Monday 2026-10-26 09:30 (Africa/Algiers), a day with appointments in the synthetic database.
 * Weeks run Monday to Sunday, as in the application.
 */
import { c, t } from "./helpers.mjs";

const D = "agenda";
const G = { type: "global" };
const AT = { asOf: "2026-10-26T09:30:00+01:00" };
const a = (id, say, expect) => c(id, D, "main", G, [t(say, expect)], AT);
const seq = (id, ...turns) => c(id, D, "main", G, turns, AT);

export const cases = [
  a("C101", "Qui ai-je aujourd'hui ?", { k: "a_list", day: "today" }),
  a("C102", "Combien de patients aujourd'hui ?", { k: "a_count", day: "today" }),
  a("C103", "Combien de rendez-vous demain ?", { k: "a_count", day: "tomorrow" }),
  a("C104", "Quel est mon prochain rendez-vous ?", { k: "a_next" }),
  a("C105", "À quelle heure est mon prochain patient ?", { k: "a_next" }),
  a("C106", "Ai-je des rendez-vous cet après-midi ?", { k: "a_daypart", day: "today", part: "pm" }),
  a("C107", "Qui a annulé son rendez-vous cette semaine ?", { k: "a_cancelled", range: "week" }),
  a("C108", "Qui a annulé ses rendez-vous ce mois-ci ?", { k: "a_cancelled", range: "month" }),
  a("C109", "À quoi ressemble ma semaine ?", { k: "a_count", range: "week" }),
  a("C110", "Suis-je libre demain matin ?", { k: "a_free", day: "tomorrow", part: "am" }),
  a("C111", "Qui est le premier patient aujourd'hui ?", { k: "a_first", day: "today" }),
  a("C112", "Combien de consultations ai-je cette semaine ?", { k: "a_count", range: "week" }),
  a("C113", "Donne-moi un aperçu de l'agenda d'aujourd'hui.", { k: "a_list", day: "today" }),
  a("C114", "Quels sont mes rendez-vous de demain ?", { k: "a_list", day: "tomorrow" }),
  a("C115", "Combien de patients hier ?", { k: "a_count", day: "yesterday" }),
  a("C116", "Qui avais-je hier ?", { k: "a_list", day: "yesterday" }),
  a("C117", "Combien de rendez-vous la semaine dernière ?", { k: "a_count", range: "lastweek" }),
  a("C118", "Qui est mon dernier patient aujourd'hui ?", { k: "a_last", day: "today" }),
  a("C119", "Est-ce que j'ai du monde ce matin ?", { k: "a_daypart", day: "today", part: "am" }),
  a("C120", "Combien de rendez-vous le 28 octobre ?", { k: "a_count", day: "2026-10-28" }),
  a("C121", "Mon planning du 29 octobre ?", { k: "a_list", day: "2026-10-29" }),
  a("C122", "À quelle heure commence ma journée demain ?", { k: "a_first", day: "tomorrow" }),

  // ── Conversational refinements: the intent stays, the range changes ────────
  seq("C123",
    t("Combien de patients aujourd'hui ?", { k: "a_count", day: "today" }),
    t("Et demain ?", { k: "a_count", day: "tomorrow" }),
    t("Et cette semaine ?", { k: "a_count", range: "week" })),
  seq("C124",
    t("Combien de patients ai-je demain ?", { k: "a_count", day: "tomorrow" }),
    t("Et après-demain ?", { k: "a_count", day: "2026-10-28" }),
    t("Et hier ?", { k: "a_count", day: "yesterday" })),
  seq("C125",
    t("Qui ai-je aujourd'hui ?", { k: "a_list", day: "today" }),
    t("Et demain ?", { k: "a_list", day: "tomorrow" })),
  seq("C126",
    t("Combien de rendez-vous confirmés aujourd'hui ?", { k: "a_count", day: "today", status: "confirmed" }),
    t("Et demain ?", { k: "a_count", day: "tomorrow", status: "confirmed" })),
  seq("C127",
    t("Combien de patients cette semaine ?", { k: "a_count", range: "week" }),
    t("Et la semaine dernière ?", { k: "a_count", range: "lastweek" })),
  seq("C128",
    t("Combien de rendez-vous cet après-midi ?", { k: "a_daypart", day: "today", part: "pm" }),
    t("Et demain après-midi ?", { k: "a_daypart", day: "tomorrow", part: "pm" })),
  seq("C129",
    t("Qui est attendu demain ?", { k: "a_list", day: "tomorrow" }),
    t("Et le lendemain ?", { k: "a_list", day: "2026-10-28" })),
  seq("C130",
    t("Ai-je des rendez-vous aujourd'hui ?", { k: "a_count", day: "today" }),
    t("Combien ?", { k: "a_count", day: "today" })),
];
