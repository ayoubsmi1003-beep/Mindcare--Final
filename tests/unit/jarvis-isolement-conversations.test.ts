/**
 * `jarvis-isolement-conversations.test.ts` — M02 : un fil ne fuit jamais.
 *
 * ═══ CE QUE CE FICHIER ÉPROUVE ═══
 * Le miroir (`ContexteTravail`, `conversation.ts`) est la seule mémoire
 * inter-tours de M02 : il DOIT être cloisonné par conversation, périmé par
 * TTL, invalidé par divergence du fil, et purgé par le cycle de vie. Chaque
 * cas prouve une face du cloisonnement — A = Karim ne résout jamais « sa »
 * vers Sarah de B, et réciproquement.
 *
 * Aucune base, aucun modèle : `retenirTravail`/`lireTravailValide` sont
 * synchrones et purs vis-à-vis de l'extérieur (le temps est injecté).
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  definirCible,
  TTL_CONTEXTE_MS,
} from "../../src/services/jarvis-contexte";
import {
  lireTravailValide,
  purgerContexteSession,
  retenirTravail,
} from "../../src/services/conversation";
import { KARIM, NADIA } from "../fixtures/patients";

const RESOLUTION_KARIM = {
  verdict: { etat: "unique" as const, source: "conversation" as const, patient: { id: KARIM.id, libelle: KARIM.libelle } },
  intentionRetenu: "GET_CONSULTATION_HISTORY" as const,
};

const RESOLUTION_NADIA = {
  verdict: { etat: "unique" as const, source: "ecran" as const, patient: { id: NADIA.id, libelle: NADIA.libelle } },
  intentionRetenu: "GET_PATIENT_CONTEXT" as const,
};

function poserFilKarim(maintenantMs: number): void {
  definirCible(
    { id: KARIM.id, libelle: KARIM.libelle, numeroDossier: "", origine: "recherche" },
    maintenantMs,
  );
}

beforeEach(() => {
  purgerContexteSession();
  definirCible(null);
});

describe("isolement inter-conversations", () => {
  it("un seul emplacement : B écrase A — jamais de mélange, jamais de survie", () => {
    const t0 = 1_000_000;
    // L'écran n'a QU'UNE conversation active : le miroir est un emplacement
    // unique, pas une carte. La sécurité vient de la LECTURE cloisonnée.
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    expect(lireTravailValide("conv-A", t0 + 1000)).toMatchObject({
      conversationId: "conv-A",
      patientId: KARIM.id,
      intentionPrecedente: "GET_CONSULTATION_HISTORY",
    });

    definirCible(
      { id: NADIA.id, libelle: NADIA.libelle, numeroDossier: "", origine: "ecran" },
      t0 + 500,
    );
    retenirTravail("conv-B", RESOLUTION_NADIA);
    // A ne relit plus rien : ni la conversation, ni le fil ne concordent.
    expect(lireTravailValide("conv-A", t0 + 1500)).toBeNull();
    // B relit le sien.
    expect(lireTravailValide("conv-B", t0 + 1500)).toMatchObject({
      conversationId: "conv-B",
      patientId: NADIA.id,
    });
  });

  it("même patient, autre conversation => null (le fil ne suffit pas)", () => {
    const t0 = 1_500_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    // Fil vivant Karim, miroir Karim — mais conversation B : RIEN ne sort.
    // C'est LA preuve anti-fuite : l'identité du fil n'autorise pas à elle
    // seule, la conversation d'origine doit concorder.
    expect(lireTravailValide("conv-B", t0 + 1000)).toBeNull();
  });

  it("miroir d'une autre conversation => null (jamais de fuite A→B)", () => {
    const t0 = 2_000_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    // Lecture depuis B : le miroir de A ne sort jamais.
    expect(lireTravailValide("conv-B", t0 + 1000)).toBeNull();
  });

  it("TTL dépassé => null (le miroir meurt comme la cible)", () => {
    const t0 = 3_000_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    expect(lireTravailValide("conv-A", t0 + TTL_CONTEXTE_MS + 1)).toBeNull();
  });

  it("fil divergé (miroir Karim, cible Nadia) => null, on jette", () => {
    const t0 = 4_000_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    definirCible(
      { id: NADIA.id, libelle: NADIA.libelle, numeroDossier: "", origine: "ecran" },
      t0 + 500,
    );
    expect(lireTravailValide("conv-A", t0 + 1000)).toBeNull();
  });

  it("purgerContexteSession efface le miroir ([Changer], déconnexion)", () => {
    const t0 = 5_000_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    purgerContexteSession();
    // Le fil est parti avec : lecture nulle même en re-posant le temps.
    expect(lireTravailValide("conv-A", t0 + 1000)).toBeNull();
  });

  it("verdict sans patient (ambigu/nonResolu/aucun) => oubli immédiat", () => {
    const t0 = 6_000_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    expect(lireTravailValide("conv-A", t0 + 1000)).not.toBeNull();
    retenirTravail("conv-A", {
      verdict: { etat: "nonResolu", mention: "Sarah" },
      intentionRetenu: null,
    });
    expect(lireTravailValide("conv-A", t0 + 2000)).toBeNull();
  });

  it("échec/interruption (résolution absente) => oubli immédiat", () => {
    const t0 = 7_000_000;
    poserFilKarim(t0);
    retenirTravail("conv-A", RESOLUTION_KARIM);
    retenirTravail("conv-A", undefined);
    expect(lireTravailValide("conv-A", t0 + 1000)).toBeNull();
  });
});
