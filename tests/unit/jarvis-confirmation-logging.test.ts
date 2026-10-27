import { beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  rpc: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/services/db", () => ({ db: () => ({ rpc: mocked.rpc }) }));
vi.mock("@/services/log", () => ({
  log: { warn: mocked.warn, error: mocked.error, info: mocked.info },
}));

import { confirmerAction } from "@/services/jarvis-tools";

beforeEach(() => vi.clearAllMocks());

it("logs a stale or expired confirmation as a business warning, not a console error", async () => {
  mocked.rpc.mockResolvedValueOnce({
    ok: false,
    error: { code: "regle-metier", technical: "P0001", context: "http.rpc:confirm_jarvis_action", message: "refus métier" },
  });

  const result = await confirmerAction("00000000-0000-4000-8000-000000000001");

  expect(result).toMatchObject({ ok: false, error: { code: "regle-metier" } });
  expect(mocked.warn).toHaveBeenCalledWith("jarvis.action.confirmation", expect.objectContaining({ code: "regle-metier" }));
  expect(mocked.error).not.toHaveBeenCalled();
});

it("keeps logging infrastructure failures as errors", async () => {
  mocked.rpc.mockResolvedValueOnce({
    ok: false,
    error: { code: "indisponible", technical: "57P03", context: "http.rpc:confirm_jarvis_action", message: "indisponible" },
  });

  await confirmerAction("00000000-0000-4000-8000-000000000001");

  expect(mocked.error).toHaveBeenCalledWith("jarvis.action.confirmation", expect.objectContaining({ code: "indisponible" }));
  expect(mocked.warn).not.toHaveBeenCalled();
});
