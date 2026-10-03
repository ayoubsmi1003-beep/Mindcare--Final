import { expect, it, vi } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { runAlexa } from "@/server/alexa/orchestrator";
import type { AlexaEvent } from "@/shared/alexa/turn";
import type { AppError } from "@/services/errors";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { readDailyReceipts } from "@/server/alexa/receipts-adapter";
import { conversationState } from "@/server/alexa/conversation-state";

it.each(["Combien ai-je encaissé aujourd'hui ?", "Recette du jour", "شحال دخلنا اليوم؟", "combien دخلنا اليوم"])("recognizes a clear daily cash read: %s", text => {
  expect(planRequest(text, null)).toMatchObject({ intent: "receipts" });
});
it.each(["Combien ai-je encaissé aujourd'hui pour Martin ?", "encaisse ce paiement aujourd'hui", "Combien encaissé aujourd'hui et hier ?",
  "Recette du jour Martin", "Recette du jour et son traitement", "Recette du jour du cabinet", "encaisse aujourd'hui"])("does not silently answer a different cash scope: %s", text => {
  expect(planRequest(text, null).intent).not.toBe("receipts");
});

it("keeps a database read failure unavailable rather than manufacturing cash", async () => {
  const result = await run({ encaisse: { montant_dzd: 42, seances: 1, perimetre: "cabinet" } }, { code: "indisponible", message: "database unavailable" });
  expect(result.events.filter(event => event.type === "sentence")).toHaveLength(0);
  expect(result.events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("encaissements") });
});

it("does not read the gate for an aborted request", async () => {
  const controller = new AbortController(); controller.abort();
  const rpc = vi.fn();
  await expect(readDailyReceipts({ rpc }, controller.signal)).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
});

it("does not publish a daily total returned after cancellation", async () => {
  const controller = new AbortController(), events: AlexaEvent[] = [];
  const cash: unknown = { encaisse: { montant_dzd: 42, seances: 1, perimetre: "cabinet" } };
  const rpc = async <T>() => { controller.abort(); return { data: cash as T, error: null }; };
  await runAlexa({ text: "Recette du jour", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
    { actor: "receipts-cancel", db: { rpc: vi.fn() }, knowledge: { rpc } }, event => events.push(event), controller.signal);
  expect(events.filter(event => event.type === "sentence" || event.type === "done")).toHaveLength(0);
  expect(events.at(-1)).toMatchObject({ type: "error", code: "cancelled" });
});

it("a daily cash exchange replaces the previous clinical follow-up reference", async () => {
  const conversationId = crypto.randomUUID(), actor = "receipts-memory";
  const previous = conversationState.begin(actor, conversationId, null, "/jarvis");
  conversationState.finish(previous, { intent: "history", count: 5, cursor: { id: crypto.randomUUID(), startedAt: "2026-09-01T10:00:00Z" } });
  const cash: unknown = { encaisse: { montant_dzd: 0, seances: 0, perimetre: "cabinet" } };
  const rpc = async <T>() => ({ data: cash as T, error: null });
  await runAlexa({ text: "Recette du jour", conversationId, clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
    { actor, db: { rpc: vi.fn() }, knowledge: { rpc } }, () => {}, new AbortController().signal);
  expect(planRequest("avant ?", conversationState.read(actor, conversationId, null, "/jarvis"))).toMatchObject({ intent: "clarify" });
});

async function run(value: unknown, error: AppError | null = null) {
  const events: AlexaEvent[] = [];
  const rpc = vi.fn(async (_name: string, _args?: Readonly<Record<string, unknown>>) => ({ data: value, error }));
  const knowledge: ClientSql = { rpc: async <T>(name: string, args?: Readonly<Record<string, unknown>>) => {
    const result = await rpc(name, args); return { data: result.data as T, error: result.error };
  } };
  const patientRead = vi.fn(), infer = vi.fn();
  await runAlexa({ text: "Combien ai-je encaissé aujourd'hui ?", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: "/jarvis" } },
    { actor: "receipts-unit", db: { rpc: patientRead }, knowledge, infer }, event => events.push(event), new AbortController().signal);
  return { events, rpc, patientRead, infer };
}

it("reads collected cash rather than billed totals, using the existing gate and no model/patient lookup", async () => {
  const result = await run({ encaisse: { montant_dzd: "12000", seances: "2", perimetre: "praticienne" }, total_dzd: "777000", first_name: "Hidden identity" });
  expect(result.rpc).toHaveBeenCalledWith("dashboard_today", { p_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(result.patientRead).not.toHaveBeenCalled(); expect(result.infer).not.toHaveBeenCalled();
  const text = result.events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
  expect(text.replace(/\s/gu, "")).toContain("12000");
  expect(text).not.toContain("777000"); expect(text).not.toContain("Hidden identity");
  expect(text).toContain("encaissé"); expect(text).toContain("praticienne");
  expect(result.events.at(-1)).toMatchObject({ type: "done", limited: false });
});

it("reports a real zero while keeping cabinet/practitioner scopes distinct", async () => {
  const result = await run({ encaisse: { montant_dzd: 0, seances: 0, perimetre: "cabinet" } });
  expect(result.events.find(event => event.type === "sentence")).toMatchObject({ text: expect.stringContaining("cabinet") });
  expect(result.events.at(-1)).toMatchObject({ type: "done", limited: false });
});

it.each([null, {}, { encaisse: null }, { encaisse: { montant_dzd: "garbage", seances: 0, perimetre: "cabinet" } },
  { encaisse: { montant_dzd: "9007199254740992", seances: 0, perimetre: "cabinet" } }, { encaisse: { montant_dzd: 1.5, seances: 0, perimetre: "cabinet" } },
  { encaisse: { montant_dzd: -1, seances: 0, perimetre: "cabinet" } }, { encaisse: { montant_dzd: 0, seances: 0, perimetre: "owner" } }])("does not invent zero for inaccessible/malformed cash: %j", async value => {
  const result = await run(value);
  expect(result.events.filter(event => event.type === "sentence")).toHaveLength(0);
  expect(result.events.at(-1)).toMatchObject({ type: "error" });
});
