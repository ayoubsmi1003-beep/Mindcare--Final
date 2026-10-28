import { describe, expect, it } from "vitest";

import { buildSessionScaleFindings } from "@/server/alexa/session-summary";

const current = "a1000000-0000-4000-8000-000000003162";
const previous = "a1000000-0000-4000-8000-000000003161";
const definition = {
  code: "PHQ9",
  name_fr: "PHQ-9 — dépression",
  items: [{ id: "q9", texte: "Idées de mort ou d'auto-agression", risque: true, alerte: "Réponse positive à l'item 9." }],
  scoring: { max: 27 },
};

const histories = [
  { id: "s1", scale_code: "PHQ9", scale_name: "PHQ-9 — dépression", consultation_id: current, total: 16, interpretation: "modérément sévère", administered_at: "2026-10-25T13:26:00Z", responses: { q9: 2 }, definition },
  { id: "s0", scale_code: "PHQ9", scale_name: "PHQ-9 — dépression", consultation_id: previous, total: 10, interpretation: "modéré", administered_at: "2026-05-15T13:20:00Z", responses: { q9: 0 }, definition },
];
const definitions = [definition];

describe("buildSessionScaleFindings", () => {
  it("uses only the current consultation and keeps the risk item visible", () => {
    const result = buildSessionScaleFindings(current, histories, definitions);
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0]).toMatchObject({ scaleCode: "PHQ9", score: 16, max: 27, risk: { itemId: "q9", value: 2 } });
    expect(result.paragraph).toContain("16/27");
    expect(result.paragraph).toContain("item de risque positif");
    expect(result.paragraph).toContain("exploration clinique");
  });

  it("returns no paragraph and no evaluation when the current consultation has no scale", () => {
    const result = buildSessionScaleFindings("another-consultation", histories, definitions);
    expect(result.evaluations).toEqual([]);
    expect(result.paragraph).toBeNull();
  });

  it("reports every positive risk item from a scale administration", () => {
    const withTwoRiskItems = {
      ...definition,
      items: [
        ...definition.items,
        { id: "q10", texte: "Pensées d’auto-agression", risque: true, alerte: "Explorer aussi ce signal." },
      ],
    };
    const result = buildSessionScaleFindings(current, [
      { ...histories[0]!, responses: { q9: 2, q10: 1 }, definition: withTwoRiskItems },
    ], [withTwoRiskItems]);

    expect(result.paragraph).toMatch(/Idées de mort ou d['’]auto-agression/iu);
    expect(result.paragraph).toContain("Pensées d’auto-agression");
    expect(result.paragraph).toContain("exploration clinique");
  });

  it("does not invent a maximum when the definition is unavailable", () => {
    const result = buildSessionScaleFindings(current, histories, []);
    expect(result.evaluations[0]?.max).toBeNull();
    expect(result.paragraph).toContain("PHQ-9 — dépression 16");
    expect(result.paragraph).not.toContain("16/27");
    expect(result.paragraph).not.toContain("risque");
  });
});
