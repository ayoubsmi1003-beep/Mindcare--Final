import { afterEach, describe, expect, it, vi } from "vitest";

const faux = vi.hoisted(() => {
  const state = {
    wake: null as (() => void) | null,
    fin: null as ((motif: string) => void) | null,
    demarrer: vi.fn(async () => ({ ok: true, data: true })),
    transcrire: vi.fn(async () => ({ ok: true, data: "Quel est le prochain patient ?" })),
    commande: vi.fn(async () => {}),
    suspendre: vi.fn(),
    reprendre: vi.fn(),
    lireTexte: vi.fn(async () => ({ ok: true, data: true })),
    finLecture: vi.fn(async () => {}),
    demarrerDetecteur: vi.fn(async (cb: () => void) => {
      state.wake = cb;
      return { ok: true, data: true };
    }),
    arreterDetecteur: vi.fn(),
  };
  return state;
});

vi.mock("@/services/jarvis-voix", () => ({
  demarrerDictee: faux.demarrer,
  arreterEtTranscrire: faux.transcrire,
  annulerDictee: vi.fn(),
  arreterLecture: vi.fn(),
  abonnerLecture: () => () => {},
  lireTexte: faux.lireTexte,
  attendreFinLecture: faux.finLecture,
}));
vi.mock("@/services/endpointage-voix", () => ({
  creerEndpointeurEnergie: () => ({
    demarrer: (fin: (motif: string) => void) => {
      faux.fin = fin;
      return { ok: true, data: true };
    },
    arreter: vi.fn(),
    niveau: () => 0,
  }),
}));
vi.mock("@/services/reveil-vosk", () => ({
  creerDetecteurVosk: () => ({
    nom: "fake",
    disponible: async () => true,
    demarrer: faux.demarrerDetecteur,
    suspendre: faux.suspendre,
    reprendre: faux.reprendre,
    arreter: faux.arreterDetecteur,
  }),
}));

import {
  abonnerVoix,
  cloturerCommande,
  desarmerReveil,
  etatVoix,
  installerDetecteur,
  retenirVoix,
  signalerFinParole,
  signalerParole,
} from "@/services/jarvis-reveil";

const relachements: (() => void)[] = [];

afterEach(() => {
  for (const relacher of relachements.splice(0)) relacher();
  desarmerReveil();
  installerDetecteur(null);
  faux.wake = null;
  faux.fin = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("mains-libres serialized cycle", () => {
  it("survives five wake → answer → follow-up cycles with the acknowledgement before capture", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const etats: string[] = [];
    const stopEtats = abonnerVoix((vue) => {
      etats.push(vue.etat);
    });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release, stopEtats);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    for (let i = 0; i < 5; i++) {
      // Each cycle opens one wake capture, then one 8-second follow-up capture.
      const capturesAvant = i * 2;
      faux.wake!();
      await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
      expect(faux.demarrer).toHaveBeenCalledTimes(capturesAvant + 1);

      await cloturerCommande(undefined, "silence");
      expect(faux.transcrire).toHaveBeenCalledTimes(i + 1);
      expect(faux.commande).toHaveBeenLastCalledWith("Quel est le prochain patient ?");

      signalerParole();
      signalerFinParole();
      expect(etatVoix()).toBe("veille");

      await vi.advanceTimersByTimeAsync(250);
      expect(etatVoix()).toBe("ecoute"); // 8 s follow-up, no wake word needed
      // The follow-up opens exactly ONE recorder — never a second concurrent one.
      expect(faux.demarrer).toHaveBeenCalledTimes(capturesAvant + 2);
      faux.fin!("faux-reveil"); // no speech in the window
      await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
    }

    expect(etats).not.toContain("erreur");
    // One acknowledgement per real wake; never on the eight follow-up captures.
    expect(faux.lireTexte).toHaveBeenCalledTimes(5);
    expect(faux.lireTexte).toHaveBeenCalledWith("Oui docteur, je vous écoute.");
    expect(faux.finLecture).toHaveBeenCalledTimes(5);
    // The acknowledgement precedes the first command capture: never recorded.
    expect(faux.lireTexte.mock.invocationCallOrder[0]).toBeLessThan(
      faux.demarrer.mock.invocationCallOrder[0]!,
    );
    expect(faux.suspendre.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(faux.reprendre.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it("ignores signalerParole while the command microphone is open", async () => {
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));

    signalerParole();
    expect(etatVoix()).toBe("ecoute");
    expect(faux.demarrer).toHaveBeenCalledTimes(1);

    faux.fin!("faux-reveil");
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
    expect(faux.demarrer).toHaveBeenCalledTimes(1);
  });

  it("re-arms after the 1.5 s grace instead of reusing a resolved arm promise", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = retenirVoix({ onCommande: faux.commande });
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));

    first();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(etatVoix()).toBe("desactive");

    const second = retenirVoix({ onCommande: faux.commande });
    relachements.push(second);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(2));
    expect(etatVoix()).toBe("veille");
  });
});
