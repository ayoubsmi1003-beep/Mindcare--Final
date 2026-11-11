/**
 * C270 · domain "agenda": 40 French turns on the main synthetic database, anchored Monday 2026-10-26 09:30 (Africa/Algiers).
 * Aimed at what C200–C202 barely asked: missed appointments, cancellations by period, pending requests, explicit dates and
 * weekdays, a precise time, empty days, first/last of another day, a patient's own appointment, period follow-ups.
 * An agenda "rendez-vous" is any appointment that is not cancelled (the application's definition).
 */
import { c, t } from "./helpers.mjs";

const D = "agenda";
const G = { type: "global" };
const F = "fr";
const DAY = { asOf: "2026-10-26T09:30:00+01:00" };
const a = (id, form, say, expect) => c(id, D, "main", G, [t(say, expect, [F, form])], DAY);
const seq = (id, ...turns) => c(id, D, "main", G, turns, DAY);

export const cases = [
  // Missed appointments (4)
  a("A001", "direct", "Qui n'est pas venu à son rendez-vous ce mois-ci ?", { k: "a_noshow", range: "month" }),
  a("A002", "synonym", "Combien d'absences non excusées la semaine dernière ?", { k: "a_noshow_count", range: "lastweek" }),
  a("A003", "informal", "Il y a eu des lapins ce mois-ci ?", { k: "a_noshow", range: "month" }),
  a("A004", "formal", "Sur l'ensemble du mois d'octobre, combien de patients ne se sont pas présentés ?", { k: "a_noshow_count", range: "2026-10" }),

  // Cancellations (3)
  a("A005", "direct", "Les rendez-vous annulés la semaine dernière ?", { k: "a_cancelled", range: "lastweek" }),
  a("A006", "conversational", "Combien d'annulations depuis le début du mois ?", { k: "a_cancelled_count", range: "month" }),
  a("A007", "direct", "Qui avait annulé le 13 octobre ?", { k: "a_cancelled", range: "2026-10-13" }),

  // Requests still to confirm (3)
  a("A008", "conversational", "Quelles demandes de rendez-vous attendent encore une réponse ?", { k: "a_requested", range: "upcoming" }),
  a("A009", "direct", "Combien de demandes de rendez-vous à confirmer pour demain ?", { k: "a_requested_count", range: "tomorrow" }),
  a("A010", "formal", "Combien de nouvelles demandes de rendez-vous concernent cette semaine ?", { k: "a_requested_count", range: "week" }),

  // Named days and explicit dates (8)
  a("A011", "short", "Le planning de mercredi ?", { k: "a_list", range: "2026-10-28" }),
  a("A012", "direct", "Combien de patients jeudi après-midi ?", { k: "a_daypart", part: "pm", range: "2026-10-29" }),
  a("A013", "conversational", "Le 22 octobre, qui était au programme ?", { k: "a_list", range: "2026-10-22" }),
  a("A014", "direct", "Le 5 octobre, combien de créneaux étaient réservés ?", { k: "a_count", range: "2026-10-05" }),
  a("A015", "informal", "Vendredi dernier, j'ai vu combien de monde ?", { k: "a_count", range: "2026-10-23" }),
  a("A016", "direct", "Combien de rendez-vous entre mardi et jeudi ?", { k: "a_count", range: "2026-10-27..2026-10-29" }),
  a("A017", "formal", "Pourriez-vous m'afficher l'agenda de la semaine prochaine ?", { k: "a_list", range: "nextweek" }),
  a("A018", "conversational", "J'ai quelque chose de prévu le 30 octobre ?", { k: "a_list", range: "2026-10-30" }),

  // First, last, a precise time (6)
  a("A019", "direct", "Demain, mon premier patient arrive à quelle heure ?", { k: "a_first", range: "tomorrow" }),
  a("A020", "informal", "Je termine à quelle heure aujourd'hui ?", { k: "a_last", range: "today" }),
  a("A021", "direct", "Le premier rendez-vous de mercredi est à quelle heure ?", { k: "a_first", range: "2026-10-28" }),
  a("A022", "wordorder", "Jeudi, le dernier patient, c'est qui ?", { k: "a_last", range: "2026-10-29" }),
  a("A023", "direct", "Le dernier patient de vendredi dernier, c'était qui ?", { k: "a_last", range: "2026-10-23" }),
  a("A024", "short", "Mon rendez-vous de 10 h aujourd'hui ?", { k: "a_at", time: "10:00", range: "today" }),

  // Status and parts of the day (4)
  a("A025", "direct", "Demain, combien de rendez-vous ont été confirmés par les patients ?", { k: "a_count", status: "confirmed", range: "tomorrow" }),
  a("A026", "conversational", "Ma matinée de demain est chargée ?", { k: "a_daypart", part: "am", range: "tomorrow" }),
  a("A027", "wordorder", "Cet après-midi, il me reste combien de personnes à voir ?", { k: "a_daypart", part: "pm", range: "today" }),
  a("A028", "conversational", "Ai-je un trou dans mon planning demain matin ?", { k: "a_free", part: "am", range: "tomorrow" }),

  // A patient's own appointment (2)
  a("A029", "direct", "Est-ce que {U1} a bien un rendez-vous cette semaine ?", { k: "nextappt", r: "U1" }),
  a("A030", "short", "{U2} est attendu quand, la prochaine fois ?", { k: "nextappt", r: "U2" }),

  // Empty periods (1)
  a("A031", "direct", "Y a-t-il des rendez-vous le week-end prochain ?", { k: "a_list", range: "2026-10-31..2026-11-01" }),

  // Follow-ups on the period (9 turns)
  seq("A032",
    t("Mon programme d'aujourd'hui ?", { k: "a_list", range: "today" }, [F, "short"]),
    t("Même question pour après-demain.", { k: "a_list", range: "2026-10-28" }, [F, "period"]),
    t("Le premier de ce jour-là ?", { k: "a_first", range: "2026-10-28" }, [F, "followup"])),
  seq("A033",
    t("Les absences de la semaine dernière ?", { k: "a_noshow", range: "lastweek" }, [F, "short"]),
    t("Remonte encore d'une semaine.", { k: "a_noshow", range: "2026-10-12..2026-10-18" }, [F, "period"])),
  seq("A034",
    t("Combien de rendez-vous en septembre ?", { k: "a_count", range: "2026-09" }, [F, "direct"]),
    t("Et en août ?", { k: "a_count", range: "2026-08" }, [F, "period"])),
  seq("A035",
    t("Les rendez-vous de dimanche dernier ?", { k: "a_list", range: "2026-10-25" }, [F, "direct"]),
    t("Parmi eux, combien n'étaient pas encore confirmés ?", { k: "a_count", status: "requested", range: "2026-10-25" }, [F, "followup"])),
];
