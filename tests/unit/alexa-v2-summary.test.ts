import { expect, it } from "vitest";
import { localDisplay } from "@/server/alexa/local-response";
import { buildCaseSummary } from "@/server/alexa/case-summary";
import type { ClinicalContext } from "@/shared/alexa/clinical";

it("includes a short local quotation from the latest note with its source", () => {
  const context = summaryContext();
  context.consultations[1]!.notes = [{ id: "n", version: "v3", subjective: "Nadia décrit un sommeil de 6 heures, sans réveil nocturne.", objective: null, assessment: null, plan: null, amendments: [] }];
  const narrative = buildCaseSummary(context, ["Nadia"]).apercu.contexte;
  expect(narrative[2]?.texte).toContain("sommeil de 6 heures, sans réveil nocturne.");
  expect(narrative[2]?.texte).toContain("«");
  expect(narrative[2]?.texte).not.toContain("Nadia");
  expect(narrative[2]?.sources).toEqual([{ t: "consultation", id: "latest" }]);
});

it("shows a short amendment as an amendment rather than a silently rewritten summary", () => {
  const context = summaryContext();
  context.consultations[1]!.notes = [{ id: "n", version: "v3", subjective: "Sommeil de 6 heures.", objective: null, assessment: null, plan: null, amendments: [{ id: "a", body: "Correction : sommeil de 3 heures.", reason: "Rectification", createdAt: "2026-02-03T10:00:00Z" }] }];
  const text = buildCaseSummary(context, []).apercu.contexte[2]?.texte;
  expect(text).toContain("Correction : sommeil de 3 heures.");
  expect(text).toMatch(/addendum/iu);
});

it("uses current treatment states and real treatment sources instead of latest prescription", () => {
  const context: ClinicalContext = { patientId: "a", consultations: [{ id: "c", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T01:00:00Z", notes: [] }], treatments: {
    current: [{ id: "t", medication: "sertraline", status: "paused", dose: "50", doseUnit: "mg", frequency: "1/j", timing: [], instructions: null, startDate: "2026-01-01", endDate: null, version: 2 }], history: [], historyComplete: true },
    diagnoses: [], scales: [], sourceRevision: "r", coverage: { requested: 5, returned: 1, complete: false, hasMore: false } };
  const summary = buildCaseSummary(context, []);
  expect(summary.apercu.traitements[0]).toMatchObject({ sources: [{ t: "treatment", id: "t" }] });
  expect(summary.apercu.traitements[0]?.texte).toContain("en pause");
  expect(summary.apercu.contexte.map(s => s.texte).join(" ")).toContain("partielle");
  expect(JSON.stringify(summary)).not.toContain('"prescription"');
});
it("redacts complete identity words without corrupting drug names", () => {
  expect(localDisplay("Ali : Sertraline 50 mg. Nadia : Bromazepam.", ["Ali", "Nadia"])).toBe(": Sertraline 50 mg.  : Bromazepam.");
  expect(localDisplay("علي : سيرترالين. علياء", ["علي"])).toBe(": سيرترالين. علياء");
});

function summaryContext(): ClinicalContext {
  return {
    patientId: "a", consultations: [{ id: "older", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T01:00:00Z", notes: [] },
      { id: "latest", startedAt: "2026-02-02T00:00:00Z", endedAt: "2026-02-02T01:00:00Z", notes: [] }],
    diagnoses: [{ id: "diagnostic-active", label: "Trouble anxieux", code: null, primary: true, onsetDate: null, resolvedAt: null },
      { id: "diagnostic-resolved", label: "Ancien diagnostic", code: null, primary: false, onsetDate: null, resolvedAt: "2025-01-01T00:00:00Z" }],
    treatments: { current: [
      { id: "t-active", medication: "Sertraline", status: "active", dose: "100", doseUnit: "mg", frequency: "1/j", timing: [], instructions: null, startDate: "2026-01-01", endDate: null, version: 1 },
      { id: "t-paused", medication: "Bromazepam", status: "paused", dose: "1,5", doseUnit: "mg", frequency: "si besoin", timing: [], instructions: null, startDate: "2026-01-01", endDate: null, version: 2 },
      { id: "t-stopped", medication: "Fluoxétine", status: "stopped", dose: "20", doseUnit: "mg", frequency: "1/j", timing: [], instructions: null, startDate: "2025-01-01", endDate: "2026-01-01", version: 3 },
    ], history: [], historyComplete: true },
    scales: [], sourceRevision: "r", coverage: { requested: 2, returned: 2, complete: true, hasMore: false },
  };
}

it("renders recorded diagnoses, all treatment states and the latest completed consultation as a sourced French narrative", () => {
  const context = summaryContext();
  context.currentConsultation = { id: "open", startedAt: "2026-03-03T00:00:00Z", endedAt: null, notes: [] };
  const summary = buildCaseSummary(context, []);
  const narrative = summary.apercu.contexte;
  expect(narrative.length).toBeGreaterThanOrEqual(2);
  expect(narrative.length).toBeLessThanOrEqual(4);
  expect(narrative[0]).toMatchObject({ sources: [{ t: "diagnostic", id: "diagnostic-active" }] });
  expect(narrative[0]?.texte).toContain("Trouble anxieux");
  expect(narrative[0]?.texte).not.toContain("Ancien diagnostic");
  expect(narrative[1]?.texte).toContain("Sertraline");
  expect(narrative[1]?.texte).toContain("100 mg");
  expect(narrative[1]?.texte).toContain("1/j");
  expect(narrative[1]?.texte).toContain("actif");
  expect(narrative[1]?.texte).toContain("1,5 mg");
  expect(narrative[1]?.texte).toContain("si besoin");
  expect(narrative[1]?.texte).toContain("en pause");
  expect(narrative[1]?.texte).toContain("arrêté");
  expect(narrative[1]?.sources).toEqual([{ t: "treatment", id: "t-active" }, { t: "treatment", id: "t-paused" }, { t: "treatment", id: "t-stopped" }]);
  expect(narrative[2]).toMatchObject({ sources: [{ t: "consultation", id: "latest" }] });
  expect(narrative[2]?.texte).toContain("2 février 2026");
  expect(narrative[2]?.texte).not.toContain("3 mars");
});

it("states missing structured facts without inventing a diagnosis, treatment or completed visit", () => {
  const context = summaryContext();
  context.consultations = [];
  context.diagnoses = [];
  context.treatments.current = [];
  context.coverage = { requested: 5, returned: 0, complete: false, hasMore: false };
  const summary = buildCaseSummary(context, []);
  const text = summary.apercu.contexte.map(s => s.texte).join(" ");
  expect(text).toContain("Aucun diagnostic non résolu");
  expect(text).toContain("Aucun traitement");
  expect(text).toContain("Aucune consultation terminée");
  expect(summary.apercu.contexte.flatMap(s => s.sources)).toEqual([]);
  expect(summary.apercu.diagnostics).toEqual([]);
  expect(summary.apercu.traitements).toEqual([]);
});

it("keeps zero doses and explicitly marks missing dose units and frequencies", () => {
  const context = summaryContext();
  context.treatments.current = [{ ...context.treatments.current[0]!, dose: "0", doseUnit: null, frequency: null }];
  const summary = buildCaseSummary(context, []);
  expect(summary.apercu.contexte[1]?.texte).toContain("0");
  expect(summary.apercu.contexte[1]?.texte).toContain("unité non renseignée");
  expect(summary.apercu.contexte[1]?.texte).toContain("fréquence non renseignée");
  expect(summary.apercu.contexte[1]?.texte).not.toContain("0 mg");
  expect(summary.apercu.traitements[0]?.texte).toContain("0");
});

it("declares incomplete consultation and treatment-history coverage while withholding note interpretation", () => {
  const context = summaryContext();
  context.consultations[1]!.notes = [{ id: "n", version: "1", subjective: "Le patient va beaucoup mieux", objective: null, assessment: "Guérison", plan: null, amendments: [] }];
  context.coverage = { requested: 5, returned: 2, complete: false, hasMore: true };
  context.treatments.historyComplete = false;
  const summary = buildCaseSummary(context, []);
  const text = summary.apercu.contexte.map(s => s.texte).join(" ");
  expect(text).toContain("partielle");
  expect(text).toContain("2");
  expect(text).toContain("5");
  expect(text).toContain("historique des traitements est incomplet");
  expect(text).toContain("ne sont pas interprétées");
  expect(text).toContain("« Le patient va beaucoup mieux »");
  expect(text).not.toContain("Guérison");
  expect(summary.schema).toBe(2);
  expect(summary).toMatchObject({ apercu: { age: null, residence: null }, anterieur: [] });
  expect(summary.etat_actuel.map(item => item.texte).join(" ")).toContain("Le patient va beaucoup mieux");
  expect(summary.etat_actuel.map(item => item.texte).join(" ")).toContain("Guérison");
  expect(summary.etat_actuel.every(item => item.sources.some(source => source.id === "latest"))).toBe(true);
  expect(summary.chronologie[0]?.entrees).toHaveLength(2);
});
