/**
 * LE REGISTRE PARTAGÉ DES CAPTURES — UN SEUL PROPRIÉTAIRE DU MICRO.
 *
 * La machine du réveil, la boucle directe et la dictée d'un champ ouvrent le
 * même périphérique. Ce registre rend leur concurrence visible AVANT qu'un
 * second `MediaRecorder` ne soit créé : lecture automatique, lecture manuelle,
 * dictée de champ et boucle directe consultent tous le même fait.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { dicteeAutorisee } from "@/components/consultation/DicteeChamp";
import { fr } from "@/i18n/fr";
import {
  boucleActive,
  captureActive,
  lectureInterdite,
  setFieldBusy,
  setLoopBusy,
  setWakeBusy,
  wakeBusy,
} from "@/services/voice-activity";

afterEach(() => {
  setWakeBusy(false);
  setLoopBusy(false);
  setFieldBusy(false);
});

describe("le registre des captures", () => {
  it("ne signale aucune capture quand tous les propriétaires sont au repos", () => {
    expect(captureActive()).toBe(false);
    expect(lectureInterdite()).toBe(false);
    expect(wakeBusy()).toBe(false);
    expect(boucleActive()).toBe(false);
  });

  it("compte chaque propriétaire, et la lecture reste interdite tant qu'un seul écoute", () => {
    setWakeBusy(true);
    expect(captureActive()).toBe(true);
    expect(wakeBusy()).toBe(true);
    setWakeBusy(false);

    setLoopBusy(true);
    expect(captureActive()).toBe(true);
    expect(boucleActive()).toBe(true);
    setLoopBusy(false);

    setFieldBusy(true);
    expect(captureActive()).toBe(true);
    expect(lectureInterdite()).toBe(true);
    setFieldBusy(false);

    expect(captureActive()).toBe(false);
  });

  it("prévient ses abonnés quand un propriétaire change", async () => {
    const { abonnerActivite } = await import("@/services/voice-activity");
    const vues: boolean[] = [];
    const stop = abonnerActivite(() => vues.push(captureActive()));
    setFieldBusy(true);
    setFieldBusy(false);
    stop();
    setWakeBusy(true);
    setWakeBusy(false);
    expect(vues).toEqual([true, false]);
  });
});

describe("la porte de la dictée de champ", () => {
  it("refuse un champ tant que la boucle directe possède le micro", () => {
    setLoopBusy(true);
    const signaler = vi.fn();
    const demarrer = vi.fn();
    if (dicteeAutorisee(captureActive, signaler)) demarrer();

    expect(demarrer).not.toHaveBeenCalled();
    expect(signaler).toHaveBeenCalledExactlyOnceWith(fr.jarvis.voix.dejaEnCours);
  });

  it("refuse un champ tant qu'une capture du réveil possède le micro", () => {
    setWakeBusy(true);
    const signaler = vi.fn();
    expect(dicteeAutorisee(captureActive, signaler)).toBe(false);
    expect(signaler).toHaveBeenCalledExactlyOnceWith(fr.jarvis.voix.dejaEnCours);
  });

  it("ouvre le champ quand le registre est libre", () => {
    const signaler = vi.fn();
    expect(dicteeAutorisee(captureActive, signaler)).toBe(true);
    expect(signaler).not.toHaveBeenCalled();
  });
});
