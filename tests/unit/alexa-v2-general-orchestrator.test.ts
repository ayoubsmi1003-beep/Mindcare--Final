import { describe, expect, it, vi } from "vitest";
import { runAlexa, type OrchestratorDependencies } from "@/server/alexa/orchestrator";
import type { AlexaEvent, TurnInput } from "@/shared/alexa/turn";
import { conversationState } from "@/server/alexa/conversation-state";

function setup() {
  const rpc = vi.fn(async () => { throw new Error("general questions cannot read local data"); });
  const general = vi.fn(async (_text: string) => ({ ok: true as const, text: "La lumière solaire contient plusieurs couleurs.", model: "qualified:free" }));
  const deps = { actor: "general-orchestrator", db: { rpc }, knowledge: { rpc }, general } as unknown as OrchestratorDependencies;
  const input: TurnInput = { text: "Pourquoi le ciel est bleu ?", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID(),
    appContext: { patientId: "a1000000-0000-4000-8000-000000001012", page: "/patients/a1000000-0000-4000-8000-000000001012" } };
  const events: AlexaEvent[] = [];
  const controller = new AbortController();
  return { rpc, general, deps, input, events, controller,
    run: () => runAlexa(input, deps, event => events.push(event), controller.signal) };
}
describe("public model answers never inherit a dossier", () => {
  it("passes only the current public question and preserves the UI patient without reading it", async () => {
    const s = setup(); await s.run();
    expect(s.general).toHaveBeenCalledTimes(1);
    expect(s.general.mock.calls[0]?.[0]).toBe(s.input.text);
    expect(s.rpc).not.toHaveBeenCalled();
    expect(s.events).toContainEqual({ type: "sentence", text: "La lumière solaire contient plusieurs couleurs.", kind: "inference", sources: [] });
    expect(s.events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "preserve", limited: false });
  });
  it("keeps an explicit patientName local even when the text looks public", async () => {
    const s = setup(); s.input.patientName = "Mohamed Belkacem"; await s.run();
    expect(s.general).not.toHaveBeenCalled(); expect(s.rpc).not.toHaveBeenCalled();
    expect(s.events.at(-1)).toMatchObject({ type: "done", patientId: null, patientScope: "replace", limited: true });
  });
  it("answers two independent public questions once each, with one final completion", async () => {
    const s = setup(); s.input.text = "Pourquoi le ciel est bleu ? Combien font sept fois huit ?"; await s.run();
    expect(s.general).toHaveBeenCalledTimes(2); expect(s.rpc).not.toHaveBeenCalled();
    expect(s.events.filter(event => event.type === "done")).toHaveLength(1);
    expect(s.events.filter(event => event.type === "sentence" && event.kind === "inference")).toHaveLength(2);
  });
  it("reports a provider failure honestly without claiming to read recorded facts", async () => {
    const s = setup(); s.general.mockResolvedValue({ ok: false, code: "unavailable", localFallback: true } as never); await s.run();
    const text = s.events.filter(event => event.type === "sentence").map(event => event.text).join(" ");
    expect(text).toMatch(/générale.*indisponible/); expect(text).not.toMatch(/faits structurés enregistrés/);
    expect(s.rpc).not.toHaveBeenCalled(); expect(s.events.at(-1)).toMatchObject({ type: "done", limited: true });
  });
  it("publishes no late model response after a concurrent scope change", async () => {
    const s = setup(); s.general.mockImplementation(async () => { conversationState.clear(s.deps.actor, s.input.conversationId); return { ok: true, text: "Late model response", model: "qualified:free" }; });
    await s.run();
    expect(s.events.some(event => event.type === "sentence" && event.kind === "inference")).toBe(false);
    expect(s.events.at(-1)).toMatchObject({ type: "error", code: "stale" });
  });
  it("a rejected four-question turn invalidates an older pending answer", async () => {
    const s = setup();
    let release!: (value: {ok: true; text: string; model: string}) => void;
    s.general.mockImplementation(async () => new Promise(resolve => { release = resolve; }));
    const pending = s.run();
    const newer: AlexaEvent[] = [];
    await runAlexa({...s.input, clientTurnId: crypto.randomUUID(), text: "Bonjour ? Merci ? Tu es là ? Que peux-tu faire ?"}, s.deps, event => newer.push(event), s.controller.signal);
    release({ok:true, text:"Late public answer", model:"qualified:free"}); await pending;
    expect(newer.at(-1)).toMatchObject({type:"done",limited:true});
    expect(s.events.some(event=>event.type==='sentence' && event.kind==='inference')).toBe(false);
    expect(s.events.at(-1)).toMatchObject({type:'error',code:'stale'});
  });
  it("does not answer a cancelled over-limit request", async () => {
    const s = setup(); s.input.text = "Bonjour ? Merci ? Tu es là ? Que peux-tu faire ?"; s.controller.abort(); await s.run();
    expect(s.events.some(event=>event.type==='sentence')).toBe(false);
    expect(s.events.at(-1)).toMatchObject({type:'error',code:'cancelled'});
  });
});
