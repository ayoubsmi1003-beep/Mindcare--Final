import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/server/db/withCaller", () => ({
  withCaller: vi.fn(async (_userId: string, fn: (q: unknown) => Promise<unknown>) => fn({})),
}));
vi.mock("@/server/db/pgPort", () => ({
  faireePgPort: vi.fn(() => ({ rpc })),
}));

import { iaCliniqueAutorisee } from "../../src/server/auth/ia-gate";

const ROUTES = [
  "src/app/api/alexa/qualify/route.ts",
  "src/app/api/alexa/summary/route.ts",
  "src/app/api/alexa/turn/route.ts",
  "src/app/api/jarvis/jarvis-analyze-session/route.ts",
  "src/app/api/jarvis/jarvis-chat/route.ts",
  "src/app/api/jarvis/jarvis-live/route.ts",
  "src/app/api/jarvis/jarvis-voice-in/route.ts",
  "src/app/api/jarvis/jarvis-voice-out/route.ts",
  "src/app/api/jarvis/jarvis-voice-session/route.ts",
  "src/app/api/jarvis/jarvis-wake/route.ts",
];

describe("porte IA clinique", () => {
  beforeEach(() => rpc.mockReset());

  it("autorise owner et practitioner", async () => {
    for (const role of ["owner", "practitioner"]) {
      rpc.mockResolvedValueOnce({ ok: true, data: [{ role }] });
      await expect(iaCliniqueAutorisee("11111111-1111-4111-8111-111111111111")).resolves.toBe(true);
    }
  });

  it("refuse assistant, patient et rôle inconnu", async () => {
    for (const role of ["assistant", "patient", "inconnu"]) {
      rpc.mockResolvedValueOnce({ ok: true, data: [{ role }] });
      await expect(iaCliniqueAutorisee("11111111-1111-4111-8111-111111111111")).resolves.toBe(false);
    }
  });

  it("refuse sur panne de base (fail closed)", async () => {
    rpc.mockResolvedValueOnce({ ok: false, error: { code: "indisponible" } });
    await expect(iaCliniqueAutorisee("11111111-1111-4111-8111-111111111111")).resolves.toBe(false);
    rpc.mockRejectedValueOnce(new Error("panne"));
    await expect(iaCliniqueAutorisee("11111111-1111-4111-8111-111111111111")).resolves.toBe(false);
  });

  it("chaque route d'IA appelle la porte avant son propre traitement", () => {
    for (const relatif of ROUTES) {
      const source = readFileSync(path.resolve(process.cwd(), relatif), "utf8");
      expect(source, relatif).toContain("refusIaClinique");
    }
  });
});
