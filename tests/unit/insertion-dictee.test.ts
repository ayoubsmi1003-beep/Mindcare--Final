/**
 * L'INSERTION D'UNE DICTÉE — LA PROPRIÉTÉ QU'ON NE NÉGOCIE PAS.
 *
 * Ce que ces tests protègent, dans l'ordre :
 *   1. RIEN N'EST JAMAIS EFFACÉ. Quelle que soit la position, quel que soit
 *      l'état du champ, tout ce qui était écrit avant l'est encore après.
 *      C'est la propriété testée en dernier, sur toutes les positions.
 *   2. Le texte va bien LÀ où le curseur était, pas systématiquement à la fin.
 *   3. Une position inconnue tombe à la fin — jamais au milieu d'une phrase.
 */
import { describe, expect, it } from "vitest";

import { insererDictee } from "../../src/services/insertion-dictee";

describe("insererDictee", () => {
  it("écrit dans un champ vide sans rien ajouter autour", () => {
    expect(insererDictee("", "  Patiente calme.  ", null).texte).toBe("Patiente calme.");
  });

  it("insère à la position du curseur, pas à la fin", () => {
    const r = insererDictee("Début. Fin.", "Milieu.", 6);
    expect(r.texte).toBe("Début.\nMilieu. Fin.");
  });

  it("ajoute à la fin quand la position est inconnue", () => {
    expect(insererDictee("Sommeil perturbé.", "Appétit conservé.", null).texte).toBe(
      "Sommeil perturbé.\nAppétit conservé.",
    );
  });

  it("ne colle pas deux mots l'un à l'autre", () => {
    expect(insererDictee("anxiété", "matinale", 7).texte).toBe("anxiété matinale");
  });

  it("ne double pas un séparateur déjà présent", () => {
    expect(insererDictee("Ligne un.\n", "Ligne deux.", 10).texte).toBe("Ligne un.\nLigne deux.");
  });

  it("une transcription vide ne touche à rien", () => {
    expect(insererDictee("Note existante.", "   ", 3).texte).toBe("Note existante.");
  });

  it("rend un curseur placé juste après le texte inséré", () => {
    const r = insererDictee("AB", "X", 1);
    expect(r.texte.slice(0, r.curseur).endsWith("X")).toBe(true);
  });

  it("borne une position aberrante au lieu de la subir", () => {
    expect(insererDictee("abc", "X", 99).texte).toBe("abc X");
    expect(insererDictee("abc", "X", -5).texte).toBe("X abc");
  });

  // ⚠️ LA PROPRIÉTÉ CENTRALE. Une dictée est une INSERTION, jamais une
  // substitution : même arrivée pendant qu'un paragraphe était sélectionné,
  // elle ne peut pas le faire disparaître.
  it("NE PERD JAMAIS UN CARACTÈRE, à quelque position que ce soit", () => {
    const existant = "Subjectif rédigé pendant la séance, avec ponctuation.";
    for (let p = 0; p <= existant.length; p += 1) {
      const { texte } = insererDictee(existant, "ajout dicté", p);
      // Les espaces peuvent LÉGITIMEMENT changer : insérer au milieu d'un mot
      // ajoute une séparation. Ce qui ne peut pas changer, c'est la suite des
      // caractères écrits par la praticienne.
      const restitue = texte.replace("ajout dicté", "").replace(/\s+/g, "");
      expect(restitue).toBe(existant.replace(/\s+/g, ""));
    }
  });
});
