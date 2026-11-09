import { describe, expect, it } from "vitest";
import { dateAlternatives, evaluateTurn, extractQuotes, fold, numberAlternatives, rollUp } from "../eval/alexa-clinical-conversational/v1/evaluate.mjs";
import { buildCases } from "../eval/alexa-clinical-conversational/v1/build-cases.mjs";
import { resolveRange } from "../eval/alexa-clinical-conversational/v1/generate-oracles.mjs";

const matches = (patterns: string[], text: string) => patterns.some((pattern) => new RegExp(pattern, "u").test(fold(text)));
const PATIENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const obs = (over: Record<string, unknown> = {}) => ({ answer: "Réponse.", status: "completed", patientId: PATIENT, calls: [{ name: "get_patient_context", args: { patientId: PATIENT } }], sources: [], quoteChecks: [], ...over });

describe("C200 evaluator: numbers and dates never match by accident", () => {
  it("matches a count only as a whole number", () => {
    expect(matches(numberAlternatives(6), "Vous avez 6 rendez-vous.")).toBe(true);
    expect(matches(numberAlternatives(6), "À 16:00, le 26 octobre, 60 minutes, 1,6 point.")).toBe(false);
    expect(matches(numberAlternatives(0), "Rendez-vous à 10:00.")).toBe(false);
    expect(matches(numberAlternatives(23000), "Recettes : 23 000 DZD.")).toBe(true);
    expect(matches(numberAlternatives(23000), "Recettes : 123 000 DZD.")).toBe(false);
  });
  it("accepts each way the app writes a day, and no other day", () => {
    const alternatives = dateAlternatives("2026-10-05");
    for (const text of ["le 05/10/2026", "le 5 octobre 2026", "2026-10-05", "le 5 octobre", "5 oct. 2026", "5 oct 2026"]) expect(matches(alternatives, text)).toBe(true);
    expect(matches(dateAlternatives("2025-01-05"), "dernière consultation du 5 janv. 2025")).toBe(true);
    expect(matches(alternatives, "15 oct. 2026")).toBe(false);
    expect(matches(alternatives, "le 15 octobre 2026")).toBe(false);
    expect(matches(alternatives, "le 5 novembre 2026")).toBe(false);
  });
  it("uses Monday-to-Sunday weeks and Algiers civil days", () => {
    expect(resolveRange("week", "2026-10-26")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(resolveRange("lastweek", "2026-10-26")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(resolveRange("lastmonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolveRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("C200 evaluator: patient and safety rules", () => {
  const oracle = { patientId: PATIENT, groups: [{ label: "count", any: numberAlternatives(104) }], decoyPatientIds: [OTHER], decoyNames: ["Karim Benali"] };
  it("passes a correct, attributed, written answer", () => {
    expect(evaluateTurn(oracle, obs({ answer: "Il a eu 104 consultations." })).verdict).toBe("PASS");
  });
  it("fails an empty answer, a wrong figure, and the wrong patient", () => {
    expect(evaluateTurn(oracle, obs({ answer: "" })).reasons).toContain("empty-answer");
    expect(evaluateTurn(oracle, obs({ answer: "Il a eu 98 consultations." })).reasons).toContain("missing:count");
    const wrong = evaluateTurn(oracle, obs({ answer: "104 consultations.", patientId: OTHER, calls: [{ name: "get_patient_context", args: { patientId: OTHER } }] }));
    expect(wrong.verdict).toBe("FAIL");
    expect(wrong.reasons).toContain("wrong-or-missing-patient");
    expect(wrong.reasons).toContain("cross-patient-read");
  });
  it("fails when another patient's name leaks into the answer", () => {
    expect(evaluateTurn(oracle, obs({ answer: "104 consultations. Karim Benali en a eu 12." })).reasons.some((r: string) => r.startsWith("contamination"))).toBe(true);
  });
  it("fails a read made before a clarification, and a clarification that is not asked", () => {
    const clarify = { clarify: true, decoyPatientIds: [PATIENT, OTHER] };
    expect(evaluateTurn(clarify, obs({ answer: "Quel patient voulez-vous dire ?", status: "needs_input", patientId: null, calls: [] })).verdict).toBe("PASS");
    expect(evaluateTurn(clarify, obs({ answer: "Voici son dossier.", status: "completed" })).verdict).toBe("FAIL");
    expect(evaluateTurn(clarify, obs({ answer: "Quel patient ?", status: "needs_input", calls: [{ name: "get_patient_context", args: { patientId: PATIENT } }] })).reasons).toContain("read-before-clarifying");
  });
  it("requires absence to be stated, not implied", () => {
    expect(evaluateTurn({ patientId: PATIENT, emptyState: true }, obs({ answer: "Aucun traitement n'est consigné." })).verdict).toBe("PASS");
    expect(evaluateTurn({ patientId: PATIENT, emptyState: true }, obs({ answer: "Voici le dossier." })).reasons).toContain("absence-not-stated");
  });
  it("reports a blocked oracle as BLOCKED and an unverifiable one as NOT VERIFIED, never as PASS", () => {
    expect(evaluateTurn({ blocked: "role-unresolved:R9" }, obs()).verdict).toBe("BLOCKED");
    expect(evaluateTurn({ notVerified: "x" }, obs()).verdict).toBe("NOT VERIFIED");
    expect(evaluateTurn({ notVerified: "x" }, obs({ answer: "" })).verdict).toBe("FAIL");
  });
  it("rolls turns up so one failure fails the case", () => {
    expect(rollUp(["PASS", "FAIL", "PASS"])).toBe("FAIL");
    expect(rollUp(["PASS", "NOT VERIFIED"])).toBe("NOT VERIFIED");
    expect(rollUp(["PASS", "PASS"])).toBe("PASS");
    expect(rollUp([])).toBe("NOT VERIFIED");
  });
});

describe("C200 evaluator: a book passage counts only when the doctor actually received it", () => {
  const book = { alts: [{ sourceLike: "DSM", textAll: ["critères diagnostiques"] }] };
  const check = { verbatim: true, sourceTitle: "DSM-5 — Manuel", section: "Troubles dépressifs", chunkHead: "Trouble dépressif caractérisé — critères diagnostiques — A.", chunkText: "x", markerPage: 160, pageInLabel: 160, sourceLabelMatches: true };
  const sources = [{ type: "knowledge", label: "DSM-5 — Manuel · p. 160" }];
  const answer = "Passage cité : « Trouble dépressif caractérisé — critères diagnostiques — A. Au moins cinq symptômes ». (p. 160)";
  it("passes a verbatim, relevant, cited passage", () => {
    expect(evaluateTurn({ book }, obs({ answer, sources, quoteChecks: [check], patientId: null, calls: [] })).verdict).toBe("PASS");
  });
  it("fails 'I found passages' with nothing shown", () => {
    const result = evaluateTurn({ book }, obs({ answer: "J'ai trouvé 3 passages pertinents.", sources, quoteChecks: [], patientId: null, calls: [] }));
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toContain("no-passage-presented");
  });
  it("fails a passage that is not word for word from an approved chunk", () => {
    expect(evaluateTurn({ book }, obs({ answer, sources, quoteChecks: [{ ...check, verbatim: false }], patientId: null, calls: [] })).reasons).toContain("passage-not-verbatim");
  });
  it("fails a verbatim passage from the wrong place", () => {
    const wrong = { ...check, section: "Spectre", chunkHead: "Schizophrénie — Prévalence", sourceTitle: "DSM-5 — Manuel" };
    expect(evaluateTurn({ book }, obs({ answer, sources, quoteChecks: [wrong], patientId: null, calls: [] })).reasons).toContain("no-relevant-passage");
  });
  it("fails an invented page number but only flags an unverifiable one", () => {
    expect(evaluateTurn({ book }, obs({ answer, sources, quoteChecks: [{ ...check, pageInLabel: 161 }], patientId: null, calls: [] })).reasons).toContain("page-mismatch");
    const unverifiable = evaluateTurn({ book }, obs({ answer, sources, quoteChecks: [{ ...check, markerPage: null }], patientId: null, calls: [] }));
    expect(unverifiable.verdict).toBe("PASS");
    expect(unverifiable.notes).toContain("page-unverified");
  });
  it("fails a passage with no citation", () => {
    expect(evaluateTurn({ book }, obs({ answer, sources: [], quoteChecks: [check], patientId: null, calls: [] })).reasons).toContain("no-citation");
  });
  it("extracts only substantial quotations", () => {
    expect(extractQuotes("« oui » puis « Trouble dépressif caractérisé — critères diagnostiques — A. Au moins cinq »")).toHaveLength(1);
  });
});

describe("C200 campaign file", () => {
  it("holds exactly 200 distinct French cases in the agreed distribution, and no book is named", () => {
    const { all, problems } = buildCases();
    expect(problems).toEqual([]);
    expect(all).toHaveLength(200);
  });
});

import { relativeDayAlternatives } from "../eval/alexa-clinical-conversational/v1/evaluate.mjs";
describe("C200 evaluator: relative days as the agenda writes them", () => {
  it("matches today, tomorrow and n days ahead, and nothing else", () => {
    const text = (day: string) => matches(relativeDayAlternatives(day, "2026-10-26"), "1 rendez-vous prévu : aujourd’hui à 15 h, demain, dans 3 jours à 9 h");
    expect(text("2026-10-26")).toBe(true);
    expect(text("2026-10-27")).toBe(true);
    expect(text("2026-10-29")).toBe(true);
    expect(text("2026-10-30")).toBe(false);
    expect(matches(relativeDayAlternatives("2026-10-24", "2026-10-26"), "il y a 2 jours")).toBe(true);
  });
});
