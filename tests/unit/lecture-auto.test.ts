/**
 * Lecture automatique — décisions pures, sans micro ni réseau.
 * Spec voix 2026-10-24 §2.4/§5b : globale, jamais d'historique, jamais
 * d'identité vers le TTS tiers, interrupteur persistant défaut ON.
 */
import { describe, expect, it } from "vitest";

import { choisirTourAuto, fautLireAuto } from "@/services/lecture-auto";

const BASE = { id: "t1", role: "jarvis" as const, texte: "Bonjour docteur." };

describe("fautLireAuto", () => {
  it("lit une réponse texte simple quand tout est actif", () => {
    expect(fautLireAuto(BASE, { lectureAuto: true, dejaLu: false, conversationChargee: true })).toBe(true);
  });
  it("ne lit jamais l'historique chargé", () => {
    expect(fautLireAuto(BASE, { lectureAuto: true, dejaLu: false, conversationChargee: false })).toBe(false);
  });
  it("ne relit jamais le même tour", () => {
    expect(fautLireAuto(BASE, { lectureAuto: true, dejaLu: true, conversationChargee: true })).toBe(false);
  });
  it("respecte l'interrupteur muet", () => {
    expect(fautLireAuto(BASE, { lectureAuto: false, dejaLu: false, conversationChargee: true })).toBe(false);
  });
  it("lit une réponse qui nomme un dossier, car la voix est locale", () => {
    expect(
      fautLireAuto({ ...BASE, porteUneIdentite: true }, { lectureAuto: true, dejaLu: false, conversationChargee: true }),
    ).toBe(true);
  });
  it("ne rejoue jamais une réponse déjà lue par la boucle vocale", () => {
    expect(
      fautLireAuto({ ...BASE, dejaParlee: true }, { lectureAuto: true, dejaLu: false, conversationChargee: true }),
    ).toBe(false);
  });
  it("ignore l'humain, le système, l'interrompu et le vide", () => {
    const opts = { lectureAuto: true, dejaLu: false, conversationChargee: true } as const;
    expect(fautLireAuto({ ...BASE, role: "humain" }, opts)).toBe(false);
    expect(fautLireAuto({ ...BASE, role: "systeme" }, opts)).toBe(false);
    expect(fautLireAuto({ ...BASE, interrompu: true }, opts)).toBe(false);
    expect(fautLireAuto({ ...BASE, texte: "   " }, opts)).toBe(false);
  });
  it("lit une réponse longue : le découpage appartient à lireTexteLong", () => {
    expect(
      fautLireAuto({ ...BASE, texte: "x".repeat(2001) }, { lectureAuto: true, dejaLu: false, conversationChargee: true }),
    ).toBe(true);
  });
  it("refuse une réponse dont le statut Alexa n'est pas `completed`", () => {
    const opts = { lectureAuto: true, dejaLu: false, conversationChargee: true } as const;
    expect(fautLireAuto({ ...BASE, alexaStatus: "partial" }, opts)).toBe(false);
    expect(fautLireAuto({ ...BASE, alexaStatus: "needs_input" }, opts)).toBe(false);
    expect(fautLireAuto({ ...BASE, alexaStatus: "completed" }, opts)).toBe(true);
  });
});

describe("choisirTourAuto", () => {
  it("reads a new typed answer that arrived while history was still loading", () => {
    const tours = [BASE, { ...BASE, id: "t2", texte: "Réponse arrivée après le montage." }];
    expect(choisirTourAuto(tours, new Set(["t1"]), new Set(), { lectureAuto: true, conversationChargee: true }))
      .toMatchObject({ id: "t2" });
  });

  it("does not read a turn already present at mount", () => {
    expect(choisirTourAuto([BASE], new Set(["t1"]), new Set(), { lectureAuto: true, conversationChargee: true }))
      .toBeNull();
  });
});
