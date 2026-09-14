/**
 * Garde-fous du namespace cockpit — `fr.ts` est un god-file souvent édité,
 * ces clés portent tout le cockpit. Données écrites à la main, aucune PII.
 */
import { describe, expect, it } from "vitest";

import { fr } from "../../src/i18n/fr";

describe("cles cockpit", () => {
  it("expose les titres de section", () => {
    expect(fr.consultation.cockpit.etatTitre).toBe("État clinique");
    expect(fr.consultation.cockpit.focusTitre).toBe("Focus de la séance");
    expect(fr.consultation.cockpit.derniereTitre).toBe("Séance précédente");
    expect(fr.consultation.cockpit.traitementTitre).toBe("Traitement actuel");
  });

  it("expose sept options de focus, sans chaîne en dur dans les composants", () => {
    expect(fr.consultation.cockpit.focusOptions).toEqual([
      "Anxiété",
      "Sommeil",
      "Humeur",
      "Traitement",
      "Travail",
      "Relations",
      "Événement récent",
    ]);
  });

  it("expose au moins deux pistes sûres par rubrique SOAP", () => {
    const pistes = fr.consultation.cockpit.pistes;
    for (const champ of ["subjective", "objective", "assessment", "plan"] as const) {
      expect(pistes[champ].length).toBeGreaterThanOrEqual(2);
      for (const p of pistes[champ]) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it("expose les libellés du rail et de la barre", () => {
    expect(fr.consultation.cockpit.railCharger).toBe("Charger le contexte patient");
    expect(fr.consultation.cockpit.tarifManquant).toBe("Tarif à fixer");
    expect(fr.consultation.cockpit.notesPlaceholder).toBe("Commencer à écrire ou dicter…");
  });
});
