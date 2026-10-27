/**
 * LA PROPRIÉTÉ DU MICRO — ANNULATION, DICTÉE, REPRISE.
 *
 * Trois défauts de possession que la machine à états ne pouvait pas voir :
 *  · un armement annulé pendant son attente qui rallume le détecteur après coup ;
 *  · une dictée de champ qui prend le micro pendant l'accusé du réveil ;
 *  · une suspension de dictée perdue quand le détecteur redémarre.
 *
 * Le détecteur Vosk est le SEUL simulacre : il rend un `demarrer` différé pour
 * rendre les courses déterministes. Le reste (mains-libres, machine à états,
 * porte de dictée) est le code de production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fr } from "@/i18n/fr";

const faux = vi.hoisted(() => ({
  wake: null as (() => void) | null,
  suspendre: vi.fn(),
  reprendre: vi.fn(),
  arreterDetecteur: vi.fn(),
  demarrerDetecteur: vi.fn(),
  disponible: vi.fn(),
  lireTexte: vi.fn(),
  finLecture: vi.fn(),
  demarrerDictee: vi.fn(),
}));

vi.mock("@/services/jarvis-voix", () => ({
  demarrerDictee: faux.demarrerDictee,
  arreterEtTranscrire: vi.fn(async () => ({ ok: true, data: "" })),
  annulerDictee: vi.fn(),
  arreterLecture: vi.fn(),
  abonnerLecture: () => () => {},
  lireTexte: faux.lireTexte,
  attendreFinLecture: faux.finLecture,
  detecterCapacitesVoix: () => ({ dicteePossible: false, mimeDictée: null }),
}));
vi.mock("@/services/endpointage-voix", () => ({
  creerEndpointeurEnergie: () => ({
    demarrer: () => ({ ok: true, data: true }),
    arreter: vi.fn(),
    niveau: () => 0,
  }),
}));
vi.mock("@/services/reveil-vosk", () => ({
  creerDetecteurVosk: () => ({
    nom: "fake",
    disponible: faux.disponible,
    demarrer: faux.demarrerDetecteur,
    suspendre: faux.suspendre,
    reprendre: faux.reprendre,
    arreter: faux.arreterDetecteur,
  }),
}));
vi.mock("@/services/alexa-local", () => ({
  abonnerPropositionVoixLocale: () => () => {},
  abonnerTourVoixLocale: () => () => {},
  arreterVoixLocale: () => {},
}));

import { dicteeAutorisee } from "@/components/consultation/DicteeChamp";
import {
  captureEnCours,
  desarmerReveil,
  etatVoix,
  installerDetecteur,
  reprendreDetection,
  retenirVoix,
  suspendreDetection,
} from "@/services/jarvis-reveil";
import {
  arreterMainsLibres,
  demarrerMainsLibres,
  mainsLibresActif,
} from "@/services/voix-mains-libres";

const CLE_SOUHAIT = "mindcare.voix.active";
const stockage = new Map<string, string>();
const relachements: (() => void)[] = [];

beforeEach(() => {
  stockage.clear();
  // Le seul accès navigateur du chemin testé : la préférence mémorisée.
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (cle: string) => stockage.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => {
        stockage.set(cle, valeur);
      },
      removeItem: (cle: string) => {
        stockage.delete(cle);
      },
    },
  });
  faux.wake = null;
  faux.demarrerDetecteur.mockImplementation(async (cb: () => void) => {
    faux.wake = cb;
    return { ok: true, data: true };
  });
  faux.disponible.mockResolvedValue(true);
  faux.lireTexte.mockResolvedValue({ ok: true, data: true });
  faux.finLecture.mockResolvedValue(undefined);
  faux.demarrerDictee.mockResolvedValue({ ok: true, data: true });
});

afterEach(() => {
  for (const relacher of relachements.splice(0)) relacher();
  desarmerReveil();
  installerDetecteur(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  faux.wake = null;
});

describe("un armement annulé pendant son attente", () => {
  it("ne rallume ni le détecteur ni la préférence quand le démarrage résout après l'arrêt", async () => {
    let resoudre!: (valeur: { ok: boolean; data?: boolean }) => void;
    faux.demarrerDetecteur.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resoudre = resolve;
        }),
    );

    const demarrage = demarrerMainsLibres();
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    expect(mainsLibresActif()).toBe(true);

    // L'arrêt tombe PENDANT l'attente de l'armement.
    arreterMainsLibres();
    expect(mainsLibresActif()).toBe(false);
    expect(etatVoix()).toBe("desactive");

    resoudre({ ok: true, data: true });
    const resultat = await demarrage;
    await vi.waitFor(() => expect(faux.arreterDetecteur).toHaveBeenCalled());

    expect(resultat.ok).toBe(false);
    expect(mainsLibresActif()).toBe(false);
    // Aucune transition « veille » : la voix est restée coupée.
    expect(etatVoix()).toBe("desactive");
    // Aucune préférence écrite : le prochain montage ne rouvrira pas le micro.
    expect(stockage.get(CLE_SOUHAIT)).toBeUndefined();
  });
});

describe("la suspension de dictée survit aux redémarrages", () => {
  it("réapplique la suspension au détecteur qui démarre ensuite", async () => {
    // La dictée commence avant tout armement : aucun détecteur à suspendre.
    suspendreDetection();
    expect(faux.suspendre).not.toHaveBeenCalled();

    const release = retenirVoix({ onCommande: async () => {} });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.demarrerDetecteur).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));

    expect(faux.suspendre).toHaveBeenCalledTimes(1);
    expect(faux.demarrerDetecteur.mock.invocationCallOrder[0]).toBeLessThan(
      faux.suspendre.mock.invocationCallOrder[0]!,
    );

    reprendreDetection();
    expect(faux.reprendre).toHaveBeenCalledTimes(1);
  });
});

describe("la dictée d'un champ face à l'accusé du réveil", () => {
  it("refuse la dictée pendant `reveille` et n'y rend pas le scoring", async () => {
    let terminerAccuse!: () => void;
    faux.finLecture.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          terminerAccuse = resolve;
        }),
    );
    const release = retenirVoix({ onCommande: async () => {} });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());

    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("reveille"));
    expect(captureEnCours()).toBe(true);

    const signaler = vi.fn();
    const demarrer = vi.fn();
    if (dicteeAutorisee(captureEnCours, signaler)) demarrer();
    expect(demarrer).not.toHaveBeenCalled();
    expect(signaler).toHaveBeenCalledExactlyOnceWith(fr.jarvis.voix.dejaEnCours);

    // Une dictée qui abandonne pendant l'accusé ne doit pas rendre le scoring :
    // la machine du réveil le fera à sa propre fin de tour.
    faux.reprendre.mockClear();
    reprendreDetection();
    expect(faux.reprendre).not.toHaveBeenCalled();

    terminerAccuse();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
  });
});
