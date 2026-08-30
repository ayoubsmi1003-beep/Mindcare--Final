/**
 * LE ROUTAGE D'UNE DICTÉE — CE QUI DOIT ÊTRE VRAI POUR QUE LA NOTE SOIT JUSTE.
 *
 * Une erreur de routage est SILENCIEUSE : le texte apparaît quelque part,
 * l'interface a l'air de fonctionner, et c'est la note clinique qui est fausse.
 * D'où ces tests, sur les trois seules décisions qui existent.
 */
import { describe, expect, it } from "vitest";

import {
  actionMicro,
  cibleDeRestitution,
  microInerte,
  type EtatDictee,
} from "../../src/components/consultation/regles-dictee";

type Champ = "brut" | "subjective" | "objective" | "assessment" | "plan";
const repos: EtatDictee<Champ> = { cible: null, phase: "repos" };
const ecoute = (c: Champ): EtatDictee<Champ> => ({ cible: c, phase: "ecoute" });

describe("actionMicro", () => {
  it("démarre depuis le repos, sur n'importe quelle rubrique", () => {
    for (const c of ["brut", "subjective", "objective", "assessment", "plan"] as const) {
      expect(actionMicro(repos, c)).toBe("demarrer");
    }
  });

  it("arrête le champ qui écoute — et LUI SEUL", () => {
    expect(actionMicro(ecoute("subjective"), "subjective")).toBe("arreter");
    expect(actionMicro(ecoute("subjective"), "plan")).toBe("ignorer");
  });

  it("ignore toute pression pendant la transcription", () => {
    const t: EtatDictee<Champ> = { cible: "plan", phase: "transcription" };
    expect(actionMicro(t, "plan")).toBe("ignorer");
    expect(actionMicro(t, "brut")).toBe("ignorer");
  });
});

describe("microInerte", () => {
  it("n'immobilise rien au repos", () => {
    expect(microInerte(repos, "objective")).toBe(false);
  });

  it("immobilise les AUTRES micros pendant une écoute", () => {
    const e = ecoute("objective");
    expect(microInerte(e, "objective")).toBe(false);
    expect(microInerte(e, "subjective")).toBe(true);
    expect(microInerte(e, "brut")).toBe(true);
  });
});

describe("cibleDeRestitution", () => {
  // ⚠️ LA PROPRIÉTÉ QUI PROTÈGE LA NOTE. La transcription revient plusieurs
  // secondes après le geste ; le focus a pu bouger, un autre champ a pu être
  // cliqué. Le texte va au champ dont le micro a été pressé, point.
  it("rend TOUJOURS le champ de départ, quoi qu'il soit arrivé entre-temps", () => {
    expect(cibleDeRestitution<Champ>("subjective", "plan")).toBe("subjective");
    expect(cibleDeRestitution<Champ>("subjective", null)).toBe("subjective");
    expect(cibleDeRestitution<Champ>("brut", "assessment")).toBe("brut");
  });

  it("ne renvoie jamais les notes de séance pour une rubrique clinique", () => {
    // Les deux usages ne se mélangent pas : ce qui est dicté dans une rubrique
    // ne peut pas retomber dans le brouillon de séance, ni l'inverse.
    for (const depart of ["subjective", "objective", "assessment", "plan"] as const) {
      expect(cibleDeRestitution<Champ>(depart, "brut")).not.toBe("brut");
    }
  });
});
