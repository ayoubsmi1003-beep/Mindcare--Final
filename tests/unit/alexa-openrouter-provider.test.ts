import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRouterProvider } from "../../src/server/egress/external-call";
import { reinitialiserEnv } from "../../src/server/env";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  process.env.MINDCARE_DATABASE_URL = "postgresql://essai:essai@127.0.0.1:1/essai";
  process.env.OPENROUTER_API_KEY = "synthetic-key"; reinitialiserEnv();
});
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.OPENROUTER_API_KEY; reinitialiserEnv(); });
const requete = { model: "qwen/qwen3.7-flash", messages: [{ role: "user" as const, content: "Bonjour" }], timeoutMs: 100 };

function sse(text: string): Response { return new Response(text, { headers: { "Content-Type": "text/event-stream" } }); }
describe("transport OpenRouter réel, fault injection limitée à fetch", () => {
  it("n'autorise que le primary single-model et les :free explicites (maintenance), sous la même politique de confidentialité", async () => {
    const calls: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_, init) => { calls.push(JSON.parse(init!.body as string));
      return Response.json({ choices: [{ message: { content: "Bonjour" } }] }); });
    // Payants non-primary et routeurs dynamiques : refusés avant transport.
    for (const model of ["qwen/payant", "google/gemma-3-27b-it", "openrouter/auto", "openai/gpt-6-astra"])
      await expect(openRouterProvider.complete({ ...requete, model })).rejects.toMatchObject({ code: "CONFIGURATION" });
    expect(calls).toHaveLength(0);
    // Le tour ordinaire n'envoie que le primary (voir `resolveModel`) ; les
    // `:free` explicites ne servent qu'aux sondes de maintenance hors tour.
    await openRouterProvider.complete({ ...requete, model: "google/gemma-3-27b-it:free" });
    expect(calls[0]?.model).toBe("google/gemma-3-27b-it:free");
    await openRouterProvider.complete(requete);
    expect(calls[1]?.model).toBe("qwen/qwen3.7-flash");
    expect(calls[1]?.provider).toEqual({ data_collection: "deny", zdr: true, require_parameters: true, max_price: { prompt: 0.05, completion: 0.2 } });
  });
  it("reserves the bounded token budget for the structured answer rather than hidden reasoning", async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_, init) => { body = JSON.parse(init!.body as string); return Response.json({ choices: [{ message: { content: '{"intents":["HELLO"]}' } }] }); });
    await openRouterProvider.complete({ ...requete, maxOutputTokens: 512, json: true, jsonMode: true });
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.max_tokens).toBe(512);
    expect(body.provider).toEqual({ data_collection: "deny", zdr: true, require_parameters: true, max_price: { prompt: 0.05, completion: 0.2 } });
  });
  it("ne publie pas un faux succès sur EOF prématuré", async () => {
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\n')); },
      async pull(c) { await new Promise((r) => setTimeout(r, 10)); c.close(); },
    })));
    const flux = await openRouterProvider.stream(requete);
    const reader = flux.deltas.getReader();
    await expect(reader.read()).resolves.toMatchObject({ value: "Bonjour" });
    await expect(reader.read()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    await expect(flux.usage).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
  it("HTTP 429 fournisseur conserve son code, sans réémettre le message brut", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ error: { message: "private-body", metadata: { provider_name: "upstream" } } }, { status: 429 }));
    await expect(openRouterProvider.complete(requete)).rejects.toMatchObject({ code: "MODEL_RATE_LIMIT", scope: "model" });
  });
  it("erreur SSE avant texte est rejetée avant retour du flux, donc rejouable", async () => {
    globalThis.fetch = vi.fn(async () => sse('data: {"error":{"code":503,"message":"private-body"}}\n\n'));
    await expect(openRouterProvider.stream(requete)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
  it("annulation avant requête ne contacte pas le fournisseur", async () => {
    const fetch = vi.fn(async () => sse("data: [DONE]\n\n")); globalThis.fetch = fetch;
    const c = new AbortController(); c.abort();
    await expect(openRouterProvider.stream({ ...requete, signal: c.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("la fin normale expose seulement les deltas de contenu et l'usage", async () => {
    globalThis.fetch = vi.fn(async () => sse('data: {"choices":[{"delta":{"reasoning":"hidden"}}]}\n\ndata: {"choices":[{"delta":{"content":"Bonjour"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n'));
    const flux = await openRouterProvider.stream(requete);
    let text = ""; const r = flux.deltas.getReader();
    for (;;) { const v = await r.read(); if (v.done) break; text += v.value; }
    expect(text).toBe("Bonjour"); expect(await flux.usage).toEqual({ tokensIn: 3, tokensOut: 2 });
  });
  it("a timed-out qualification is a timeout, not a user cancellation", async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 5));
    await expect(openRouterProvider.stream({ ...requete, signal })).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
  });
  it("normal deltas cannot extend the total streaming deadline", async () => {
    globalThis.fetch = vi.fn(async (_, init) => new Response(new ReadableStream<Uint8Array>({
      start(c) {
        const timer = setInterval(() => c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n')), 5);
        init?.signal?.addEventListener("abort", () => { clearInterval(timer); c.error(new DOMException("aborted", "AbortError")); }, { once: true });
      },
    })));
    const flux = await openRouterProvider.stream({ ...requete, timeoutMs: 100, deadlineMs: Date.now() + 30 });
    const r = flux.deltas.getReader();
    await expect((async () => { while (!(await r.read()).done) { /* drain */ } })()).rejects.toMatchObject({ code: "MODEL_TIMEOUT" });
  });
});
