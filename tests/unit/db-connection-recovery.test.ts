import { expect, it, vi } from "vitest";
import { acquireConnection } from "@/server/db/connection-recovery";
it("recovers a cold connection once before any transaction work", async () => {
  const client = { query: vi.fn() };
  const connect = vi.fn().mockRejectedValueOnce(new Error("Connection terminated due to connection timeout")).mockResolvedValueOnce(client);
  expect(await acquireConnection(connect)).toBe(client);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(client.query).not.toHaveBeenCalled();
});
it("stops after the second connection failure", async () => {
  const connect = vi.fn().mockRejectedValue(Object.assign(new Error("synthetic"), { code: "ECONNREFUSED" }));
  await expect(acquireConnection(connect)).rejects.toThrow("synthetic");
  expect(connect).toHaveBeenCalledTimes(2);
});
it("does not retry permission or unknown failures", async () => {
  for (const cause of [Object.assign(new Error("synthetic"), { code: "42501" }), new Error("unknown")]) {
    const connect = vi.fn().mockRejectedValue(cause);
    await expect(acquireConnection(connect)).rejects.toBe(cause);
    expect(connect).toHaveBeenCalledOnce();
  }
});
