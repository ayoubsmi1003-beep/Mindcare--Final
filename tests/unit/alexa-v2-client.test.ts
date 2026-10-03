import { afterEach, expect, it, vi } from "vitest";
import { adoptAlexaConversation, clearAlexaConversation, envoyerTourAlexa, ensureAlexaConversation, AlexaTurnError } from "@/services/alexa-turn";
import { definirPatientActif, effacerPatientActif } from "@/services/patient-actif";

vi.mock("@/services/db", async () => {
  const { httpDbPort } = await import("@/services/db/http");
  return { db: () => ({ rpc: async () => ({ ok: true, data: ["local-conversation"] }), invokeFunctionStream: httpDbPort.invokeFunctionStream }) };
});
afterEach(() => { effacerPatientActif(); clearAlexaConversation(); vi.unstubAllGlobals(); });

function transport(bodies: Record<string, unknown>[]) {
  vi.stubGlobal("window", { location: { pathname: "/jarvis" } });
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    const context = body.appContext as { patientId: string | null };
    return new Response(`data: ${JSON.stringify({ type: "sentence", text: "Réponse locale.", kind: "fact", sources: [] })}\n\ndata: ${JSON.stringify({ type: "done", patientId: context.patientId, limited: true, persiste: true })}\n\n`);
  });
}

it("clears patient A after active dossier becomes null on the same page", async () => {
  const bodies: Record<string, unknown>[] = []; transport(bodies);
  definirPatientActif({ id: "a", nom: "synthetic", numero: "test" });
  await envoyerTourAlexa("résumé");
  effacerPatientActif();
  await envoyerTourAlexa("et le traitement ?");
  expect(bodies.map(body => (body.appContext as { patientId: string | null }).patientId)).toEqual(["a", null]);
});

it("uses the existing proposal conversation for clinical reads", async () => {
  const bodies: Record<string, unknown>[] = []; transport(bodies);
  adoptAlexaConversation("proposal-conversation");
  expect(await ensureAlexaConversation()).toBe("proposal-conversation");
  await envoyerTourAlexa("résumé");
  expect(bodies[0]?.conversationId).toBe("proposal-conversation");
});

it("does not treat a severed SSE stream as a complete answer", async () => {
  vi.stubGlobal("fetch", async () => new Response('data: {"type":"sentence","text":"Partiel","sources":[]}\n\n'));
  await expect(envoyerTourAlexa("résumé")).rejects.toThrow();
});

it("marks an interrupted validated stream as partial instead of completing it", async () => {
  vi.stubGlobal("fetch", async () => new Response('data: {"type":"sentence","text":"Fait enregistré","sources":[]}\n\ndata: {"type":"error","code":"unavailable","message":"Réponse partielle","partial":true}\n\n'));
  const sentences: string[] = [];
  const result = envoyerTourAlexa("résumé", undefined, { onSentence: text => sentences.push(text) });
  await expect(result).rejects.toBeInstanceOf(AlexaTurnError);
  await expect(result).rejects.toMatchObject({ partial: true, message: "Réponse partielle" });
  expect(sentences).toEqual(["Fait enregistré"]);
});

it("discards a pending stream chunk when the active dossier changes", async () => {
  vi.stubGlobal("window", { location: { pathname: "/jarvis" } });
  definirPatientActif({ id: "a", nom: "synthetic", numero: "test" });
  let deliver!: (value: Uint8Array) => void;
  let opened!: () => void;
  const ready = new Promise<void>(resolve => { opened = resolve; });
  vi.stubGlobal("fetch", async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { deliver = value => controller.enqueue(value); },
    pull() { opened(); },
  }, { highWaterMark: 0 })));
  const sentences: string[] = [];
  const result = envoyerTourAlexa("résumé", undefined, { onSentence: text => sentences.push(text) });
  const rejected = expect(result).rejects.toThrow();
  await ready;
  effacerPatientActif();
  deliver(new TextEncoder().encode('data: {"type":"sentence","text":"Ancien dossier","sources":[]}\n\n'));
  await rejected;
  expect(sentences).toEqual([]);
});

it.each(["b", null])("keeps an explicit resolved scope %s for the follow-up while the open page still shows A", async resolved => {
  vi.stubGlobal("window", { location: { pathname: "/jarvis" } });
  definirPatientActif({ id: "a", nom: "synthetic", numero: "test" });
  const patients: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); patients.push(body.appContext.patientId);
    return new Response(`data: ${JSON.stringify({ type: "done", patientId: resolved, limited: true })}\n\n`);
  });
  await envoyerTourAlexa("résumé de Synthetic B");
  await envoyerTourAlexa("et avant ?");
  expect(patients).toEqual(["a", resolved]);
});

it.each(["a", "b"])("a nonclinical turn preserves verified scope %s without attributing its answer to that patient", async selected => {
  vi.stubGlobal("window", { location: { pathname: "/patients/a" } });
  definirPatientActif({ id: "a", nom: "synthetic", numero: "test" });
  const patients: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); patients.push(body.appContext.patientId);
    const global = patients.length === 2;
    return new Response(`data: ${JSON.stringify({ type: "done", patientId: global ? null : selected,
      patientScope: global ? "preserve" : "replace", limited: true })}\n\n`);
  });
  await envoyerTourAlexa("traitement de Synthetic B");
  const cash = await envoyerTourAlexa("Recette du jour");
  expect(cash.patientId).toBeNull();
  await envoyerTourAlexa("Le traitement actuel");
  expect(patients).toEqual(["a", selected, selected]);
});

it("an unresolved explicit patient clears the scope even after a nonclinical turn", async () => {
  vi.stubGlobal("window", { location: { pathname: "/patients/a" } });
  definirPatientActif({ id: "a", nom: "synthetic", numero: "test" });
  const patients: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); patients.push(body.appContext.patientId);
    const preserve = patients.length === 1;
    return new Response(`data: ${JSON.stringify({ type: "done", patientId: null,
      patientScope: preserve ? "preserve" : "replace", limited: true })}\n\n`);
  });
  await envoyerTourAlexa("Recette du jour");
  await envoyerTourAlexa("traitement de Synthetic Unknown");
  await envoyerTourAlexa("Et le traitement ?");
  expect(patients).toEqual(["a", "a", null]);
});

it("does not commit a new patient scope if cancellation follows done before stream completion", async () => {
  vi.stubGlobal("window", { location: { pathname: "/patients/a" } });
  definirPatientActif({ id: "a", nom: "synthetic", numero: "test" });
  const controller = new AbortController(), patients: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); patients.push(body.appContext.patientId);
    const first = patients.length === 1;
    return new Response(`data: ${JSON.stringify({ type: "done", patientId: first ? "b" : "a", patientScope: "replace", limited: true })}\n\n${first ? 'data: {"type":"stage","stage":"validation"}\n\n' : ""}`);
  });
  await expect(envoyerTourAlexa("résumé de Synthetic B", controller.signal, { onStage: () => controller.abort() })).rejects.toThrow();
  await envoyerTourAlexa("et le traitement ?");
  expect(patients).toEqual(["a", "a"]);
});
