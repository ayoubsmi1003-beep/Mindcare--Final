/**
 * Analyseur de demandes RDV — déterministe, sans appel externe.
 * Le LLM comprendra un jour le langage libre ; l'Agenda, lui, décide
 * toujours. Référence : lundi 28 septembre 2026 (Alger, UTC+1 sans DST).
 */
import { describe, expect, it } from "vitest";

import { analyserDemandeRdv } from "../../src/services/communication/analyse";

// Lundi 2026-09-28 09:00 UTC = 10:00 Alger.
const LUNDI = new Date("2026-09-28T09:00:00Z");

describe("analyserDemandeRdv", () => {
  it("comprend le mixte darija/fr de l'exemple canonique", () => {
    const a = analyserDemandeRdv("Salam, nحب ندير RDV mercredi après-midi", LUNDI);
    expect(a.intent).toBe("DEMANDER_RDV");
    expect(a.langue).toBe("mixte");
    expect(a.jour).toBe("2026-09-30");
    expect(a.periode).toBe("apres_midi");
  });

  it("détecte les confirmations fr/ar/darija", () => {
    expect(analyserDemandeRdv("Oui, je confirme", LUNDI).intent).toBe("CONFIRMER");
    expect(analyserDemandeRdv("نعم", LUNDI)).toMatchObject({ intent: "CONFIRMER", langue: "ar" });
    expect(analyserDemandeRdv("wakha", LUNDI)).toMatchObject({ intent: "CONFIRMER", langue: "darija" });
  });

  it("détecte les annulations fr/ar/darija", () => {
    expect(analyserDemandeRdv("Je ne peux pas venir demain", LUNDI)).toMatchObject({
      intent: "ANNULER",
      jour: "2026-09-29",
    });
    expect(analyserDemandeRdv("مانقدرش نجي", LUNDI).intent).toBe("ANNULER");
  });

  it("priorise la reprogrammation sur l'annulation", () => {
    const a = analyserDemandeRdv("Je ne peux pas venir mercredi, reportez à jeudi inchallah", LUNDI);
    expect(a.intent).toBe("REPROGRAMMER");
    expect(a.jour).toBe("2026-10-01");
  });

  it("lit le jour et la période", () => {
    expect(analyserDemandeRdv("RDV lundi matin", LUNDI)).toMatchObject({
      intent: "DEMANDER_RDV",
      jour: "2026-09-28",
      periode: "matin",
    });
    expect(analyserDemandeRdv("موعد يوم الجمعة صباحا", LUNDI)).toMatchObject({
      jour: "2026-10-02",
      periode: "matin",
    });
  });

  it("lit l'heure explicite", () => {
    expect(analyserDemandeRdv("D'accord pour 15h30", LUNDI)).toMatchObject({
      intent: "CONFIRMER",
      heure: "15:30",
    });
  });

  it("classe les questions et l'inconnu honnêtement", () => {
    expect(analyserDemandeRdv("C'est à quelle heure ?", LUNDI).intent).toBe("QUESTION");
    expect(analyserDemandeRdv("15h", LUNDI).intent).toBe("INCONNU");
    expect(analyserDemandeRdv("", LUNDI).intent).toBe("INCONNU");
  });

  it("ne casse pas les hamzas arabes (piège NFD : إ ne se décompose pas)", () => {
    // إ (U+0625) se décompose en NFD ; la normalisation doit préserver le match.
    expect(analyserDemandeRdv("أريد إلغاء الموعد", LUNDI).intent).toBe("ANNULER");
    expect(analyserDemandeRdv("موعد يوم الإثنين", LUNDI).jour).toBe("2026-09-28");
  });
});
