import { afterEach, describe, expect, it, vi } from "vitest";

import { fr } from "@/i18n/fr";

const faux = vi.hoisted(() => {
  const abonnesLecture = new Set<(active: boolean, source: string | null) => void>();
  const state = {
    wake: null as (() => void) | null,
    fin: null as ((motif: string) => void) | null,
    demarrer: vi.fn(async () => ({ ok: true, data: true })),
    transcrire: vi.fn(async () => ({ ok: true, data: "Quel est le prochain patient ?" })),
    commande: vi.fn(async () => {}),
    suspendre: vi.fn(),
    reprendre: vi.fn(),
    annulerDictee: vi.fn(),
    lireTexte: vi.fn(
      async (): Promise<{ ok: boolean; data?: boolean; error?: { code: string; message: string } }> => ({
        ok: true,
        data: true,
      }),
    ),
    finLecture: vi.fn(async () => {}),
    enLecture: false,
    abonnesLecture,
    abonnerLecture(abonne: (active: boolean, source: string | null) => void) {
      abonnesLecture.add(abonne);
      abonne(state.enLecture, state.enLecture ? "local" : null);
      return () => {
        abonnesLecture.delete(abonne);
      };
    },
    diffuserLecture(active: boolean) {
      state.enLecture = active;
      for (const abonne of abonnesLecture) abonne(active, active ? "local" : null);
    },
    options: [] as Array<{ patienceMs?: number; plafondMs?: number } | undefined>,
    demarrerDetecteur: vi.fn(
      async (
        cb: () => void,
      ): Promise<{ ok: boolean; data?: boolean; error?: { code: string; message: string } }> => {
        state.wake = cb;
        return { ok: true, data: true };
      },
    ),
    arreterDetecteur: vi.fn(),
    erreur: null as ((code: string) => void) | null,
  };
  return state;
});

vi.mock("@/services/jarvis-voix", () => ({
  demarrerDictee: faux.demarrer,
  arreterEtTranscrire: faux.transcrire,
  annulerDictee: faux.annulerDictee,
  annulerDicteeSi: vi.fn(() => true),
  dicteeActive: () => false,
  generationDictee: () => 0,
  arreterLecture: vi.fn(),
  abonnerLecture: faux.abonnerLecture,
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
  creerDetecteurVosk: (surErreur?: (code: string) => void) => {
    faux.erreur = surErreur ?? null;
    return {
      nom: "fake",
      disponible: async () => true,
      demarrer: faux.demarrerDetecteur,
      suspendre: faux.suspendre,
      reprendre: faux.reprendre,
      arreter: faux.arreterDetecteur,
    };
  },
}));

import {
  abonnerVoix,
  cloturerCommande,
  desarmerReveil,
  detecteurInstalle,
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
  faux.erreur = null;
  faux.options.length = 0;
  faux.enLecture = false;
  faux.abonnesLecture.clear();
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

  it("cancels the previous speech wait when a new wake is already processing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    // First command: no playback, so the 5 s speech wait is armed.
    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    await cloturerCommande(undefined, "silence");
    expect(etatVoix()).toBe("veille");
    await vi.advanceTimersByTimeAsync(1_000);

    // Second wake WITHIN the old wait: the acknowledgement fails, so no
    // signalerFinParole will ever clear the first wait.
    faux.lireTexte.mockResolvedValueOnce({
      ok: false,
      error: { code: "indisponible", message: "La voix est indisponible." },
    });
    let terminerCommande!: () => void;
    faux.commande.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          terminerCommande = resolve;
        }),
    );

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    expect(faux.lireTexte).toHaveBeenCalledTimes(2);

    const fermeture = cloturerCommande(undefined, "silence");
    await vi.waitFor(() => expect(faux.commande).toHaveBeenCalledTimes(2));
    expect(etatVoix()).toBe("traitement");

    // Past the OLD 5 s deadline: the stale timer must not force `veille`.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(etatVoix()).toBe("traitement");

    terminerCommande();
    await fermeture;
    expect(etatVoix()).toBe("veille");
    expect(faux.commande).toHaveBeenLastCalledWith("Quel est le prochain patient ?");
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

  it("preserves parole and re-arms the detector when hands-free is armed during playback", async () => {
    // La praticienne arme le mains-libres pendant qu'une réponse tapée est
    // déjà en train d'être lue. L'armement ne doit ni écraser `parole` ni
    // laisser le détecteur suspendu pour toujours.
    faux.enLecture = true;
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);

    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(etatVoix()).toBe("parole"));
    expect(faux.suspendre).toHaveBeenCalled();

    faux.diffuserLecture(false);
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
    expect(faux.reprendre).toHaveBeenCalled();
  });
});

describe("detector supervision", () => {
  it("re-arms the spotter after a lost microphone without disarming the voice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    expect(etatVoix()).toBe("veille");
    faux.demarrerDetecteur.mockClear();
    faux.arreterDetecteur.mockClear();

    faux.erreur!("micro");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));

    expect(etatVoix()).toBe("veille");
    // The recovery never routes through installerDetecteur(null) or
    // desarmerReveil; it forces a fresh graph: arreter() then demarrer().
    expect(detecteurInstalle()).not.toBeNull();
    expect(faux.arreterDetecteur).toHaveBeenCalledTimes(1);
    expect(faux.arreterDetecteur.mock.invocationCallOrder[0]).toBeLessThan(
      faux.demarrerDetecteur.mock.invocationCallOrder[0]!,
    );
  });

  it("forces a real restart probe on transport failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    faux.demarrerDetecteur.mockClear();
    faux.arreterDetecteur.mockClear();

    faux.erreur!("transport");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));

    expect(faux.arreterDetecteur).toHaveBeenCalledTimes(1);
    expect(faux.arreterDetecteur.mock.invocationCallOrder[0]).toBeLessThan(
      faux.demarrerDetecteur.mock.invocationCallOrder[0]!,
    );
    expect(etatVoix()).toBe("veille");
  });

  it("surfaces an error only after four failed restarts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    faux.arreterDetecteur.mockClear();

    for (let i = 0; i < 4; i += 1) {
      faux.demarrerDetecteur.mockResolvedValueOnce({
        ok: false,
        error: { code: "interdit", message: "micro refusé" },
      });
    }
    faux.erreur!("micro");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(2));
    expect(etatVoix()).not.toBe("erreur");

    await vi.advanceTimersByTimeAsync(500 + 1_000 + 2_000);
    await vi.waitFor(() => expect(etatVoix()).toBe("erreur"));
    expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(5);
    expect(faux.arreterDetecteur).toHaveBeenCalledTimes(4);
  });

  it("shows a deferred recovery failure when playback ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const vues: boolean[] = [];
    const stopVue = abonnerVoix((vue) => vues.push(vue.reveilArme));
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release, stopVue);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    signalerParole();
    expect(etatVoix()).toBe("parole");

    for (let i = 0; i < 4; i += 1) {
      faux.demarrerDetecteur.mockResolvedValueOnce({
        ok: false,
        error: { code: "interdit", message: "micro refusé" },
      });
    }
    faux.erreur!("micro");
    await vi.advanceTimersByTimeAsync(250 + 500 + 1_000 + 2_000);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(5));
    expect(etatVoix()).toBe("parole");

    signalerFinParole();
    expect(etatVoix()).toBe("erreur");
    expect(vues.at(-1)).toBe(false);
    expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(5);
  });

  it("closes a start that resolves after the voice was disarmed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    faux.arreterDetecteur.mockClear();

    let resoudre!: (resultat: { ok: boolean; data?: boolean }) => void;
    faux.demarrerDetecteur.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resoudre = resolve;
        }),
    );
    faux.erreur!("micro");
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(2));

    desarmerReveil();
    resoudre({ ok: true, data: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(faux.arreterDetecteur).toHaveBeenCalledTimes(3));

    expect(etatVoix()).toBe("desactive");
  });

  it("surfaces a deferred recovery failure after a false wake", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const vues: Array<{ reveilArme: boolean; raison: string | null }> = [];
    const stopVue = abonnerVoix((vue) => vues.push({ reveilArme: vue.reveilArme, raison: vue.raison }));
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release, stopVue);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());
    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));

    for (let i = 0; i < 4; i += 1) {
      faux.demarrerDetecteur.mockResolvedValueOnce({
        ok: false,
        error: { code: "interdit", message: "micro refusé" },
      });
    }
    faux.erreur!("micro");
    await vi.advanceTimersByTimeAsync(250 + 500 + 1_000 + 2_000);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(5));
    expect(etatVoix()).toBe("ecoute");

    await cloturerCommande(undefined, "faux-reveil");
    expect(etatVoix()).toBe("erreur");
    expect(vues.at(-1)).toMatchObject({
      reveilArme: false,
      raison: fr.jarvis.voix.reveil.microRefuse,
    });
  });

  it("returns to veille for a normal false wake without a pending failure", async () => {
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());
    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));

    await cloturerCommande(undefined, "faux-reveil");
    expect(etatVoix()).toBe("veille");
  });

  it("does not cancel a field recorder when recovery finally fails at veille", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const release = retenirVoix({ onCommande: faux.commande });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    faux.annulerDictee.mockClear();

    for (let i = 0; i < 4; i += 1) {
      faux.demarrerDetecteur.mockResolvedValueOnce({
        ok: false,
        error: { code: "interdit", message: "micro refusé" },
      });
    }
    faux.erreur!("micro");
    await vi.advanceTimersByTimeAsync(250 + 500 + 1_000 + 2_000);
    await vi.waitFor(() => expect(etatVoix()).toBe("erreur"));

    // Le réveil n'a jamais possédé de commande : l'enregistreur du champ
    // reste au champ.
    expect(faux.annulerDictee).not.toHaveBeenCalled();
  });
});
