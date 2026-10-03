import { describe, expect, it } from "vitest";
import { ConversationState } from "@/server/alexa/conversation-state";
import { planRequest } from "@/server/alexa/request-plan";
import { executeRead } from "@/server/alexa/tool-executor";

describe("Alexa scoped conversation", () => {
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
    state.finish(a, { intent: "history", count: 1 }, 1);
    expect(state.read("actor", "conversation", "p", "/patients/p", 900_002)).toBeNull();
    const b = state.begin("actor", "conversation", "p", "/patients/p", 900_003);
    expect(state.finish(a, { intent: "treatments", count: 1 }, 900_004)).toBe(false);
    expect(state.isCurrent(b)).toBe(true);
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
