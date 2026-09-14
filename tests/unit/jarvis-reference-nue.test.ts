/**
 * `resoudreArguments` — LA RÉFÉRENCE NUE.
 *
 * ═══ LE DÉFAUT ═══
 * Le modèle rend `{"patientId": "PATIENT_001"}` (référence NUE, mesuré en
 * live le 2026-09-03 sur « medicaments de ayoub salmi ») au lieu de
 * `{"patientId": "{{PATIENT_001}}"`. Seule la forme à accolades se résolvait :
 * la nue traversait jusqu'à `Guid`, qui refusait (`regle-metier`), et la
 * boucle avouait après 3 tours sur une donnée qui existait.
 *
 * ═══ POURQUOI LA FORME NUE ENTIÈRE EST SÛRE ═══
 * Seule une valeur ÉGALITÉ STRICTE avec `^[A-Z]+_\d+$` est rabattue — jamais
 * une sous-chaîne (le milieu de chaîne reste refusé comme avant : un texte
 * libre n'est pas un argument). La résolution reste bornée à la carte DU
 * TOUR : une référence inconnue rend `null` (structure entière invalide),
 * comme pour la forme à accolades. Aucune confusion d'identité possible :
 * soit la valeur EST le jeton frappé ce tour-ci, soit elle est invalide.
 */
import { describe, expect, it } from "vitest";

import { CarteIdentite } from "../../src/services/jarvis-identite";

function carteAvecPatient(): { carte: CarteIdentite; id: string } {
  const carte = new CarteIdentite();
  const id = "11111111-2222-4333-8555-666666666666";
  carte.patient(id, "Test Cas", ["Test", "Cas"]);
  return { carte, id };
}

describe("forme à accolades (non-régression)", () => {
  it("{{PATIENT_001}} se résout", () => {
    const { carte, id } = carteAvecPatient();
    expect(carte.resoudreArguments({ patientId: "{{PATIENT_001}}" })).toEqual({
      patientId: id,
    });
  });

  it("jeton inconnu à accolades → null (structure entière invalide)", () => {
    const { carte } = carteAvecPatient();
    expect(carte.resoudreArguments({ patientId: "{{PATIENT_999}}" })).toBeNull();
  });

  it("jeton à accolades en milieu de chaîne → refusé comme avant", () => {
    const { carte } = carteAvecPatient();
    expect(carte.resoudreArguments({ q: "voir {{PATIENT_001}} svp" })).toBeNull();
  });

  it("référence nue en milieu de chaîne → inchangée (pas un argument)", () => {
    // Comportement antérieur conservé : seule la valeur ENTIÈRE est un
    // jeton. Un texte libre n'est jamais réécrit.
    const { carte } = carteAvecPatient();
    expect(carte.resoudreArguments({ q: "voir PATIENT_001 svp" })).toEqual({
      q: "voir PATIENT_001 svp",
    });
  });
});

describe("forme nue entière (qwen, mesuré en live)", () => {
  it("PATIENT_001 seul se résout vers l'identifiant du tour", () => {
    const { carte, id } = carteAvecPatient();
    expect(carte.resoudreArguments({ patientId: "PATIENT_001" })).toEqual({
      patientId: id,
    });
  });

  it("référence nue inconnue → null, jamais un identifiant deviné", () => {
    const { carte } = carteAvecPatient();
    expect(carte.resoudreArguments({ patientId: "PATIENT_999" })).toBeNull();
  });

  it("un nom en clair ne devient pas un identifiant", () => {
    const { carte } = carteAvecPatient();
    expect(carte.resoudreArguments({ patientId: "ayoub salmi" })).toEqual({
      patientId: "ayoub salmi",
    });
  });
});
