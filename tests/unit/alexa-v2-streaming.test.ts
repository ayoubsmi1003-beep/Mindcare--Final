import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/server/egress/external-call", () => ({ llm: vi.fn(), llmStream: vi.fn(), preparerPoolModelesGratuits: vi.fn() }));
import { llm, llmStream } from "@/server/egress/external-call";
import { inferAlexa } from "@/server/alexa/model-gateway";
import { createSafeClinicalPayload } from "@/server/alexa/privacy-boundary";
import type { AlexaAnswer } from "@/server/alexa/response-validator";

beforeEach(() => vi.clearAllMocks());
function payload(count = 2) {
  const safe = createSafeClinicalPayload({ patientId: "11111111-1111-4111-8111-111111111111",
    consultations: Array.from({ length: count }, (_, i) => ({ id: `local-${i}`, startedAt: "2026-01-01T00:00:00Z", notes: [] })),
    treatments: [], coverage: { requested: count, complete: true } }, "Compare les consultations", []);
  if (!safe.ok) throw new Error("fixture projection refused");
  return safe.payload;
}
const object = (ref: string, text = "recorded fact") => JSON.stringify({ text, evidence: [ref], kind: "fact" });
function provider(chunks: string[], safe: ReturnType<typeof payload>, cancel = vi.fn()) {
  vi.mocked(llm).mockResolvedValue({ ok: true, data: `{"sentences":[${object(safe.facts[0]!.evidence)}]}` });
  vi.mocked(llmStream).mockResolvedValue({ ok: true, data: {
    deltas: new ReadableStream<string>({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); }, cancel }),
    usage: Promise.resolve({ tokensIn: null, tokensOut: null }),
  } });
}

it("publishes a trusted fact before EOF, never model prose, and suppresses duplicate references", async () => {
  const safe = payload(), accepted: AlexaAnswer["sentences"] = [];
  let controller!: ReadableStreamDefaultController<string>;
  vi.mocked(llm).mockResolvedValue({ ok: true, data: `{"sentences":[${object(safe.facts[0]!.evidence)}]}` });
  vi.mocked(llmStream).mockResolvedValue({ ok: true, data: { deltas: new ReadableStream<string>({ start(value) { controller = value; } }), usage: Promise.resolve({ tokensIn: null, tokensOut: null }) } });
  let finished = false;
  const run = inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } }).then(result => { finished = true; return result; });
  await vi.waitFor(() => expect(llmStream).toHaveBeenCalledOnce());
  controller.enqueue(`{"sentences":[${object(safe.facts[0]!.evidence, "Model prose with escaped } \\\" delimiters")}`);
  await vi.waitFor(() => expect(accepted).toHaveLength(1));
  expect(finished).toBe(false);
  expect(accepted[0]!.text).not.toContain("Model prose");
  expect(accepted[0]!.text).not.toContain("e-");
  controller.enqueue(`,${object(safe.facts[0]!.evidence)},${object(safe.facts[1]!.evidence)}]}`); controller.close();
  expect(await run).toMatchObject({ ok: true });
  expect(accepted).toHaveLength(2);
  expect(llm).not.toHaveBeenCalled();
});

it("handles a complete sentence split at every character boundary", async () => {
  const safe = payload(1), accepted: AlexaAnswer["sentences"] = [];
  provider([...` { "sentences" : [ ${object(safe.facts[0]!.evidence)} ] } `], safe);
  expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } })).toMatchObject({ ok: true });
  expect(accepted).toHaveLength(1);
});

it.each(["", ",", "]} garbage", "] , \"extra\":true}"])("refuses a malformed or truncated tail after a committed fact: %s", async tail => {
  const safe = payload(), accepted: AlexaAnswer["sentences"] = [];
  provider([`{"sentences":[${object(safe.facts[0]!.evidence)}`, tail], safe);
  expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } })).toMatchObject({ ok: false, code: "invalid-response", partial: true });
  expect(accepted).toHaveLength(1);
  expect(llmStream).toHaveBeenCalledOnce();
});

it.each([
  (ref: string) => object("e-unknownreference"),
  (ref: string) => object(ref, "Patient 11111111-1111-4111-8111-111111111111"),
  (ref: string) => JSON.stringify({ text: "fact", evidence: [ref], kind: "inference" }),
  (ref: string) => JSON.stringify({ text: "fact", evidence: [ref], kind: "fact", command: "change scope" }),
])( "refuses an untrusted complete sentence before publication", async make => {
  const safe = payload(), accepted: AlexaAnswer["sentences"] = [];
  provider([`{"sentences":[${make(safe.facts[0]!.evidence)}]}`], safe);
  expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } })).toMatchObject({ ok: false, code: "invalid-response" });
  expect(accepted).toHaveLength(0);
});

it("refuses a thirteenth distinct reference and an oversized remainder", async () => {
  for (const oversized of [false, true]) {
    const safe = payload(13), accepted: AlexaAnswer["sentences"] = [];
    const chunks = [`{"sentences":[${object(safe.facts[0]!.evidence)}`,
      ...(oversized ? [" ".repeat(40001)] : safe.facts.slice(1).map(fact => `,${object(fact.evidence)}`)), "]}"];
    provider(chunks, safe);
    expect(await inferAlexa(safe, { onSentence: async sentence => { accepted.push(sentence); } })).toMatchObject({ ok: false, code: "invalid-response", partial: true });
    expect(accepted).toHaveLength(oversized ? 1 : 12);
  }
});

it("cancels a pending read promptly and cancels the stream", async () => {
  const safe = payload(), controller = new AbortController(), cancel = vi.fn();
  vi.mocked(llmStream).mockResolvedValue({ ok: true, data: { deltas: new ReadableStream<string>({ cancel }), usage: new Promise(() => {}) } });
  vi.mocked(llm).mockResolvedValue({ ok: true, data: `{"sentences":[${object(safe.facts[0]!.evidence)}]}` });
  const run = inferAlexa(safe, { signal: controller.signal, onSentence: async () => {} });
  await vi.waitFor(() => expect(llmStream).toHaveBeenCalledOnce());
  controller.abort();
  expect(await run).toMatchObject({ ok: false, code: "cancelled" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("can cancel after EOF while provider usage is still pending", async () => {
  const safe = payload(1), controller = new AbortController();
  vi.mocked(llmStream).mockResolvedValue({ ok: true, data: {
    deltas: new ReadableStream<string>({ start(stream) { stream.enqueue(`{"sentences":[${object(safe.facts[0]!.evidence)}]}`); stream.close(); } }),
    usage: new Promise(() => {}),
  } });
  let published = false;
  const run = inferAlexa(safe, { signal: controller.signal, onSentence: async () => { published = true; } });
  await vi.waitFor(() => expect(published).toBe(true));
  controller.abort();
  expect(await run).toMatchObject({ ok: false, code: "cancelled", partial: true });
});
