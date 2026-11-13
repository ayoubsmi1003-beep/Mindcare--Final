import { describe, expect, it } from "vitest";
import { agendaQuestionFrame, periodFollowup, previousAgendaPeriod } from "@/shared/alexa/agenda-frame";
import { renderIntent } from "@/shared/alexa/intent-render";
import { INTENT_CATALOGUE } from "@/shared/alexa/intent-catalogue";
import { financePeriodFollowup } from "@/shared/alexa/practice-frame";
import { presentAgentResults } from "@/server/alexa/answer-presentation";
import { nativeAgendaStatusContract } from "@/shared/alexa/agenda-plan";
import type { AgentResult } from "@/shared/alexa/agent";

// Development wordings, never C270/H270. 2026-10-26 is a Monday.
const ASOF = "2026-10-26T09:30:00+01:00";

describe("a confirmation state is never dropped from an agenda count or list", () => {
  it("writes it in the closed question, in the status reader's own words", () => {
    const confirmed = agendaQuestionFrame("Combien de rendez-vous confirmés jeudi ?", ASOF)!;
    expect(confirmed).toBe("Combien de rendez-vous confirmés le 29 octobre 2026 ?");
    expect(nativeAgendaStatusContract(confirmed).statuses).toEqual(["confirmed"]);
    const waiting = agendaQuestionFrame("Quels rendez-vous ne sont pas encore confirmés demain ?", ASOF)!;
    expect(waiting).toBe("Quels sont les rendez-vous à confirmer demain ?");
    expect(nativeAgendaStatusContract(waiting).statuses).toEqual(["requested"]);
  });
  it("is carried by the meaning layer's agenda count as well", () => {
    const count = INTENT_CATALOGUE.find((intent) => intent.target.family === "agenda" && intent.target.intent === "count")!;
    expect(renderIntent(count, "Pour mercredi, il y a combien de rdv que les gens ont confirmés ?", { contextPatient: false, followup: false }, ASOF)?.text).toBe("Combien de rendez-vous confirmés le 28 octobre 2026 ?");
  });
});

describe("follow-ups that move or name again the previous period", () => {
  it("moves the previous week or day by seven days", () => {
    expect(periodFollowup("Recule d'une semaine.", "Quels sont les rendez-vous annulés du 19 octobre 2026 au 25 octobre 2026 ?", undefined, ASOF)).toBe("Quels sont les rendez-vous annulés du 12 octobre 2026 au 18 octobre 2026 ?");
    expect(periodFollowup("Et la semaine d'après ?", "Combien de rendez-vous le 27 octobre 2026 ?", undefined, ASOF)).toBe("Combien de rendez-vous le 3 novembre 2026 ?");
  });
  it("reads « ce jour-là » and a bare ordinal on the previous day", () => {
    expect(periodFollowup("Et le dernier de ce jour-là ?", "Quels sont les rendez-vous le 30 octobre 2026 ?", undefined, ASOF)).toBe("Quels sont les rendez-vous le 30 octobre 2026 ?");
    expect(periodFollowup("Combien de rendez-vous ce jour-là ?", "Quels sont les rendez-vous annulés le 30 octobre 2026 ?", undefined, ASOF)).toBe("Combien de rendez-vous le 30 octobre 2026 ?");
  });
  it("replaces a month range by another month", () => {
    expect(periodFollowup("Et en juillet ?", "Combien de rendez-vous du 1 septembre 2026 au 30 septembre 2026 ?", undefined, ASOF)).toBe("Combien de rendez-vous du 1 juillet 2026 au 31 juillet 2026 ?");
  });
  it("names the previous period for the status follow-up", () => {
    expect(previousAgendaPeriod("Quels sont les rendez-vous le 30 octobre 2026 ?", ASOF)).toBe("le 30 octobre 2026");
    expect(previousAgendaPeriod("Combien de rendez-vous demain ?", ASOF)).toBe("le 27 octobre 2026");
    expect(previousAgendaPeriod(undefined, ASOF)).toBeNull();
  });
});

describe("money follow-up after a question kept in its own words", () => {
  it("follows « Recettes de la veille ? »-like wordings", () => {
    expect(financePeriodFollowup("Et sur la semaine ?", "Combien a-t-on encaissé hier ?", ASOF)).toBe("Quel montant représentent les paiements encaissés du 26 octobre 2026 au 1 novembre 2026 ?");
  });
});

describe("a finance answer names a partial month by its dates", () => {
  const result = (data: unknown): AgentResult => ({ callId: "finance", status: "ok", complete: true, text: "raw", conditionKeys: [], evidence: [], data });
  it("never calls a week « En septembre »", () => {
    const [answer] = presentAgentResults([result({ du: "2026-09-21", au: "2026-09-27", composition: { charges_par_categorie: [{ cle: "loyer", libelle: "loyer", montant: 11667, part_pct: 100 }] } })], "Quelle est la répartition des charges du 21 septembre 2026 au 27 septembre 2026 ?");
    expect(answer).toMatch(/^Du 21 septembre 2026 au 27 septembre 2026, /u);
    const [month] = presentAgentResults([result({ du: "2026-09-01", au: "2026-09-30", pulse: { resultat_net_periode: 100 } })], "Quel est le résultat net de septembre 2026 ?");
    expect(month).toMatch(/^En septembre 2026, /u);
  });
});
