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
 it("abort and timeout terminate the worker and reject late callbacks", async () => {
  const destroy = vi.fn(); const canal = new CanalVoixNative(vi.fn(), destroy); const c = new AbortController();
  const result = canal.demander(entree, c.signal, 100); c.abort();
  await expect(result).rejects.toThrow("annulee"); expect(destroy).toHaveBeenCalledTimes(1);
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "late" });
  await expect(canal.demander(entree, undefined, 10)).rejects.toThrow("timeout"); expect(destroy).toHaveBeenCalledTimes(2);
 });
 it("refuses concurrent work and duplicate IDs rather than mixing sessions", async () => {
  const canal = new CanalVoixNative(vi.fn(), vi.fn()); const p = canal.demander(entree, undefined, 20);
  await expect(canal.demander({ ...entree, sessionId: "b".repeat(64) }, undefined, 20)).rejects.toThrow("occupe");
  canal.recevoir({ id: entree.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: false, code: "runtime" });
  await expect(p).rejects.toThrow("runtime");
 });
});
