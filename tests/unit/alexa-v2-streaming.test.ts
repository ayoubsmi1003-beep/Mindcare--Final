import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/server/alexa/local-model", () => ({ inferLocalText: vi.fn() }));
import { inferLocalText } from "@/server/alexa/local-model";
import { inferAlexa } from "@/server/alexa/model-gateway";
import { createSafeClinicalPayload } from "@/server/alexa/privacy-boundary";
import type { AlexaAnswer } from "@/server/alexa/response-validator";

beforeEach(() => vi.clearAllMocks());
function payload(count = 2) {
  const safe = createSafeClinicalPayload({ patientId: "11111111-1111-4111-8111-111111111111",
    consultations: Array.from({ length: count }, (_, i) => ({ id: "local-" + i, startedAt: "2026-01-01T00:00:00Z", notes: [] })),
    treatments: [], coverage: { requested: count, complete: true } }, "Compare les consultations", []);
  if (!safe.ok) throw new Error("fixture projection refused");
  return safe.payload;
}
const object = (ref: string, text = "recorded fact") => JSON.stringify({ text, evidence: [ref], kind: "fact" });
function provider(chunks: string[]) { vi.mocked(inferLocalText).mockResolvedValue(chunks.join("")); }

it("buffers the complete local answer, publishes only trusted facts and suppresses duplicate references", async () => {
  const safe = payload(), accepted: AlexaAnswer["sentences"] = [];
  let release!: (value: string) => void;
  vi.mocked(inferLocalText).mockReturnValue(new Promise(resolve => { release = resolve; }));
  const run = inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } });
  await vi.waitFor(() => expect(inferLocalText).toHaveBeenCalledOnce());
  expect(accepted).toHaveLength(0);
  release('{"sentences":[' + object(safe.facts[0]!.evidence, "Model prose with escaped } delimiters")
    + "," + object(safe.facts[0]!.evidence) + "," + object(safe.facts[1]!.evidence) + "]}");
  expect(await run).toMatchObject({ ok: true });
  expect(accepted).toHaveLength(2);
  expect(accepted[0]!.text).not.toContain("Model prose");
  expect(accepted[0]!.text).not.toContain("e-");
});
it("validates a complete response with spaced JSON fields", async () => {
  const safe = payload(1), accepted: AlexaAnswer["sentences"] = [];
  provider([' { "sentences" : [ ' + object(safe.facts[0]!.evidence) + " ] } "]);
  expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } })).toMatchObject({ ok: true });
  expect(accepted).toHaveLength(1);
});
it.each(["", ",", "]} garbage", '] , "extra":true}'])("refuses an invalid tail after a trusted fact: %s", async tail => {
  const safe = payload(), accepted: AlexaAnswer["sentences"] = [];
  provider(['{"sentences":[' + object(safe.facts[0]!.evidence), tail]);
  expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } }))
    .toMatchObject({ ok: false, code: "invalid-response", partial: true });
  expect(accepted).toHaveLength(1);
});
it.each([
  (ref: string) => object("e-unknownreference"),
  (ref: string) => object(ref, "Patient 11111111-1111-4111-8111-111111111111"),
  (ref: string) => JSON.stringify({ text: "fact", evidence: [ref], kind: "inference" }),
  (ref: string) => JSON.stringify({ text: "fact", evidence: [ref], kind: "fact", command: "change scope" }),
])("refuses an untrusted sentence before publication", async make => {
  const safe = payload(), accepted: AlexaAnswer["sentences"] = [];
  provider(['{"sentences":[' + make(safe.facts[0]!.evidence) + "]}"]);
  expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } }))
    .toMatchObject({ ok: false, code: "invalid-response" });
  expect(accepted).toHaveLength(0);
});
it("refuses a thirteenth reference and an oversized remainder", async () => {
  for (const oversized of [false, true]) {
    const safe = payload(13), accepted: AlexaAnswer["sentences"] = [];
    provider(['{"sentences":[' + object(safe.facts[0]!.evidence),
      ...(oversized ? [" ".repeat(40001)] : safe.facts.slice(1).map(fact => "," + object(fact.evidence))), "]}"]);
    expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } }))
      .toMatchObject({ ok: false, code: "invalid-response", ...(oversized ? {} : { partial: true }) });
    expect(accepted).toHaveLength(oversized ? 0 : 12);
  }
});
it("propagates cancellation to pending local inference without publication", async () => {
  const safe = payload(), controller = new AbortController(), accepted: string[] = [];
  vi.mocked(inferLocalText).mockImplementation((_messages, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("LocalModelCancelled")), { once: true });
  }));
  const run = inferAlexa(safe, { signal: controller.signal, onSentence: async sentence => { accepted.push(sentence.text); } });
  await vi.waitFor(() => expect(inferLocalText).toHaveBeenCalledOnce());
  controller.abort();
  expect(await run).toMatchObject({ ok: false, code: "cancelled" });
  expect(accepted).toHaveLength(0);
});
it("cancels during publication and reports the already published fact as partial", async () => {
  const safe = payload(1), controller = new AbortController();
  provider(['{"sentences":[' + object(safe.facts[0]!.evidence) + "]}"]);
  let published = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const run = inferAlexa(safe, { signal: controller.signal, onSentence: async () => { published = true; await barrier; } });
  await vi.waitFor(() => expect(published).toBe(true));
  controller.abort(); release();
  expect(await run).toMatchObject({ ok: false, code: "cancelled", partial: true });
});
