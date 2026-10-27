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
    options: [] as Array<{ patienceMs?: number; plafondMs?: number } | undefined>,
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
    demarrer: (
      fin: (motif: string) => void,
      options?: { patienceMs?: number; plafondMs?: number },
    ) => {
      faux.fin = fin;
      faux.options.push(options);
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
  interrompreVoix,
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
  faux.options.length = 0;
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
      expect(faux.options.at(-1)).toEqual({ patienceMs: 3_000, plafondMs: 15_000 });

      await cloturerCommande(undefined, "silence");
      expect(faux.transcrire).toHaveBeenCalledTimes(i + 1);
      expect(faux.commande).toHaveBeenLastCalledWith("Quel est le prochain patient ?");

      signalerParole();
      signalerFinParole();
      expect(etatVoix()).toBe("veille");

      await vi.advanceTimersByTimeAsync(250);
      expect(etatVoix()).toBe("ecoute"); // 8 s follow-up, no wake word needed
      expect(faux.options.at(-1)).toEqual({ patienceMs: 8_000, plafondMs: 15_000 });
      // The follow-up opens exactly ONE recorder — never a second concurrent one.
      expect(faux.demarrer).toHaveBeenCalledTimes(capturesAvant + 2);
      faux.fin!("faux-reveil"); // no speech in the window
      await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
    }

    expect(etats).not.toContain("erreur");
    // One acknowledgement per real wake; never on the five follow-up captures.
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

  it("does not open the command microphone before the acknowledgement finishes", async () => {
    let terminerAccuse!: () => void;
    faux.finLecture.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          terminerAccuse = resolve;
        }),
    );
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(faux.finLecture).toHaveBeenCalledTimes(1));
    expect(etatVoix()).toBe("reveille");
    expect(faux.demarrer).not.toHaveBeenCalled();

    terminerAccuse();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    expect(faux.demarrer).toHaveBeenCalledTimes(1);

    faux.fin!("faux-reveil");
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
  });

  it("abandons the follow-up when no playback starts within five seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    await cloturerCommande(undefined, "silence");

    expect(etatVoix()).toBe("veille");
    expect(faux.demarrer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(etatVoix()).toBe("veille");
    expect(faux.demarrer).toHaveBeenCalledTimes(1);

    // The doctor can say "Alexa" again: the machine was never stuck.
    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    expect(faux.demarrer).toHaveBeenCalledTimes(2);
    faux.fin!("faux-reveil");
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
  });

  it("opens the follow-up when playback starts and ends within five seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    await cloturerCommande(undefined, "silence");

    signalerParole();
    signalerFinParole();
    expect(etatVoix()).toBe("veille");

    await vi.advanceTimersByTimeAsync(250);
    expect(etatVoix()).toBe("ecoute");
    expect(faux.demarrer).toHaveBeenCalledTimes(2);
    expect(faux.options.at(-1)).toEqual({ patienceMs: 8_000, plafondMs: 15_000 });

    faux.fin!("faux-reveil");
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
  });

  it("never records a delayed auto-read as a command", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    await cloturerCommande(undefined, "silence");

    await vi.advanceTimersByTimeAsync(5_000);
    expect(etatVoix()).toBe("veille");

    // The answer's audio finally starts after the follow-up window closed.
    signalerParole();
    expect(etatVoix()).toBe("parole");
    signalerFinParole();
    expect(etatVoix()).toBe("veille");

    await vi.advanceTimersByTimeAsync(250);
    expect(etatVoix()).toBe("veille");
    expect(faux.demarrer).toHaveBeenCalledTimes(1);
  });

  it("keeps a manual stop as interrompu when the command rejects", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const etats: string[] = [];
    const stopEtats = abonnerVoix((vue) => {
      etats.push(vue.etat);
    });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release, stopEtats);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));

    let rejeter!: (cause: unknown) => void;
    faux.commande.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejeter = reject;
        }),
    );
    const fermeture = cloturerCommande(undefined, "silence");
    await vi.waitFor(() => expect(faux.commande).toHaveBeenCalledTimes(1));

    interrompreVoix();
    rejeter(new Error("arrêt manuel"));
    await fermeture;

    expect(etatVoix()).toBe("interrompu");
    expect(etats).not.toContain("erreur");
    await vi.advanceTimersByTimeAsync(800);
    expect(etatVoix()).toBe("veille");
  });

  it("keeps a disarm as desactive when the command rejects", async () => {
    const etats: string[] = [];
    const stopEtats = abonnerVoix((vue) => {
      etats.push(vue.etat);
    });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release, stopEtats);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));

    let rejeter!: (cause: unknown) => void;
    faux.commande.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejeter = reject;
        }),
    );
    const fermeture = cloturerCommande(undefined, "silence");
    await vi.waitFor(() => expect(faux.commande).toHaveBeenCalledTimes(1));

    desarmerReveil();
    rejeter(new Error("démontage"));
    await fermeture;

    expect(etatVoix()).toBe("desactive");
    expect(etats).not.toContain("erreur");
  });
});
