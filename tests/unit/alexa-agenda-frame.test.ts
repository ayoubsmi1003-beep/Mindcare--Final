import { describe, expect, it } from "vitest";
import { agendaQuestionFrame, canonicalPeriod, classifyAgendaQuestion, periodFollowup } from "@/shared/alexa/agenda-frame";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

const ASOF = "2026-10-26T09:30:00+01:00"; // a Monday
const frame = (text: string) => agendaQuestionFrame(text, ASOF);
const intent = (text: string) => classifyAgendaQuestion(text)?.intent ?? null;

describe("agenda frame: one intention, many ways to ask it", () => {
  const cases: [string, string][] = [
    ["Combien de patients aujourd'hui ?", "count"],
    ["Combien de patients ai-je demain ?", "count"],
    ["J'ai combien de monde aujourd'hui ?", "count"],
    ["Patients aujourd'hui ?", "list"],
    ["Pourriez-vous m'indiquer le nombre de patients attendus aujourd'hui ?", "count"],
    ["Dis-moi, j'ai beaucoup de patients aujourd'hui ? Combien exactement ?", "count"],
    ["Ai-je des rendez-vous aujourd'hui ?", "count"],
    ["Combien de rendez-vous cet après-midi ?", "count"],
    ["Est-ce que j'ai du monde ce matin ?", "count"],
    ["Combien de consultations ai-je cette semaine ?", "count"],
    ["Qui ai-je aujourd'hui ?", "list"],
    ["Qui est attendu demain ?", "list"],
    ["Qui avais-je hier ?", "list"],
    ["Mon planning du 29 octobre ?", "list"],
    ["Donne-moi un aperçu de l'agenda d'aujourd'hui.", "list"],
    ["Qui a annulé son rendez-vous cette semaine ?", "cancelled"],
    ["Qui a annulé ses rendez-vous ce mois-ci ?", "cancelled"],
    ["Quel est mon prochain rendez-vous ?", "next"],
    ["À quelle heure est mon prochain patient ?", "next"],
    ["Qui est le premier patient aujourd'hui ?", "first"],
    ["À quelle heure commence ma journée demain ?", "first"],
    ["Qui est mon dernier patient aujourd'hui ?", "last"],
    ["Suis-je libre demain matin ?", "free"],
  ];
  for (const [text, expected] of cases) it(`${text} → ${expected}`, () => expect(intent(text)).toBe(expected));
});

describe("agenda frame: it is not an agenda question", () => {
  it("leaves population, one person, money and book questions alone", () => {
    for (const text of ["Combien de patients sont suivis au cabinet ?", "Combien de nouveaux patients ce mois-ci ?", "Il a combien de rendez-vous demain ?",
      "Combien avons-nous encaissé aujourd'hui ?", "Quelles sont les recettes de la semaine ?", "Quels sont les critères de la dépression majeure ?",
      "Combien de patients ont un traitement actuellement ?", "Combien de patients différents avons-nous vus en septembre ?"]) {
      expect(frame(text), text).toBeNull();
    }
  });
  it("refuses when a name or a second topic is in the sentence", () => {
    expect(frame("Combien de rendez-vous Karim Benali a-t-il demain ?")).toBeNull();
    expect(frame("Qui ai-je demain, et quelle est la dose de sertraline ?")).toBeNull();
  });
});

describe("agenda frame: periods are counted from the clock of the turn", () => {
  it("keeps the words the period parser knows and spells out the others", () => {
    expect(canonicalPeriod("aujourd'hui", ASOF)).toBe("aujourd'hui");
    expect(canonicalPeriod("cette semaine", ASOF)).toBe("cette semaine");
    expect(canonicalPeriod("cet apres-midi", ASOF)).toBe("aujourd'hui après-midi");
    expect(canonicalPeriod("apres-demain", ASOF)).toBe("le 28 octobre 2026");
    expect(canonicalPeriod("la semaine derniere", ASOF)).toBe("du 19 octobre 2026 au 25 octobre 2026");
    expect(canonicalPeriod("le mois dernier", ASOF)).toBe("du 1 septembre 2026 au 30 septembre 2026");
    expect(canonicalPeriod("mercredi", ASOF)).toBe("le 28 octobre 2026");
    expect(canonicalPeriod("28 octobre", ASOF)).toBe("le 28 octobre");
  });
  it("restates each question in a closed form the agenda gate admits", () => {
    for (const text of ["Combien de patients aujourd'hui ?", "Qui ai-je demain ?", "Qui a annulé son rendez-vous cette semaine ?", "Combien de rendez-vous la semaine dernière ?", "Qui est le premier patient aujourd'hui ?", "Quel est mon prochain rendez-vous ?", "Combien de patients ai-je demain après-midi ?"]) {
      const closed = frame(text)!;
      expect(closed, text).not.toBeNull();
      expect(frenchRequestAdmission(closed, false, ASOF).tools, closed).toEqual(["query_agenda"]);
    }
  });
});

describe("period follow-up: 'Et demain ?' repeats the last question for another period", () => {
  const day = "2026-10-26";
  it("replaces only the period", () => {
    expect(periodFollowup("Et demain ?", "Combien de rendez-vous aujourd'hui ?", day, ASOF)).toBe("Combien de rendez-vous demain ?");
    expect(periodFollowup("Et cette semaine ?", "Combien de rendez-vous demain ?", day, ASOF)).toBe("Combien de rendez-vous cette semaine ?");
    expect(periodFollowup("Et la semaine dernière ?", "Combien de patients cette semaine ?", day, ASOF)).toBe("Combien de patients du 19 octobre 2026 au 25 octobre 2026 ?");
    expect(periodFollowup("Et après-demain ?", "Combien de rendez-vous demain ?", day, ASOF)).toBe("Combien de rendez-vous le 28 octobre 2026 ?");
    expect(periodFollowup("Et hier ?", "Combien avons-nous encaissé aujourd'hui ?", day, ASOF)).toBe("Combien avons-nous encaissé hier ?");
    expect(periodFollowup("Pour demain ?", "Qui ai-je aujourd'hui ?", day, ASOF)).toBe("Qui ai-je demain ?");
  });
  it("counts 'le lendemain' from the previous day, not from today", () => {
    expect(periodFollowup("Et le lendemain ?", "Quels sont les rendez-vous le 27 octobre 2026 ?", "2026-10-27", ASOF)).toBe("Quels sont les rendez-vous le 28 octobre 2026 ?");
    expect(periodFollowup("Et le lendemain ?", "Qui ai-je demain ?", undefined, ASOF)).toBeNull();
  });
  it("does not guess: no period in the last question, two periods, or a text that is not only a period", () => {
    expect(periodFollowup("Et demain ?", "Quel est le prochain rendez-vous du cabinet ?", day, ASOF)).toBeNull();
    expect(periodFollowup("Et demain ?", "Combien de rendez-vous aujourd'hui et demain ?", day, ASOF)).toBeNull();
    expect(periodFollowup("Et demain, qui vient ?", "Combien de rendez-vous aujourd'hui ?", day, ASOF)).toBeNull();
    expect(periodFollowup("Et demain ?", undefined, day, ASOF)).toBeNull();
  });
  it("keeps accents of the rest of the question", () => {
    expect(periodFollowup("Et demain ?", "Quels sont les rendez-vous annulés aujourd'hui ?", day, ASOF)).toBe("Quels sont les rendez-vous annulés demain ?");
  });
});

describe("agenda frame: this morning and this afternoon mean today", () => {
  it("spells the day part with today so the clock window can be read", () => {
    expect(canonicalPeriod("cet apres-midi", ASOF)).toBe("aujourd'hui après-midi");
    expect(canonicalPeriod("ce matin", ASOF)).toBe("aujourd'hui matin");
    expect(frame("Ai-je des rendez-vous cet après-midi ?")).toBe("Combien de rendez-vous aujourd'hui après-midi ?");
    expect(frenchRequestAdmission(frame("Est-ce que j'ai du monde ce matin ?")!, false, ASOF).tools).toEqual(["query_agenda"]);
  });
});

describe("agenda frame: a named day beats 'ma journée', past consultations are not the agenda, 'Combien ?' counts the same period", () => {
  it("reads the day that is named", () => {
    expect(frame("À quelle heure commence ma journée demain ?")).toBe("Quels sont les rendez-vous demain ?");
  });
  it("leaves consultations that already took place to the consultation count", () => {
    expect(frame("Combien de consultations la semaine dernière ?")).toBe("Combien de consultations terminées du 19 octobre 2026 au 25 octobre 2026 ?");
    expect(frame("Combien de consultations ont eu lieu hier ?")).toBe("Combien de consultations terminées hier ?");
    expect(frame("Combien de consultations ai-je cette semaine ?")).toBe("Combien de rendez-vous cette semaine ?");
  });
  it("counts the period of the previous agenda question", () => {
    expect(periodFollowup("Combien ?", "Combien de rendez-vous aujourd'hui ?", "2026-10-26", ASOF)).toBe("Combien de rendez-vous aujourd'hui ?");
    expect(periodFollowup("Combien ?", "Quels sont les rendez-vous demain ?", "2026-10-26", ASOF)).toBe("Combien de rendez-vous demain ?");
    expect(periodFollowup("Combien ?", "Quel est le traitement de Karim Benali ?", "2026-10-26", ASOF)).toBeNull();
  });
});

describe("agenda frame: the first appointment of another day is read from that day's list", () => {
  it("keeps 'premier' only beside today, where the period reader accepts it", () => {
    expect(frame("Qui est le premier patient aujourd'hui ?")).toBe("Quel est le premier rendez-vous aujourd'hui ?");
    expect(frame("À quelle heure commence ma journée demain ?")).toBe("Quels sont les rendez-vous demain ?");
  });
  it("restates past consultations as an explicit consultation count the consultation read admits", () => {
    expect(frenchRequestAdmission(frame("Combien de consultations la semaine dernière ?")!, false, ASOF).tools).toEqual(["query_consultations"]);
  });
});

describe("the clinic's own calendar", () => {
  it("writes an instant as the Africa/Algiers day, not the UTC one", async () => {
    const { algiersTimestamp } = await import("@/shared/alexa/agenda-frame");
    expect(algiersTimestamp(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01T00:30:00+01:00");
    expect(algiersTimestamp(new Date("2026-10-26T08:30:00Z"))).toBe("2026-10-26T09:30:00+01:00");
  });
});

describe("agenda frame: absences, cancellations, and periods the frame's own list does not know", () => {
  // Development wordings, never C270/H270. Each closed form must be one the agenda gate admits.
  const admitted = (text: string) => { const closed = frame(text); expect(closed, text).not.toBeNull(); expect(frenchRequestAdmission(closed!, false, ASOF)?.tools).toEqual(["query_agenda"]); return closed!; };
  it("reads a no-show however it is said, as the gate's « non honoré » status", () => {
    expect(admitted("Qui ne s'est pas présenté hier ?")).toBe("Quels sont les rendez-vous non honorés hier ?");
    expect(admitted("Les patients absents hier ?")).toBe("Quels sont les rendez-vous non honorés hier ?");
    expect(admitted("Qui m'a posé un lapin la semaine dernière ?")).toBe("Quels sont les rendez-vous non honorés du 19 octobre 2026 au 25 octobre 2026 ?");
    expect(admitted("Combien de lapins cette semaine ?")).toBe("Combien de rendez-vous non honorés cette semaine ?");
    expect(admitted("Combien de rendez-vous non excusés ce mois-ci ?")).toBe("Combien de rendez-vous non honorés ce mois-ci ?");
  });
  it("counts cancellations when the question counts", () => {
    expect(admitted("Depuis lundi, il y a eu combien d'annulations ?")).toBe("Combien de rendez-vous annulés le 26 octobre 2026 ?");
    expect(admitted("Qui a annulé hier ?")).toBe("Quels sont les rendez-vous annulés hier ?");
  });
  it("reads a month or an explicit day through the shared civil reader", () => {
    expect(admitted("Sur tout le mois de septembre, combien de rendez-vous ?")).toBe("Combien de rendez-vous du 1 septembre 2026 au 30 septembre 2026 ?");
    expect(admitted("Combien de patients absents en septembre ?")).toBe("Combien de rendez-vous non honorés du 1 septembre 2026 au 30 septembre 2026 ?");
    expect(admitted("Qui était prévu le 5 novembre ?")).toBe("Quels sont les rendez-vous le 5 novembre ?");
    expect(admitted("J'ai quelque chose de prévu le 3 novembre ?")).toBe("Quels sont les rendez-vous le 3 novembre ?");
    expect(admitted("Qui était au programme mardi dernier ?")).toBe("Quels sont les rendez-vous le 20 octobre 2026 ?");
  });
  it("leaves consultations, sessions paid and patients seen over a month to the activity and money frames", () => {
    for (const text of ["Combien de consultations en juillet ?", "Combien de patients vus en septembre ?", "Combien de séances payées en août ?"]) expect(frame(text), text).toBeNull();
    expect(admitted("Combien de rendez-vous en juillet ?")).toBe("Combien de rendez-vous du 1 juillet 2026 au 31 juillet 2026 ?");
  });
  it("never guesses: a month without its year far in the past, one person, or a name stay with the other routes", () => {
    for (const text of ["Combien de rendez-vous en novembre ?", "Est-ce qu'il n'est pas venu hier ?", "Elle était absente à son rendez-vous de lundi ?", "Les absences de Karim Test en septembre ?", "Des rendez-vous ce week-end ?"]) expect(frame(text), text).toBeNull();
  });
});
