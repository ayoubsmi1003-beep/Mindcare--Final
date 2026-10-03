import { afterEach, describe, expect, it, vi } from "vitest";
import { CanalVoixNative } from "@/server/voice/protocole";

const scope = { id: "00000000-0000-4000-8000-000000000001", runId: "00000000-0000-4000-8000-000000000002", utteranceId: "00000000-0000-4000-8000-000000000003", sessionId: "a".repeat(64) };
const stt = { ...scope, action: "stt", pcmBase64: Buffer.alloc(32000).toString("base64"), sampleRate: 16000 };
const answer = { id: scope.id, runId: scope.runId, utteranceId: scope.utteranceId, ok: true, texte: "synthetic contract response" };
afterEach(() => { vi.useRealTimers(); });

describe("bounded native speech operation deadlines", () => {
  it("accepts a matching STT result after one minute within a requested 90-second budget", async () => {
    vi.useFakeTimers(); const destroy = vi.fn(), write = vi.fn(), canal = new CanalVoixNative(write, destroy);
    const result = canal.demander(stt, undefined, 90_000).then(response => ({ response }), error => ({ error: error.message }));
    await vi.advanceTimersByTimeAsync(61_000);
    canal.recevoir({ ...answer, utteranceId: "00000000-0000-4000-8000-000000000099" });
    canal.recevoir(answer);
    expect(await result).toMatchObject({ response: answer });
    expect(write).toHaveBeenCalledOnce(); expect(destroy).not.toHaveBeenCalled();
  });

  it("still aborts a longer STT immediately and ignores its late result", async () => {
    vi.useFakeTimers(); const destroy = vi.fn(), canal = new CanalVoixNative(vi.fn(), destroy), controller = new AbortController();
    const result = canal.demander(stt, controller.signal, 90_000).then(() => "unexpected-success", error => error.message);
    await vi.advanceTimersByTimeAsync(61_000); controller.abort();
    expect(await result).toBe("annulee"); expect(destroy).toHaveBeenCalledOnce();
    canal.recevoir(answer);
    await expect(canal.demander(stt, controller.signal, 90_000)).rejects.toThrow("annulee");
  });

  it("enforces the 90-second ceiling even when a caller requests an unbounded wait", async () => {
    vi.useFakeTimers(); const destroy = vi.fn(), canal = new CanalVoixNative(vi.fn(), destroy);
    const result = canal.demander(stt, undefined, 900_000).then(() => "unexpected-success", error => error.message);
    await vi.advanceTimersByTimeAsync(89_999); expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe("timeout"); expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps the default TTS deadline at thirty seconds", async () => {
    vi.useFakeTimers(); const destroy = vi.fn(), canal = new CanalVoixNative(vi.fn(), destroy);
    const result = canal.demander({ ...scope, action: "tts", texte: "Bonjour.", langue: "fr" }).then(() => "unexpected-success", error => error.message);
    await vi.advanceTimersByTimeAsync(29_999); expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(await result).toBe("timeout"); expect(destroy).toHaveBeenCalledOnce();
  });
});
