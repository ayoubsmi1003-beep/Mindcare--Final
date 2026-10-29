import { describe, expect, it, vi } from "vitest";
import { ConversationState, referenceForPersistence } from "@/server/alexa/conversation-state";
import { planRequest } from "@/server/alexa/request-plan";
import { requestedConsultationCount } from "@/shared/alexa/request-plan";
import { executeRead } from "@/server/alexa/tool-executor";

describe("Alexa scoped conversation", () => {
  it("keeps raw lastRequest out of the persisted working reference", () => {
    const reference = { intent: "patient_finance" as const, count: 1, lastRequest: "Quel est le montant encaissé ce mois-ci ?" };
    const persisted = referenceForPersistence(reference);
    expect(persisted).not.toHaveProperty("lastRequest");
    expect(reference.lastRequest).toBe("Quel est le montant encaissé ce mois-ci ?");
  });
  it("retains only the latest raw request in memory, then replaces it on the next turn", () => {
    const state = new ConversationState();
    const first = state.begin("actor", "conversation", "patient-a", "/patients/a", 0);
    state.finish(first, { intent: "history", count: 1, lastRequest: "Ancienne demande confidentielle." }, 1);
    const second = state.begin("actor", "conversation", "patient-a", "/patients/a", 2);
    state.finish(second, { intent: "history", count: 1, lastRequest: "Demande actuelle." }, 3);

    const entries = (state as unknown as { entries: Map<string, unknown> }).entries;
    const stored = entries.get(JSON.stringify(["actor", "conversation"]));
    expect(stored).toMatchObject({ reference: { lastRequest: "Demande actuelle." } });
    expect(stored).not.toHaveProperty("turns");
    expect(JSON.stringify(stored)).not.toContain("Ancienne demande confidentielle.");
  });
  it("invalidates previous turns and cursors on patient and page changes", () => {
    const state = new ConversationState();
    const a = state.begin("actor", "conversation", "patient-a", "/patients/a", 0);
    state.finish(a, { intent: "history", count: 5, cursor: { startedAt: "2026-01-01", id: "c1" } }, 1);
    expect(state.read("actor", "conversation", "patient-a", "/patients/a", 2)?.count).toBe(5);
    state.begin("actor", "conversation", "patient-b", "/patients/b", 3);
    expect(state.isCurrent(a)).toBe(false);
    expect(state.read("actor", "conversation", "patient-b", "/patients/b", 4)).toBeNull();
    expect(state.read("other-actor", "conversation", "patient-a", "/patients/a", 5)).toBeNull();
  });
  it("expires after fifteen idle minutes and rejects a late finish", () => {
    const state = new ConversationState();
    const a = state.begin("actor", "conversation", "p", "/patients/p", 0);
    state.finish(a, { intent: "history", count: 1, lastRequest: "Résume les consultations de cette patiente." }, 1);
    expect(state.read("actor", "conversation", "p", "/patients/p", 899_999)?.lastRequest).toBe("Résume les consultations de cette patiente.");
    expect(state.read("actor", "conversation", "p", "/patients/p", 900_002)).toBeNull();
    const b = state.begin("actor", "conversation", "p", "/patients/p", 900_003);
    expect(state.finish(a, { intent: "treatments", count: 1 }, 900_004)).toBe(false);
    expect(state.isCurrent(b)).toBe(true);
  });
  it("evicts raw follow-up text after fifteen idle minutes without waiting for another request", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const state = new ConversationState();
      const lease = state.begin("actor", "conversation", "p", "/patients/p", Date.now());
      state.finish(lease, { intent: "history", count: 1, lastRequest: "Synthetic private follow-up." }, Date.now());
      const entries = (state as unknown as { entries: Map<string, unknown> }).entries;
      expect(entries.size).toBe(1);

      vi.advanceTimersByTime(900_001);

      expect(entries.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("restores a validated reference only under the exact selected consultation and document revision", () => {
    const state = new ConversationState();
    const reference = { intent: "documents" as const, count: 1, selectedPatientId: "11111111-1111-4111-8111-111111111111", lastRequest: "Quel document est ouvert ?" };
    expect(state.restore("actor", "conversation", null, "/jarvis", reference, "{\"documentId\":\"doc-a\",\"revision\":\"rev-1\"}", 10)).toBe(true);
    expect(state.read("actor", "conversation", null, "/jarvis", 11, "{\"documentId\":\"doc-a\",\"revision\":\"rev-1\"}")).toMatchObject({ intent: reference.intent, count: reference.count, selectedPatientId: reference.selectedPatientId });
    expect(state.read("actor", "conversation", null, "/jarvis", 11, "{\"documentId\":\"doc-a\",\"revision\":\"rev-1\"}")).not.toHaveProperty("lastRequest");
    expect(state.read("actor", "conversation", null, "/jarvis", 12, "{\"documentId\":\"doc-a\",\"revision\":\"rev-2\"}")).toBeNull();
    expect(state.restore("actor", "other", null, "/jarvis", { ...reference, selectedPatientId: "not-a-uuid" }, "same", 13)).toBe(false);
  });
});

describe("Alexa local request planning", () => {
  it.each([
    ["les quatre dernières consultations", 4], ["les dix dernières consultations", 10],
    ["les quinze dernières consultations", 15], ["les vingt-cinq dernières consultations", 25],
    ["آخر ٥ جلسات", 5], ["dernière consultation de Vincent Martin", 1],
    ["dernière consultation du 15/09/2026", 1],
  ])("extracts only a consultation quantity in %s", (text, count) => {
    expect(planRequest(text, null).count).toBe(count);
  });
  it("does not treat an ordinal earlier-visit request as the latest consultation",()=>{
    expect(requestedConsultationCount("Résume l’avant-dernière consultation du patient sélectionné.")).toBeNull();
  });
  it("binds a principal-problems question about the current visit to one consultation",()=>{
    expect(requestedConsultationCount("Quels problèmes principaux sont documentés dans la consultation actuelle ?")).toBe(1);
  });
  it.each([
    ["les cinq dernières consultations", "history", 5, "fr"],
    ["آخر خمس جلسات", "history", 5, "ar"],
    ["wach howa traitement الحالي", "treatments", 1, "mixed"],
    ["prépare la consultation", "preparation", 5, "fr"],
    ["évolution depuis le début", "longitudinal", 100, "fr"],
  ])("plans %s without model-selected endpoints", (text, intent, count, language) => {
    expect(planRequest(text, null)).toMatchObject({ intent, count, language });
  });
  it("only elliptical history requests inherit the prior cursor", () => {
    const previous = { intent: "history" as const, count: 5, cursor: { startedAt: "2026-01-01", id: "c1" } };
    expect(planRequest("et avant ?", previous)).toMatchObject({ intent: "history", count: 5, before: previous.cursor });
    expect(planRequest("et le traitement ?", previous)).toMatchObject({ intent: "treatments" });
    expect(planRequest("dernière consultation", previous).before).toBeUndefined();
    expect(planRequest("supprime le dossier", previous).intent).toBe("proposal");
  });
});

describe("bounded read execution", () => {
  it("refuses writes and malformed arguments before any read", async () => {
    let calls = 0;
    const read = async () => { calls++; return "ok"; };
    await expect(executeRead("delete_patient", {}, "p", read)).rejects.toThrow();
    await expect(executeRead("clinical_context", { patientId: "other", count: 5 }, "p", read)).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it("forwards cancellation and bounds a nonresponsive read", async () => {
    const control = new AbortController();
    const pending = executeRead("clinical_context", { patientId: "p", count: 5 }, "p", async () => new Promise(() => {}), control.signal, 10);
    await expect(pending).rejects.toThrow("Timeout");
    control.abort();
    await expect(executeRead("clinical_context", { patientId: "p", count: 5 }, "p", async () => "ok", control.signal)).rejects.toThrow();
  });
});
