import { afterEach, describe, expect, it, vi } from "vitest";

const { demarrer, arreter, disponible } = vi.hoisted(() => ({
  demarrer: vi.fn().mockResolvedValue({ ok: true, data: true }),
  arreter: vi.fn(),
  disponible: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/services/reveil-vosk", () => ({
  creerDetecteurVosk: () => ({
    nom: "fake-local",
    disponible,
    demarrer,
    suspendre: vi.fn(),
    reprendre: vi.fn(),
    arreter,
  }),
}));

import { desarmerReveil, installerDetecteur, retenirVoix } from "@/services/jarvis-reveil";

afterEach(() => {
  desarmerReveil();
  installerDetecteur(null);
  vi.clearAllMocks();
});

describe("wake-word arm lifecycle", () => {
  it("re-arms immediately after an explicit stop instead of keeping a stale successful promise", async () => {
    const first = retenirVoix({ onCommande: async () => {} });
    await vi.waitFor(() => expect(demarrer).toHaveBeenCalledTimes(1));

    first();
    desarmerReveil();
    const second = retenirVoix({ onCommande: async () => {} });
    await vi.waitFor(() => expect(demarrer).toHaveBeenCalledTimes(2));

    second();
  });
});
