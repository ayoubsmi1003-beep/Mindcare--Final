/**
 * M10-A — contrat de réponse : ancrage localisation / attribution / quantitatif.
 *
 * Comme `jarvis-prompt-style` : ces tests prouvent que la consigne EXISTE et
 * ne disparaît pas d'une refonte — pas que le modèle obéit (le M09-live le
 * mesure). Toute modification du registre EXIGE une version distincte
 * (règle épinglée dans `jarvis-prompt-style.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { PROMPT_CONNAISSANCE, PROMPT_VERSION } from "../../src/app/api/jarvis/jarvis-chat/prompt";

describe("M10-A1 — localisation jamais devinée", () => {
  it("le prompt interdit page/chapitre/section depuis le savoir général", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/page|chapitre|section/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/ne se (cite|devine|affirme)/i);
  });

  it("le prompt exige de dire quand la localisation n'est pas vérifiée", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/localisation n'est pas vérifiée|pas vérifiée dans/i);
  });
});

describe("M10-A3 — aucune attribution affirmative sans preuve", () => {
  it("le prompt interdit de déguiser le savoir général en source", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/ne .*présente.*comme venant d'une source|déguise/i);
  });
});

describe("M10-A2 — quantitatif médical ancré ou déclaré", () => {
  it("le prompt exige preuve ou déclaration explicite pour dose/schéma/fréquence", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/dose|schéma|fréquence/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/que sur preuve|sinon dis explicitement/i);
  });
});

describe("M10 — version du registre", () => {
  it("le registre modifié porte une version distincte de v4.0", () => {
    expect(PROMPT_VERSION).not.toBe("v4.0");
    expect(PROMPT_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});

describe("désaccord entre sources — jamais de choix silencieux", () => {
  it("le prompt exige de présenter les deux positions avec leurs sources", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/se contredisent|divergent/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/ne\s+choisis jamais silencieusement/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/l'interprétation appartient à la praticienne/i);
  });

  it("le prompt exige titre + version pour chaque position du désaccord", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/avec leurs\s+sources \(titre \+ version\)/i);
  });
});
