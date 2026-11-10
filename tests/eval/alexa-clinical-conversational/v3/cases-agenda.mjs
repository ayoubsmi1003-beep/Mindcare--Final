/**
 * C202 · domain "agenda": 30 French agenda questions, anchored on Monday 2026-10-26 09:30 (Africa/Algiers), worded differently
 * from C200 and C201, with follow-ups that only change the period.
 */
import { c, t } from "./helpers.mjs";

const D = "agenda";
const G = { type: "global" };
const AT = { asOf: "2026-10-26T09:30:00+01:00" };
const a = (id, tag, say, expect) => c(id, D, "main", G, [t(say, expect, tag)], AT);
const seq = (id, ...turns) => c(id, D, "main", G, turns, AT);
const F = "fr";

export const cases = [
  a("W101", [F, "direct"], "Qui dois-je recevoir aujourd'hui ?", { k: "a_list", day: "today" }),
  a("W102", [F, "short"], "Nombre de patients prévus demain ?", { k: "a_count", day: "tomorrow" }),
  a("W103", [F, "formal"], "Mon planning de la journée, s'il te plaît.", { k: "a_list", day: "today" }),
  a("W104", [F, "informal"], "Il y a du monde cette semaine ?", { k: "a_count", range: "week" }),
  a("W105", [F, "conversational"], "Combien de patients sont inscrits à l'agenda cette semaine ?", { k: "a_count", range: "week" }),
  a("W106", [F, "direct"], "Combien de rendez-vous ce mois-ci ?", { k: "a_count", range: "month" }),
  a("W107", [F, "short"], "Agenda d'hier", { k: "a_list", day: "yesterday" }),
  a("W108", [F, "wordorder"], "Qui avais-je comme patients hier ?", { k: "a_list", day: "yesterday" }),
  a("W109", [F, "direct"], "La semaine passée, mon agenda comptait combien de patients ?", { k: "a_count", range: "lastweek" }),
  a("W110", [F, "synonym"], "Qui sont mes patients de demain ?", { k: "a_list", day: "tomorrow" }),
  a("W111", [F, "wordorder"], "Mon prochain rendez-vous, c'est avec qui ?", { k: "a_next" }),
  a("W112", [F, "short"], "Mon prochain rendez-vous, à quelle heure ?", { k: "a_next" }),
  a("W113", [F, "direct"], "Qui est mon tout premier rendez-vous de demain ?", { k: "a_first", day: "tomorrow" }),
  a("W114", [F, "direct"], "Qui est mon dernier rendez-vous d'aujourd'hui ?", { k: "a_last", day: "today" }),
  a("W115", [F, "direct"], "Ai-je des rendez-vous demain matin ?", { k: "a_daypart", day: "tomorrow", part: "am" }),
  a("W116", [F, "formal"], "Y a-t-il des consultations cet après-midi ?", { k: "a_daypart", day: "today", part: "pm" }),
  a("W117", [F, "direct"], "Combien de rendez-vous ce matin ?", { k: "a_daypart", day: "today", part: "am" }),
  a("W118", [F, "direct"], "Quels rendez-vous ont été annulés ce mois-ci ?", { k: "a_cancelled", range: "month" }),
  a("W119", [F, "synonym"], "Qui s'est désisté cette semaine ?", { k: "a_cancelled", range: "week" }),
  a("W120", [F, "direct"], "Suis-je libre demain après-midi ?", { k: "a_free", day: "tomorrow", part: "pm" }),
  a("W121", [F, "wordorder"], "Combien de rendez-vous ai-je jeudi ?", { k: "a_count", day: "2026-10-29" }),
  a("W122", [F, "direct"], "Qui vais-je recevoir mercredi ?", { k: "a_list", day: "2026-10-28" }),
  a("W123", [F, "direct"], "Combien de patients le 29 octobre ?", { k: "a_count", day: "2026-10-29" }),
  seq("W124",
    t("Qui est prévu demain ?", { k: "a_list", day: "tomorrow" }, [F, "direct"]),
    t("Et aujourd'hui ?", { k: "a_list", day: "today" }, [F, "period"])),
  seq("W125",
    t("Aujourd'hui, j'ai combien de personnes à voir ?", { k: "a_count", day: "today" }, [F, "direct"]),
    t("Et pour mercredi ?", { k: "a_count", day: "2026-10-28" }, [F, "period"])),
  seq("W126",
    t("Combien de rendez-vous sont prévus cette semaine ?", { k: "a_count", range: "week" }, [F, "direct"]),
    t("Et celle qui précède ?", { k: "a_count", range: "lastweek" }, [F, "period"])),
  seq("W127",
    t("Qui ai-je reçu hier ?", { k: "a_list", day: "yesterday" }, [F, "direct"]),
    t("Et aujourd'hui ?", { k: "a_list", day: "today" }, [F, "period"])),
  seq("W128",
    t("Pour demain, quel est le nombre de patients au programme ?", { k: "a_count", day: "tomorrow" }, [F, "wordorder"]),
    t("Et le jour d'après ?", { k: "a_count", day: "2026-10-28" }, [F, "period"])),
  seq("W129",
    t("Quels rendez-vous aujourd'hui ?", { k: "a_list", day: "today" }, [F, "direct"]),
    t("Et hier, c'était qui ?", { k: "a_list", day: "yesterday" }, [F, "period"])),
  seq("W130",
    t("Combien de patients prévus ce mois-ci ?", { k: "a_count", range: "month" }, [F, "direct"]),
    t("Et le mois précédent ?", { k: "a_count", range: "lastmonth" }, [F, "period"])),
];
