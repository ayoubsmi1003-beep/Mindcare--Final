/**
 * LE JETON DE PROPRIÉTÉ DE LA DICTÉE — SANS NAVIGATEUR.
 *
 * `demarrerDictee` attend le micro du courtier. Si le crochet est démonté
 * pendant cette attente, `annulerDictee()` doit périmer le jeton AVANT que
 * l'enregistreur ne s'ouvre — sinon un micro reste ouvert derrière un écran
 * disparu. Et `arreterEtTranscrire()` doit prendre possession de l'enregistreur
 * en changeant le jeton, pour qu'un ancien propriétaire ne l'annule plus.
 *
 * Seuls le courtier micro et `MediaRecorder` sont simulés : le jeton, les
 * gardes de génération et la machine d'enregistrement sont le code réel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fr } from "@/i18n/fr";

const micro = vi.hoisted(() => ({ acquerir: vi.fn() }));

vi.mock("@/services/micro-partage", () => ({ prendreMicro: micro.acquerir }));

import {
  annulerDictee,
  arreterEtTranscrire,
  demarrerDictee,
  generationDictee,
} from "@/services/jarvis-voix";

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

function prise(): { flux: unknown; rendre: ReturnType<typeof vi.fn> } {
  return { flux: { piste: "fausse" }, rendre: vi.fn() };
}

beforeEach(() => {
  FauxEnregistreur.instances = [];
  micro.acquerir.mockReset();
  vi.stubGlobal("MediaRecorder", FauxEnregistreur);
  // Repart d'un état propre, comme un écran neuf.
  annulerDictee();
});

afterEach(() => {
  annulerDictee();
  vi.unstubAllGlobals();
  micro.acquerir.mockReset();
});

describe("un démarrage annulé pendant l'acquisition du micro", () => {
  it("n'ouvre aucun enregistreur et laisse la dictée nulle", async () => {
    let livrer!: (valeur: unknown) => void;
    const acces = prise();
    micro.acquerir.mockImplementation(
      () =>
        new Promise((resolve) => {
          livrer = resolve;
        }),
    );

    const avant = generationDictee();
    const demarrage = demarrerDictee();
    expect(generationDictee()).toBe(avant + 1);

    // L'écran est démonté pendant `prendreMicro` : le jeton doit changer.
    annulerDictee();
    expect(generationDictee()).toBe(avant + 2);

    livrer({ ok: true, data: acces });
    const resultat = await demarrage;

    expect(resultat.ok).toBe(false);
    expect(FauxEnregistreur.instances).toHaveLength(0);
    // La prise rendue : le courtier ne garde pas le micro ouvert pour rien.
    expect(acces.rendre).toHaveBeenCalledTimes(1);

    // Aucun recorder : l'arrêt dit « aucune dictée » au lieu de transcrire.
    const arret = await arreterEtTranscrire();
    expect(arret.ok).toBe(false);
    if (!arret.ok) expect(arret.error.message).toBe(fr.jarvis.voix.aucuneDictee);
  });
});

describe("le jeton de propriété", () => {
  it("change à chaque prise, arrêt et abandon — un jeton capturé devient périmé", async () => {
    micro.acquerir.mockResolvedValue({ ok: true, data: prise() });

    const avantPrise = generationDictee();
    const demarrage = await demarrerDictee();
    expect(demarrage.ok).toBe(true);
    const apresPrise = generationDictee();
    expect(apresPrise).not.toBe(avantPrise);
    expect(FauxEnregistreur.instances).toHaveLength(1);

    // L'arrêt prend possession : le jeton de la prise ne désigne plus rien.
    const arret = arreterEtTranscrire();
    const pendantArret = generationDictee();
    expect(pendantArret).not.toBe(apresPrise);
    const resultat = await arret;
    expect(resultat.ok).toBe(false);
    expect(generationDictee()).toBe(pendantArret);
    expect(apresPrise).not.toBe(generationDictee());

    // L'abandon périme à son tour le jeton de l'arrêt.
    const avantAbandon = generationDictee();
    annulerDictee();
    expect(generationDictee()).not.toBe(avantAbandon);
    expect(pendantArret).not.toBe(generationDictee());
  });
});
