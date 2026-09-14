/**
 * LE REGISTRE DE RÉPONSE D'ALEXA — v3.1.
 *
 * Ces tests ne prouvent pas que le modèle OBÉIT : un prompt n'est pas une
 * garantie, et le fichier qu'ils lisent le dit lui-même en tête. Ils prouvent
 * que la consigne EXISTE et ne disparaît pas d'une refonte à l'autre.
 *
 * Pourquoi cela mérite un test : le défaut mesuré n'était pas une réponse
 * fausse, mais une réponse ILLISIBLE dans le contexte d'usage — un mur de
 * texte, entre deux patients, parfois lu à voix haute. Les deux chemins
 * (connaissance et patient) doivent porter la même exigence, sans quoi la
 * praticienne obtient deux produits selon la question posée.
 */
import { describe, expect, it } from "vitest";

import {
  PROMPT_CONNAISSANCE,
  PROMPT_PATIENT,
  PROMPT_VERSION,
} from "@/app/api/jarvis/jarvis-chat/prompt";

const LES_DEUX: ReadonlyArray<readonly [string, string]> = [
  ["connaissance", PROMPT_CONNAISSANCE],
  ["patient", PROMPT_PATIENT],
];

describe("registre de réponse", () => {
  for (const [nom, prompt] of LES_DEUX) {
    it(`${nom} : impose la réponse AVANT les détails`, () => {
      expect(prompt).toMatch(/STYLE DE RÉPONSE/);
      expect(prompt).toMatch(/Commence par LA RÉPONSE/i);
      expect(prompt).toMatch(/détails viennent ensuite/i);
    });

    it(`${nom} : interdit le mur de texte`, () => {
      expect(prompt).toMatch(/mur de texte/i);
    });

    it(`${nom} : bannit le vocabulaire de la base`, () => {
      // Ce qui sort de la bouche d'Alexa ne doit jamais être un nom de table :
      // la praticienne n'a pas à connaître le schéma pour se faire aider.
      expect(prompt).toMatch(/base de données|identifiant interne/i);
    });

    it(`${nom} : la réponse doit rester PRONONÇABLE`, () => {
      expect(prompt).toMatch(/prononc/i);
    });
  }

  it("la version de prompt suit le changement de registre (trace d'audit)", () => {
    // Elle est écrite telle quelle dans `jarvis_actions` : deux registres
    // différents ne doivent jamais porter la même version.
    expect(PROMPT_VERSION).toBe("v3.1");
  });
});
