/**
 * C201 · domain "agenda": 30 new agenda questions, anchored on Monday 2026-10-26 09:30 (Africa/Algiers) like C200 so the clock is controlled.
 * New wording, Darija included, and follow-ups that only change the period ("et demain ?").
 */
import { c, t } from "./helpers.mjs";

const D = "agenda";
const G = { type: "global" };
const AT = { asOf: "2026-10-26T09:30:00+01:00" };
const a = (id, tag, say, expect) => c(id, D, "main", G, [t(say, expect, tag)], AT);
const seq = (id, ...turns) => c(id, D, "main", G, turns, AT);

export const cases = [
  a("V101", ["fr", "direct"], "Quels patients sont prévus aujourd'hui ?", { k: "a_list", day: "today" }),
  a("V102", ["fr", "informal"], "J'ai combien de monde demain ?", { k: "a_count", day: "tomorrow" }),
  a("V103", ["la", "direct"], "Chhal men patient 3andi lyoum ?", { k: "a_count", day: "today" }),
  a("V104", ["ar", "direct"], "شحال من مريض عندي غدا", { k: "a_count", day: "tomorrow" }),
  a("V105", ["mx", "conversational"], "Demain 3andi chkoun ?", { k: "a_list", day: "tomorrow" }),
  a("V106", ["fr", "short"], "Agenda de demain", { k: "a_list", day: "tomorrow" }),
  a("V107", ["fr", "typo"], "qui je vois aujourdhui", { k: "a_list", day: "today" }),
  a("V108", ["fr", "formal"], "Pourriez-vous me donner le nombre de consultations prévues cette semaine ?", { k: "a_count", range: "week" }),
  a("V109", ["fr", "wordorder"], "Cette semaine, combien de rendez-vous au programme ?", { k: "a_count", range: "week" }),
  a("V110", ["la", "informal"], "Had simana chhal men rendez-vous 3andi ?", { k: "a_count", range: "week" }),
  a("V111", ["ar", "direct"], "شكون عندي اليوم", { k: "a_list", day: "today" }),
  a("V112", ["fr", "synonym"], "Quel est mon planning de demain ?", { k: "a_list", day: "tomorrow" }),
  a("V113", ["fr", "conversational"], "Hier j'ai vu combien de personnes ?", { k: "a_count", day: "yesterday" }),
  a("V114", ["fr", "informal"], "Qui est passé hier ?", { k: "a_list", day: "yesterday" }),
  a("V115", ["mx", "short"], "Rendez-vous dyal lyoum", { k: "a_list", day: "today" }),
  a("V116", ["fr", "conversational"], "C'est qui mon prochain, et à quelle heure ?", { k: "a_next" }),
  a("V117", ["la", "direct"], "Chkoun l patient jay w fwa9tach ?", { k: "a_next" }),
  a("V118", ["fr", "short"], "Premier rendez-vous demain ?", { k: "a_first", day: "tomorrow" }),
  a("V119", ["fr", "formal"], "Qui est le dernier patient de la journée aujourd'hui ?", { k: "a_last", day: "today" }),
  a("V120", ["fr", "informal"], "Ce matin j'ai du monde ?", { k: "a_daypart", day: "today", part: "am" }),
  a("V121", ["ar", "direct"], "عندي مواعيد هاد العشية؟", { k: "a_daypart", day: "today", part: "pm" }),
  a("V122", ["fr", "wordorder"], "Demain après-midi, des rendez-vous ?", { k: "a_daypart", day: "tomorrow", part: "pm" }),
  a("V123", ["fr", "synonym"], "Quelles personnes ont décommandé cette semaine ?", { k: "a_cancelled", range: "week" }),
  a("V124", ["la", "direct"], "Chkoun lgha rendez-vous dyalou had chhar ?", { k: "a_cancelled", range: "month" }),
  a("V125", ["fr", "conversational"], "Je suis disponible demain matin ?", { k: "a_free", day: "tomorrow", part: "am" }),
  seq("V126",
    t("Aujourd'hui, ça fait combien de patients ?", { k: "a_count", day: "today" }, ["fr", "direct"]),
    t("Pareil pour demain.", { k: "a_count", day: "tomorrow" }, ["fr", "period"])),
  seq("V127",
    t("Quels rendez-vous demain ?", { k: "a_list", day: "tomorrow" }, ["fr", "direct"]),
    t("Même question pour hier", { k: "a_list", day: "yesterday" }, ["fr", "period"])),
  seq("V128",
    t("Chhal men rendez-vous lyoum ?", { k: "a_count", day: "today" }, ["mx", "direct"]),
    t("W ghedda ?", { k: "a_count", day: "tomorrow" }, ["la", "period"])),
  seq("V129",
    t("J'ai combien de consultations cette semaine ?", { k: "a_count", range: "week" }, ["fr", "direct"]),
    t("Et pour la semaine précédente ?", { k: "a_count", range: "lastweek" }, ["fr", "period"])),
  seq("V130",
    t("Qui ai-je vu hier ?", { k: "a_list", day: "yesterday" }, ["fr", "direct"]),
    t("Et avant-hier ?", { k: "a_list", day: "2026-10-24" }, ["fr", "period"])),
];
