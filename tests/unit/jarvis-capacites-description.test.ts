/**
 * `descriptionDesCapacites()` — LE MODÈLE DOIT VOIR LES CLÉS D'ARGUMENTS.
 *
 * ═══ LE DÉFAUT ═══
 * La description n'envoyait que nom + phrase (`- search_patients : Trouve
 * les dossiers…`), SANS les clés d'arguments. Le modèle devinait en français
 * (`{"recherche":"ayoub salmi"}` mesuré) ; `z.strictObject` rejetait
 * (`regle-metier`) ; la boucle épuisait ses 3 tours et avouait
 * « Je n'ai pas réussi à aboutir… » — alors que la donnée existait
 * (1 dossier trouvé par la porte). Reproduit en live le 2026-09-03 :
 * 3 appels `search_patients`, tous `ok:false code:regle-metier`.
 *
 * La forme des clés est DÉRIVÉE du schéma Zod (API publique : `.shape` +
 * sonde `safeParse({})`), jamais recopiée : une clé renommée dans le schéma
 * apparaît ici sans intervention.
 */
import { describe, expect, it } from "vitest";

import { descriptionDesCapacites } from "../../src/services/jarvis-capacites";

describe("la description porte les clés exactes d'arguments", () => {
  it("search_patients annonce query requise, sans clé inventée", () => {
    // Le schéma REGISTRE ne connaît QUE `query` (`limit` vit dans le schéma
    // client de `jarvis-tools.ts`, autre frontière). La description dérivée
    // doit dire exactement le schéma qu'elle décrit — ni plus (qui ferait
    // rejeter), ni moins.
    const texte = descriptionDesCapacites();
    const ligne = texte
      .split("\n")
      .find((l) => l.startsWith("- search_patients :"));
    expect(ligne).toBeDefined();
    expect(ligne).toContain('"query"');
    expect(ligne).not.toContain("?");
    expect(ligne).toMatch(/aucune autre clé/i);
  });

  it("une capacité sans argument le dit (pas de devinette d'objet vide)", () => {
    const texte = descriptionDesCapacites();
    const ligne = texte
      .split("\n")
      .find((l) => l.startsWith("- get_next_patient :"));
    expect(ligne).toBeDefined();
    expect(ligne).toMatch(/aucun argument/i);
  });

  it("dit de réutiliser les références {{…}} comme patientId, jamais un nom", () => {
    // 2026-09-03 : le modèle recevait des références sans instruction de
    // réutilisation et renvoyait le nom en clair → Guid refusait → aveu.
    const texte = descriptionDesCapacites();
    expect(texte).toMatch(/\{\{PATIENT_001\}\}/);
    expect(texte).toMatch(/jamais un nom/i);
  });

  it("rappelle que toute autre clé est refusée (strictObject)", () => {
    const texte = descriptionDesCapacites();
    const ligne = texte
      .split("\n")
      .find((l) => l.startsWith("- search_patients :"));
    expect(ligne).toMatch(/exact|aucune autre|uniquement/i);
  });
});
