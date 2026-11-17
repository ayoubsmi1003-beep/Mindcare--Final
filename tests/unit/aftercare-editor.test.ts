import { describe, expect, it } from "vitest";
import { editableAftercarePublication, selectedAftercareSources, withdrawAftercarePublication } from "@/services/aftercare-editor";
const sourceId = "b5000000-0000-4000-8000-000000000001";
describe("Aftercare publication editor", () => {
  it("edits the published clinical body while preserving optional mission fields and dropping SQL authority metadata", () => {
    const publication = editableAftercarePublication({ source: "mindcare", kind: "mission", share_state: "shared", body: { title: "Synthetic mission", purpose: "Observe", instructions: "Reflect", durationMinutes: 10, dueOn: "2026-11-20", status: "published", approvedBy: sourceId, publishedAt: "2026-11-17T10:00:00Z" } });
    expect(publication).toEqual({ kind: "mission", body: { title: "Synthetic mission", purpose: "Observe", instructions: "Reflect", durationMinutes: 10, dueOn: "2026-11-20", status: "published" } });
    expect(publication && withdrawAftercarePublication(publication)).toMatchObject({ kind: "mission", body: { status: "withdrawn", instructions: "Reflect", durationMinutes: 10 } });
  });
  it.each(["mission", "carePlan", "doctorNote"])("withdraws %s without changing its clinical text", kind => {
    const body = kind === "mission" ? { title: "Mission", purpose: "Observe", instructions: "Reflect", status: "published" } : kind === "carePlan" ? { title: "Plan", text: "Human text", status: "published" } : { text: "Human text", status: "published" };
    const editable = editableAftercarePublication({ source: "mindcare", kind, body, share_state: "shared" });
    expect(editable).not.toBeNull(); expect(editable && withdrawAftercarePublication(editable)?.body).toEqual({ ...body, status: "withdrawn" });
  });
  it("never exposes patient submissions, revoked objects, reviews or trusted medication/appointment snapshots to the free-text editor", () => {
    const base = { source: "mindcare" as const, kind: "doctorNote", share_state: "shared" as const, body: { text: "Human note", status: "published" } };
    expect(editableAftercarePublication({ ...base, source: "sanad" })).toBeNull();
    expect(editableAftercarePublication({ ...base, share_state: "revoked" })).toBeNull();
    for (const kind of ["review", "treatment", "appointment"]) expect(editableAftercarePublication({ ...base, kind })).toBeNull();
  });
  it("accepts an explicit doctor milestone without inventing a status-based withdrawal", () => {
    const publication = editableAftercarePublication({ source: "mindcare", kind: "personalEvent", share_state: "shared", body: { type: "milestone", title: "Synthetic milestone", detail: "Human detail", happenedOn: "2026-11-17", category: "routine", tags: [], approvedBy: sourceId, publishedAt: "2026-11-17T10:00:00Z" } });
    expect(publication?.kind).toBe("personalEvent"); expect(publication && withdrawAftercarePublication(publication)).toBeNull();
  });
  it("resolves exact selected revisions for both report and preparation, with no guessed source body", () => {
    const refs = [{ recordId: sourceId, version: 3 }];
    expect(selectedAftercareSources({ kind: "preparation", body: { questions: "Synthetic question", selectedSources: refs } })).toEqual(refs);
    expect(selectedAftercareSources({ kind: "report", body: { title: "Report", from: "2026-11-01", to: "2026-11-17", audience: "clinician", selectedSources: refs, status: "ready" } })).toEqual(refs);
    expect(selectedAftercareSources({ kind: "preparation", body: { questions: "Question", selectedSources: [{ recordId: sourceId, version: 0 }] } })).toEqual([]);
  });
});
