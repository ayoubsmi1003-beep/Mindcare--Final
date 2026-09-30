/**
 * Isolement inter-patients §7 — LE BROKER DE CIBLE, ÉPROUVÉ SANS BASE.
 *
 * L'invariant : à tout instant, au plus UN patient ciblé, et changer de
 * patient REMPLACE + purge (carte d'identité réinitialisée dans la même
 * instruction). Un contexte périmé vaut ABSENT (TTL 15 min, purge paresseuse).
 *
 * Scénarios §7 couverts ici (couche broker, déterministe) : A→B sans fuite,
 * commutation rapide (le dernier gagne), TTL expiré, ré-armement du même
 * patient, ambiguïté (purge, jamais de devinette), retrait explicite.
 * Non couverts ici (exigent app + base vivante, NOT RUN) : deux fenêtres,
 * rechargement Electron, session expirée, RLS — voir le rapport Slice 1.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  cibleValide,
  contexteExpire,
  definirCible,
  effacerCible,
  signalerAmbiguite,
  TTL_CONTEXTE_MS,
  type SaisieCible,
} from "@/services/jarvis-contexte";
import { carte as carteCourante } from "@/services/jarvis-identite";

const NADIA: SaisieCible = {
  id: "patient-nadia",
  libelle: "Nadia B.",
  numeroDossier: "D-001",
  origine: "recherche",
};
const KARIM: SaisieCible = {
  id: "patient-karim",
  libelle: "Karim S.",
  numeroDossier: "D-002",
  origine: "recherche",
};

beforeEach(() => {
  effacerCible();
});

describe("isolement §7 — un seul patient à la fois, jamais de mélange", () => {
  it("A puis B : B remplace A, aucun résidu", () => {
    expect(definirCible(NADIA, 1000)).toBe(true);
    expect(cibleValide(1000)?.id).toBe("patient-nadia");
    expect(definirCible(KARIM, 2000)).toBe(true);
    const cible = cibleValide(2000);
    expect(cible?.id).toBe("patient-karim");
    expect(cible?.libelle).toBe("Karim S.");
  });

  it("commutation rapide : le dernier écrase, pas de file, pas de fusion", () => {
    definirCible(NADIA, 1000);
    definirCible(KARIM, 1001);
    definirCible(NADIA, 1002);
    definirCible(KARIM, 1003);
    expect(cibleValide(1003)?.id).toBe("patient-karim");
  });

  it("le changement de cible purge la carte d'identité (anti-contamination PATIENT_001)", () => {
    definirCible(NADIA, 1000);
    carteCourante().frapper("PATIENT", "patient-nadia", "Nadia B.");
    expect(carteCourante().rendre("{{PATIENT_001}}")).toBe("Nadia B.");
    definirCible(KARIM, 2000);
    // La carte repart vierge : le jeton de Nadia ne rend PLUS son nom —
    // il devient un marqueur visible, jamais le nom du mauvais dossier.
    expect(carteCourante().rendre("{{PATIENT_001}}")).toBe("[référence inconnue]");
  });

  it("TTL expiré : la cible vaut absente ET est purgée (pas de contexte périmé)", () => {
    definirCible(NADIA, 1000);
    expect(cibleValide(1000 + TTL_CONTEXTE_MS - 1)?.id).toBe("patient-nadia");
    expect(cibleValide(1000 + TTL_CONTEXTE_MS)).toBeNull();
    expect(contexteExpire(1000 + TTL_CONTEXTE_MS)).toBe(false);
    expect(cibleValide(1000 + TTL_CONTEXTE_MS + 1)).toBeNull();
  });

  it("revoir le même patient ré-arme le TTL sans signaler de changement", () => {
    definirCible(NADIA, 1000);
    expect(definirCible(NADIA, 2000)).toBe(false);
    // Ré-armé à 2000 : valide à 2000 + TTL - 1, mort après.
    expect(cibleValide(2000 + TTL_CONTEXTE_MS - 1)?.id).toBe("patient-nadia");
    expect(cibleValide(2000 + TTL_CONTEXTE_MS)).toBeNull();
  });

  it("ambiguïté (homonymes) : purge, jamais de devinette entre deux dossiers", () => {
    definirCible(NADIA, 1000);
    signalerAmbiguite();
    expect(cibleValide(1000)).toBeNull();
  });

  it("retrait explicite ([Changer], déconnexion) : cible nulle", () => {
    definirCible(KARIM, 1000);
    effacerCible();
    expect(cibleValide(1000)).toBeNull();
  });

  it("définir null équivaut à effacer", () => {
    definirCible(NADIA, 1000);
    expect(definirCible(null, 2000)).toBe(true);
    expect(cibleValide(2000)).toBeNull();
  });
});
