import { describe, expect, it } from "vitest";

import { buildCaseSynthesis, CASE_SYNTHESIS_VERSION, type ScaleAdministrationLite, type ScaleDefinitionLite } from "@/server/alexa/case-synthesis";
import type { ClinicalContext } from "@/shared/alexa/clinical";

const patientId = "a1000000-0000-4000-8000-000000001016";
const consultationA = "a1000000-0000-4000-8000-000000003161";
const consultationB = "a1000000-0000-4000-8000-000000003162";
const diagnosis = "a1000000-0000-4000-8000-000000005001";
const treatment = "a1000000-0000-4000-8000-000000006001";
const scaleA = "a1000000-0000-4000-8000-000000007001";
const scaleB = "a1000000-0000-4000-8000-000000007002";

function context(overrides: Partial<ClinicalContext> = {}): ClinicalContext {
  return {
    patientId,
    consultations: [
      {
        id: consultationA,
        startedAt: "2026-05-15T13:00:00Z",
        endedAt: "2026-05-15T13:40:00Z",
        rawNotes: null,
        notes: [],
        analysis: {
          id: "a1000000-0000-4000-8000-000000008001",
          version: 1,
          content: { resume: "La patiente rapporte une anxiété persistante et des difficultés relationnelles.", generated: true, complete: true, notesDigest: "x" },
        },
      },
      {
        id: consultationB,
        startedAt: "2026-10-25T13:07:00Z",
        endedAt: "2026-10-25T13:37:00Z",
        rawNotes: null,
        notes: [
          {
            id: "a1000000-0000-4000-8000-000000004161",
            version: "1",
            status: "signed",
            subjective: "Humeur stable, sans idée noire. Sommeil conservé. Anxiété contenue.",
            objective: null,
            assessment: null,
            plan: "Poursuivre le traitement. Revoir dans un mois.",
            amendments: [],
          },
        ],
        analysis: {
          id: "a1000000-0000-4000-8000-000000008002",
          version: 1,
          content: { resume: "La patiente rapporte une anxiété persistante et des difficultés relationnelles, avec une humeur stable et un sommeil conservé.", generated: true, complete: true, notesDigest: "y" },
        },
      },
    ],
    diagnoses: [
      { id: diagnosis, label: "Trouble anxieux", code: null, primary: true, onsetDate: "2025-01-01", resolvedAt: null },
    ],
    treatments: {
      current: [
        { id: treatment, medication: "Sertraline", status: "active", dose: "50", doseUnit: "mg", frequency: "1/j", timing: [], instructions: null, startDate: "2025-01-01", endDate: null, version: 2 },
      ],
      history: [],
      historyComplete: true,
    },
    scales: [
      { id: scaleB, name: "PHQ-9 — dépression", administeredAt: "2026-10-25T13:26:00Z", score: 16, interpretation: "modérément sévère" },
      { id: scaleA, name: "PHQ-9 — dépression", administeredAt: "2026-05-15T13:20:00Z", score: 10, interpretation: "modéré" },
    ],
    sourceRevision: "a".repeat(64),
    coverage: { requested: 2, returned: 2, complete: true, hasMore: false },
    ...overrides,
  };
}

const histories: readonly ScaleAdministrationLite[] = [
  { id: scaleB, scaleCode: "PHQ9", scaleName: "PHQ-9 — dépression", consultationId: consultationB, total: 16, interpretation: "modérément sévère", administeredAt: "2026-10-25T13:26:00Z", responses: { q9: 2 } },
  { id: scaleA, scaleCode: "PHQ9", scaleName: "PHQ-9 — dépression", consultationId: consultationA, total: 10, interpretation: "modéré", administeredAt: "2026-05-15T13:20:00Z", responses: { q9: 0 } },
];

const definitions: readonly ScaleDefinitionLite[] = [
  {
    code: "PHQ9",
    nom: "PHQ-9 — dépression",
    items: [
      { id: "q9", texte: "Idées de mort ou d'auto-agression", risque: true, alerte: "Réponse positive à l'item 9 (idées de mort ou d'auto-agression) — à explorer cliniquement sans délai." },
    ],
    scoring: { max: 27 },
  },
];

describe("buildCaseSynthesis", () => {
  it("versions the saved case summary after its diagnosis projection changes", () => {
    expect(CASE_SYNTHESIS_VERSION).toBe("case-synthesis-fr-v5");
  });

  it("writes diagnosis and treatment facts as complete, human-readable sentences", () => {
    const result = buildCaseSynthesis({ context: context(), histories, definitions });
    const text = result.paragraphes.map((item) => item.texte).join(" ");

    expect(text).toContain("Le suivi concerne le diagnostic principal « Trouble anxieux ».");
    expect(text).toContain("Le traitement actuel comprend Sertraline 50 mg, 1/j.");
    expect(text).not.toMatch(/consignée|SOAP|Subjectif/u);
    expect(result.paragraphes.every((item) => /[.!?…]\s*»?$/u.test(item.texte) && !item.texte.includes("\n") && !/^\s*[-*•]\s/mu.test(item.texte)), "every case summary item must be a complete paragraph").toBe(true);
    expect(text).not.toContain(" · ");
  });

  it("writes a readable longitudinal narrative without a date before every fact", () => {
    const result = buildCaseSynthesis({ context: context(), histories, definitions });
    const text = result.paragraphes.map((item) => item.texte).join(" ");

    expect(text).toContain("Trouble anxieux");
    expect(text).toContain("Sertraline");
    expect(text).toContain("PHQ-9");
    expect(text).toContain("16");
    expect(text).toContain("10");
    expect(text).toContain("différences relationnelles".replace("différences", "difficultés"));
    expect(text).not.toContain("Pour la consultation du");
    expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}.*\d{2}\/\d{2}\/\d{4}/u);
    // The story: how it began, how it evolved, where it stands, what comes next — each paragraph with its own sources.
    expect(result.paragraphes.map((item) => item.texte)).toEqual([
      "Le suivi concerne le diagnostic principal « Trouble anxieux ». Le suivi a commencé le 15 mai 2026. Lors de cette première consultation, la patiente rapporte une anxiété persistante et des difficultés relationnelles.",
      "Le PHQ-9 — dépression est passé de 10/27 (modéré) à 16/27 (modérément sévère).",
      "Lors de la dernière consultation, le 25 octobre 2026, la patiente rapporte une anxiété persistante et des difficultés relationnelles, avec une humeur stable et un sommeil conservé. Le traitement actuel comprend Sertraline 50 mg, 1/j.",
      "Pour la suite, poursuivre le traitement. Revoir dans un mois.",
    ]);
    for (const paragraph of result.paragraphes) {
      const sources = paragraph.sources.map((source) => `${source.t}:${source.id}`);
      expect(sources.length).toBeGreaterThan(0);
      expect(new Set(sources).size).toBe(sources.length);
    }
  });

  it("uses the curated human visit paragraph instead of the retained model notes", () => {
    const consultations = context().consultations.map((consultation) => consultation.id === consultationB
      ? {
          ...consultation,
          analysis: {
            ...consultation.analysis!,
            content: {
              ...(consultation.analysis!.content as Record<string, unknown>),
              resumeNotes: "Notes sources conservées pour la traçabilité.",
              resume: "La séance a été consacrée aux difficultés relationnelles.",
            },
          },
        }
      : consultation);
    const result = buildCaseSynthesis({ context: context({ consultations }), histories: [], definitions: [] });
    const text = result.paragraphes.map((item) => item.texte).join(" ");

    expect(text).toContain("difficultés relationnelles");
    expect(text).not.toContain("Notes sources conservées");
  });

  it("includes the updated active diagnosis as sourced prose and excludes a resolved prior diagnosis", () => {
    const resolvedId = "a1000000-0000-4000-8000-000000005002";
    const result = buildCaseSynthesis({
      context: context({ diagnoses: [
        { id: diagnosis, label: "Trouble anxieux actualisé", code: "F41.1", primary: true, onsetDate: "2025-01-01", resolvedAt: null },
        { id: resolvedId, label: "Trouble panique résolu", code: "F41.0", primary: false, onsetDate: "2024-01-01", resolvedAt: "2026-09-01" },
      ] }),
      histories,
      definitions,
    });
    const paragraphs = result.paragraphes;
    const text = paragraphs.map((item) => item.texte).join(" ");
    expect(text).toContain("Trouble anxieux actualisé");
    expect(text).not.toContain("Trouble panique résolu");
    expect(paragraphs.flatMap((item) => item.sources)).toContainEqual({ t: "diagnostic", id: diagnosis });
    expect(paragraphs.every((item) => !item.texte.includes("\n") && !/^\s*[-*•]\s/mu.test(item.texte))).toBe(true);
  });

  it("keeps active and resolved diagnoses with their recorded status in the saved case resume", () => {
    const resolvedId = "a1000000-0000-4000-8000-000000005002";
    const result = buildCaseSynthesis({
      context: context({ diagnoses: [
        { id: diagnosis, label: "Trouble anxieux actualisé", code: "F41.1", primary: true, onsetDate: "2025-01-01", resolvedAt: null },
        { id: resolvedId, label: "Trouble panique résolu", code: "F41.0", primary: false, onsetDate: "2024-01-01", resolvedAt: "2026-09-01" },
      ] }),
      histories,
      definitions,
    });

    expect(result.diagnostics.map((entry) => entry.texte)).toEqual([
      "Trouble anxieux actualisé (actif depuis le 01/01/2025)",
      "Trouble panique résolu (résolu le 01/09/2026)",
    ]);
    expect(result.diagnostics.flatMap((entry) => entry.sources)).toEqual([
      { t: "diagnostic", id: diagnosis },
      { t: "diagnostic", id: resolvedId },
    ]);
  });

  it("keeps the PHQ-9 item 9 finding visible without inventing a diagnosis or urgency", () => {
    const result = buildCaseSynthesis({ context: context(), histories, definitions });
    const vigilance = result.vigilance.map((item) => item.texte).join(" ");
    expect(vigilance).toContain("item 9");
    expect(vigilance).toContain("idées de mort");
    expect(vigilance).toContain("exploration clinique");
    expect(vigilance).not.toMatch(/suicidaire|risque imminent|urgence vitale/u);
    expect(result.vigilance.flatMap((item) => item.sources)).toContainEqual({ t: "echelle", id: scaleB });
  });

  it("uses the saved consultation summary instead of duplicating the raw note", () => {
    const result = buildCaseSynthesis({ context: context(), histories, definitions });
    const text = result.paragraphes.map((item) => item.texte).join(" ");
    expect(text).toContain("anxiété persistante");
    expect(text).not.toContain("Sommeil conservé. Anxiété contenue.");
    expect(text).not.toContain("La dernière note consignée rapporte");
  });

  it("does not invent a delta when only one measurement exists", () => {
    const result = buildCaseSynthesis({
      context: context({ scales: [context().scales[0]!] }),
      histories: [histories[0]!],
      definitions,
    });
    const text = result.paragraphes.map((item) => item.texte).join(" ");
    expect(text).toContain("PHQ-9");
    expect(text).not.toMatch(/hausse|baisse|points? de plus|écart/iu);
  });

  it("omits absent categories instead of filling them with non renseigné", () => {
    const result = buildCaseSynthesis({
      context: context({ diagnoses: [], treatments: { current: [], history: [], historyComplete: true }, scales: [], consultations: [] }),
      histories: [],
      definitions,
    });
    const text = result.paragraphes.map((item) => item.texte).join(" ");
    expect(text).not.toContain("non renseigné");
    expect(result.paragraphes).toHaveLength(0);
  });
});

describe("buildCaseSynthesis on long and sparse records", () => {
  it("keeps the first and latest visits of a 25-visit history, counts the rest and stays short", () => {
    const visits = Array.from({ length: 25 }, (_, index) => ({
      id: `a1000000-0000-4000-8000-${String(100000000000 + index)}`,
      startedAt: new Date(Date.UTC(2024, index, 10, 9)).toISOString(),
      endedAt: new Date(Date.UTC(2024, index, 10, 10)).toISOString(),
      rawNotes: null, notes: [],
      analysis: { id: `b1000000-0000-4000-8000-${String(100000000000 + index)}`, version: 1, content: { resume: `Séance numéro ${index + 1} consacrée au sommeil.`, generated: true, complete: true, notesDigest: "d" } },
    }));
    const result = buildCaseSynthesis({ context: context({ consultations: visits, scales: [], coverage: { requested: 25, returned: 25, complete: true, hasMore: false } }), histories: [], definitions: [] });
    const text = result.paragraphes.map((item) => item.texte).join(" ");
    expect(text).toContain("Le suivi a commencé le 10 janvier 2024.");
    expect(text).toContain("séance numéro 1 consacrée");
    expect(text).toContain("Depuis, 24 consultations ont eu lieu.");
    expect(text).toContain("le 10 janvier 2026, séance numéro 25 consacrée");
    expect(text).not.toContain("numéro 12");
    expect(text.length).toBeLessThan(1500);
  });

  it("says what is missing instead of inventing it, and notices an unsigned note and a missing dose", () => {
    const sparse = context({
      diagnoses: [],
      consultations: [{ id: consultationB, startedAt: "2026-10-25T13:07:00Z", endedAt: "2026-10-25T13:37:00Z", rawNotes: null,
        notes: [{ id: "a1000000-0000-4000-8000-000000004162", version: "1", status: "draft", subjective: null, objective: null, assessment: null, plan: null, amendments: [] }] }],
      treatments: { current: [{ id: treatment, medication: "Sertraline", status: "active", dose: null, doseUnit: null, frequency: null, timing: [], instructions: null, startDate: "2025-01-01", endDate: null, version: 1 }], history: [], historyComplete: true },
      scales: [],
    });
    const result = buildCaseSynthesis({ context: sparse, histories: [], definitions: [] });
    const text = result.paragraphes.map((item) => item.texte).join(" ");
    expect(text).toBe("Lors de la seule consultation terminée, le 25 octobre 2026, aucune note exploitable n’a été rédigée. Le traitement actuel comprend Sertraline.");
    expect(result.vigilance.map((item) => item.texte)).toEqual([
      "La note de la dernière consultation n’est pas encore signée.",
      "Aucune dose n’est renseignée pour Sertraline.",
    ]);
  });
});
