/**
 * Automation — partie pure. L'évaluation (portes) vit côté serveur
 * (`src/server/communication/automation.ts`), appelée par la route.
 *
 * `detecterContenuClinique` ne diagnostique rien : il lève un drapeau qui
 * conduit à une escalade humaine + réponse prédéfinie. L'IA ne donne jamais
 * d'avis médical ici — c'est le point de non-négociation de Phase 6.
 */
import { describe, expect, it } from "vitest";

import { detecterContenuClinique } from "../../src/services/communication/automation";

describe("detecterContenuClinique", () => {
  it("lève le drapeau sur les signaux fr/ar", () => {
    expect(detecterContenuClinique("Je pense au suicide")).toBe(true);
    expect(detecterContenuClinique("عندي اكتئاب حاد")).toBe(true);
    expect(detecterContenuClinique("Quelle dose pour mon anxiété ?")).toBe(true);
    expect(detecterContenuClinique("أفكر في الانتحار")).toBe(true);
  });

  it("reste baissé sur l'administratif", () => {
    expect(detecterContenuClinique("Salam, je confirme mercredi")).toBe(false);
    expect(detecterContenuClinique("Merci beaucoup")).toBe(false);
    expect(detecterContenuClinique("")).toBe(false);
  });
});
