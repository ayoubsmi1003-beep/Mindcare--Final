/**
 * Mains-libres — pont réveil → conversation.
 * Sans micro : détecteur et envoi réels jamais exercés ici (le harnais
 * `jarvis-voix-harnais` couvre le pipeline STT→décision).
 */
import { describe, expect, it, vi } from "vitest";

import { abonnerVoix, desarmerReveil } from "@/services/jarvis-reveil";
import {
  abonnerMainsLibres,
  arreterMainsLibres,
  demarrerMainsLibres,
  fautAccuser,
  mainsLibresActif,
} from "@/services/voix-mains-libres";

describe("etat reveil observable", () => {
  it("notifie la désactivation", async () => {
    const vus: string[] = [];
    const stop = abonnerVoix((vue) => {
      vus.push(vue.etat);
    });
    desarmerReveil();
    await Promise.resolve();
    expect(vus).toContain("desactive");
    stop();
  });
});

describe("fautAccuser", () => {
  it("accuse uniquement au réveil", () => {
    expect(fautAccuser("reveille")).toBe(true);
  });
  it("n'accuse pas pendant la parole (pas de double ack)", () => {
    expect(fautAccuser("parole")).toBe(false);
    expect(fautAccuser("ecoute")).toBe(false);
    expect(fautAccuser("traitement")).toBe(false);
    expect(fautAccuser("veille")).toBe(false);
  });
});

describe("pont mains-libres", () => {
  it("démarre/arrête avec un retenir injecté, release idempotent", async () => {
    arreterMainsLibres();
    const release = vi.fn();
    const retenir = vi.fn().mockReturnValue(release);
    const vus: boolean[] = [];
    const stop = abonnerMainsLibres((actif) => {
      vus.push(actif);
    });
    await demarrerMainsLibres({ retenir: retenir as never });
    expect(mainsLibresActif()).toBe(true);
    expect(retenir).toHaveBeenCalledTimes(1);
    expect(vus).toContain(true);
    arreterMainsLibres();
    arreterMainsLibres();
    expect(mainsLibresActif()).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(vus).toContain(false);
    stop();
  });
});
