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
  annulerDictee: vi.fn(),
  micro: vi.fn(),
}));

vi.mock("@/services/micro-partage", () => ({ prendreMicro: faux.micro }));
vi.mock("@/services/jarvis-voix", () => ({
  demarrerDictee: faux.demarrerDictee,
  arreterEtTranscrire: vi.fn(async () => ({ ok: true, data: "" })),
  annulerDictee: faux.annulerDictee,
  annulerDicteeSi: vi.fn(() => true),
  dicteeActive: () => false,
  arreterLecture: vi.fn(),
  abonnerLecture: () => () => {},
  lireTexte: faux.lireTexte,
  attendreFinLecture: faux.finLecture,
  detecterCapacitesVoix: () => ({ dicteePossible: false, mimeDictée: null }),
  generationDictee: () => 0,
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

import { dicteeAutorisee, doitAnnulerDictee, doitArreterDictee } from "@/components/consultation/DicteeChamp";
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

describe("la décision d'annulation au démontage", () => {
  it("annule un démarrage encore en vol quand SON jeton est encore le courant", () => {
    // Le démarrage part : sans annulation, il ouvrirait le micro APRÈS le
    // démontage, sans plus aucun propriétaire pour le refermer.
    expect(
      doitAnnulerDictee({
        aDemarre: true,
        genDemarrage: 7,
        aEnregistre: false,
        gen: 0,
        courant: 7,
      }),
    ).toBe(true);
  });

  it("n'annule pas un démarrage en vol qu'un propriétaire plus récent a remplacé", () => {
    // Une capture du réveil a pris le jeton : le démontage du champ ne doit
    // pas fermer l'enregistreur qui ne lui appartient plus.
    expect(
      doitAnnulerDictee({
        aDemarre: true,
        genDemarrage: 7,
        aEnregistre: false,
        gen: 0,
        courant: 8,
      }),
    ).toBe(false);
  });

  it("n'annule un enregistreur que si CE crochet en est encore propriétaire", () => {
    // Même jeton : la dictée possède toujours le recorder.
    expect(
      doitAnnulerDictee({
        aDemarre: false,
        genDemarrage: 0,
        aEnregistre: true,
        gen: 4,
        courant: 4,
      }),
    ).toBe(true);
    // Un arrêt ou un abandon externe a changé le jeton : le recorder ne lui
    // appartient plus, il peut être une capture du réveil.
    expect(
      doitAnnulerDictee({
        aDemarre: false,
        genDemarrage: 0,
        aEnregistre: true,
        gen: 4,
        courant: 5,
      }),
    ).toBe(false);
    expect(
      doitAnnulerDictee({
        aDemarre: false,
        genDemarrage: 0,
        aEnregistre: false,
        gen: 4,
        courant: 5,
      }),
    ).toBe(false);
  });

  it("n'arrête pas la dictée d'un champ quand un enregistreur plus récent a pris la main", () => {
    expect(doitArreterDictee({ aEnregistre: true, gen: 4, courant: 4 })).toBe(true);
    expect(doitArreterDictee({ aEnregistre: true, gen: 4, courant: 5 })).toBe(false);
    expect(doitArreterDictee({ aEnregistre: false, gen: 4, courant: 4 })).toBe(false);
  });
});

describe("un désarmement ne coupe jamais la dictée d'un champ", () => {
  it("laisse l'enregistreur de champ vivant quand la voix est en veille", async () => {
    const release = retenirVoix({ onCommande: async () => {} });
    relachements.push(release);
    await vi.waitFor(() => expect(etatVoix()).toBe("veille"));
    faux.annulerDictee.mockClear();

    arreterMainsLibres();

    expect(etatVoix()).toBe("desactive");
    expect(faux.annulerDictee).not.toHaveBeenCalled();
  });

  it("coupe la capture de commande quand le réveil possède réellement le micro", async () => {
    const release = retenirVoix({ onCommande: async () => {} });
    relachements.push(release);
    await vi.waitFor(() => expect(faux.wake).not.toBeNull());
    faux.wake!();
    await vi.waitFor(() => expect(etatVoix()).toBe("ecoute"));
    faux.annulerDictee.mockClear();

    arreterMainsLibres();

    expect(faux.annulerDictee).toHaveBeenCalledOnce();
  });
});

describe("un démarrage annulé pendant l'acquisition du micro", () => {
  it("n'ouvre aucun enregistreur et ne possède aucune dictée", async () => {
    // Le code RÉEL de `jarvis-voix`, avec le seul courtier micro simulé :
    // l'annulation doit périmer le jeton avant que le recorder ne s'ouvre.
    const reel = await vi.importActual<typeof import("@/services/jarvis-voix")>(
      "@/services/jarvis-voix",
    );

    class FauxEnregistreur {
      static instances: FauxEnregistreur[] = [];
      readonly mimeType = "audio/webm";
      ondataavailable: ((evenement: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(readonly flux: unknown) {
        FauxEnregistreur.instances.push(this);
      }
      start(): void {}
      stop(): void {
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FauxEnregistreur);
    reel.annulerDictee(); // état propre, comme un écran neuf

    let livrer!: (valeur: unknown) => void;
    const acces = { flux: { piste: "fausse" }, rendre: vi.fn() };
    faux.micro.mockImplementation(
      () =>
        new Promise((resolve) => {
          livrer = resolve;
        }),
    );

    const avant = reel.generationDictee();
    const demarrage = reel.demarrerDictee();
    expect(reel.generationDictee()).toBe(avant + 1);

    // Le crochet est démonté pendant `prendreMicro` : `annulerDictee()` change
    // le jeton, donc la continuation doit abandonner avant `new MediaRecorder`.
    reel.annulerDictee();
    expect(reel.generationDictee()).toBe(avant + 2);

    livrer({ ok: true, data: acces });
    const resultat = await demarrage;

    expect(resultat.ok).toBe(false);
    expect(FauxEnregistreur.instances).toHaveLength(0);
    expect(acces.rendre).toHaveBeenCalledTimes(1);

    // Aucun enregistreur possédé : l'arrêt dit « aucune dictée ».
    const arret = await reel.arreterEtTranscrire();
    expect(arret.ok).toBe(false);
    if (!arret.ok) expect(arret.error.message).toBe(fr.jarvis.voix.aucuneDictee);
  });
});
