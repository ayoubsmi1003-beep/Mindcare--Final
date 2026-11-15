import { describe, expect, it, vi } from "vitest";
import { validerEntreeVoix, CanalVoixNative } from "@/server/voice/protocole";
const scope = { sessionId: "a".repeat(64), runId: "00000000-0000-4000-8000-000000000001", utteranceId: "00000000-0000-4000-8000-000000000002" };
const entree = { ...scope, id: "00000000-0000-4000-8000-000000000003", action: "stt", pcmBase64: Buffer.alloc(32000).toString("base64"), sampleRate: 16000 };
describe("local voice process protocol", () => {
 it("accepts bounded mono PCM, never filenames, URLs or arbitrary commands", () => {
  expect(validerEntreeVoix(entree)).not.toBeNull();
  for (const bad of [{ ...entree, sampleRate: 48000 }, { ...entree, pcmBase64: "https://evil.test" }, { ...entree, pcmBase64: Buffer.alloc(960002).toString("base64") }, { ...entree, path: "C:/note.wav" }, { ...entree, action: "exec" }]) expect(validerEntreeVoix(bad)).toBeNull();
 });
 it("discards another utterance and validates the response before resolving", async () => {
  const write = vi.fn(); const destroy = vi.fn(); const canal = new CanalVoixNative(write, destroy);
  const result = canal.demander(entree, undefined, 100);
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: "00000000-0000-4000-8000-000000000099", ok: true, texte: "stale" });
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "bonjour" });
  expect(await result).toMatchObject({ texte: "bonjour" });
  expect(write).toHaveBeenCalledTimes(1);
 });
 it("abort keeps the resident worker: the late result is dropped and frees the slot; only a timeout kills", async () => {
  const destroy = vi.fn(); const canal = new CanalVoixNative(vi.fn(), destroy); const c = new AbortController();
  const result = canal.demander(entree, c.signal, 100); c.abort();
  await expect(result).rejects.toThrow("annulee"); expect(destroy).not.toHaveBeenCalled();
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "late" });
  await expect(canal.demander(entree, undefined, 10)).rejects.toThrow("timeout"); expect(destroy).toHaveBeenCalledTimes(1);
 });
 it("a request made while an aborted one is still running waits for it, then runs; a second waiter is refused", async () => {
  const write = vi.fn(); const canal = new CanalVoixNative(write, vi.fn()); const c = new AbortController();
  const first = canal.demander(entree, c.signal, 1000); c.abort(); await expect(first).rejects.toThrow("annulee");
  const next = { ...entree, id: "00000000-0000-4000-8000-000000000004" };
  const second = canal.demander(next, undefined, 1000);
  await expect(canal.demander({ ...entree, id: "00000000-0000-4000-8000-000000000005" }, undefined, 1000)).rejects.toThrow("occupe");
  expect(write).toHaveBeenCalledTimes(1);
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "orphan" });
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  canal.recevoir({ id: next.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "suivant" });
  expect(await second).toMatchObject({ texte: "suivant" });
 });
 it("a dead process rejects both the orphan's waiter and the current request", async () => {
  const canal = new CanalVoixNative(vi.fn(), vi.fn()); const c = new AbortController();
  const first = canal.demander(entree, c.signal, 1000); c.abort(); await expect(first).rejects.toThrow("annulee");
  const second = canal.demander({ ...entree, id: "00000000-0000-4000-8000-000000000004" }, undefined, 1000);
  canal.echouer();
  await expect(second).rejects.toThrow("runtime");
 });
 it("queues one request behind a running one (never two at once in the worker) and refuses a third", async () => {
  const write = vi.fn(); const canal = new CanalVoixNative(write, vi.fn()); const p = canal.demander(entree, undefined, 1000);
  const second = { ...entree, id: "00000000-0000-4000-8000-000000000006" };
  const q = canal.demander(second, undefined, 1000);
  await expect(canal.demander({ ...entree, id: "00000000-0000-4000-8000-000000000007" }, undefined, 20)).rejects.toThrow("occupe");
  expect(write).toHaveBeenCalledTimes(1);
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: false, code: "runtime" });
  await expect(p).rejects.toThrow("runtime");
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  canal.recevoir({ id: second.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "ensuite" });
  expect(await q).toMatchObject({ texte: "ensuite" });
 });
});
