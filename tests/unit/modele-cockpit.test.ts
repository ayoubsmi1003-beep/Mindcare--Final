/**
 * Logique pure du cockpit — sens d'un delta, marqueur de focus, insertion
 * d'une piste. Données écrites à la main, aucune PII.
 */
import { describe, expect, it } from "vitest";

import {
  ajouterPiste,
  appliquerFocus,
  sensDelta,
  texteDelta,
} from "../../src/components/consultation/cockpit/modele-cockpit";
import type { EchelleResume } from "../../src/services/patients";

function echelle(delta: number | null, avecPrecedent: boolean): EchelleResume {
  return {
    scaleCode: "PHQ9",
    scaleName: "PHQ-9",
    dernier: { score: 12, date: "2026-09-11T10:00:00+01:00", interpretation: "modéré" },
    precedent: avecPrecedent ? { score: 10, date: "2026-08-28T10:00:00+01:00" } : null,
    delta,
  };
}

describe("sensDelta", () => {
  it("ne dessine jamais de tendance sur une mesure unique", () => {
    expect(sensDelta(echelle(2, false))).toBe("aucune");
    expect(sensDelta(echelle(null, true))).toBe("aucune");
  });

  it("dit hausse, baisse ou stable sans juger cliniquement", () => {
    expect(sensDelta(echelle(2, true))).toBe("hausse");
    expect(sensDelta(echelle(-3, true))).toBe("baisse");
    expect(sensDelta(echelle(0, true))).toBe("stable");
  });
});

describe("texteDelta", () => {
  it("signe la valeur, null quand il n'y a rien à comparer", () => {
    expect(texteDelta(2)).toBe("+2");
    expect(texteDelta(-3)).toBe("−3");
    expect(texteDelta(0)).toBe("0");
    expect(texteDelta(null)).toBeNull();
  });
});

describe("appliquerFocus", () => {
  it("ne touche à rien quand la sélection est vide", () => {
    expect(appliquerFocus("Texte libre.", [])).toBe("Texte libre.");
  });

  it("préfixe le marqueur devant le subjectif existant", () => {
    expect(appliquerFocus("Texte libre.", ["Anxiété", "Sommeil"])).toBe(
      "Focus : Anxiété, Sommeil — Texte libre.",
    );
  });

  it("remplace le marqueur au lieu de l'empiler (idempotent)", () => {
    const une = appliquerFocus("Texte.", ["Anxiété"]);
    const deux = appliquerFocus(une, ["Sommeil"]);
    expect(deux).toBe("Focus : Sommeil — Texte.");
  });
});

describe("ajouterPiste", () => {
  it("pose la piste seule sur un champ vide", () => {
    expect(ajouterPiste("", "Contact adapté")).toBe("Contact adapté");
  });

  it("ajoute à la ligne sans dupliquer au second clic", () => {
    const un = ajouterPiste("Début.", "Contact adapté");
    expect(un).toBe("Début.\n• Contact adapté");
    expect(ajouterPiste(un, "Contact adapté")).toBe(un);
  });
});
