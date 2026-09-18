/**
 * `jarvis-contexte-nonresolu.test.ts` — M02-I1 dans la machine de précédence.
 *
 * Prouve que `resoudreCible` ne retombe jamais d'une mention explicite non
 * résolue vers l'écran, le fil ou l'ancre, et que `adopterResolution` ne
 * touche à rien sur `nonResolu`. Isole l'état module par `definirCible`.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  adopterResolution,
  aUneReferencePatient,
  cibleValide,
  definirCible,
  extraireMentionExplicite,
  resoudreCible,
} from "@/services/jarvis-contexte";

beforeEach(() => {
  definirCible(null);
});

describe("M02-I1 : nonResolu bloque tous les rangs inférieurs", () => {
  it("mention non résolue + écran + fil valide => nonResolu (jamais écran/fil)", () => {
    definirCible(
      { id: "uuid-karim", libelle: "Karim", numeroDossier: "", origine: "recherche" },
      1_000,
    );
    const r = resoudreCible(
      {
        mentionExplicite: "Sarah",
        ecran: { id: "uuid-nadia", libelle: "Nadia", numeroDossier: "1", origine: "ecran" },
      },
      2_000,
    );
    expect(r.etat).toBe("nonResolu");
    if (r.etat === "nonResolu") expect(r.texte).toBe("Sarah");
  });

  it("mention non résolue seule => nonResolu, pas aucun", () => {
    expect(resoudreCible({ mentionExplicite: "Sarah" }).etat).toBe("nonResolu");
  });

  it("explicite résolu prime toujours sur mention non résolue", () => {
    const r = resoudreCible({
      explicite: { id: "u", libelle: "L", numeroDossier: "", origine: "recherche" },
      mentionExplicite: "Sarah",
    });
    expect(r.etat).toBe("explicite");
  });

  it("ambigu prime sur mention non résolue", () => {
    expect(resoudreCible({ ambigu: true, mentionExplicite: "X" }).etat).toBe("ambigu");
  });

  it("adopterResolution(nonResolu) : no-op, cible préservée", () => {
    definirCible(
      { id: "uuid-karim", libelle: "Karim", numeroDossier: "", origine: "recherche" },
      1_000,
    );
    const change = adopterResolution({ etat: "nonResolu", texte: "Sarah" }, 2_000);
    expect(change).toBe(false);
    expect(cibleValide(2_000)?.id).toBe("uuid-karim");
  });

  it("sans mention : comportement historique inchangé (écran > fil)", () => {
    definirCible(
      { id: "uuid-karim", libelle: "Karim", numeroDossier: "", origine: "recherche" },
      1_000,
    );
    const r = resoudreCible({
      ecran: { id: "uuid-nadia", libelle: "Nadia", numeroDossier: "1", origine: "ecran" },
    });
    expect(r.etat).toBe("ecran");
  });
});

describe("extraireMentionExplicite", () => {
  it("« Montre-moi le dossier de Karim. » => Karim", () => {
    expect(extraireMentionExplicite("Montre-moi le dossier de Karim.")).toBe("Karim");
  });

  it("nom complet => capture fidèle (« Karim Djilali », pas « Karim »)", () => {
    expect(extraireMentionExplicite("Montre-moi le dossier de Karim Djilali.")).toBe("Karim Djilali");
  });

  it("trois mots au plus (quatre nommés => trois premiers)", () => {
    expect(extraireMentionExplicite("Montre-moi le dossier de Nadia Belkacem Benali X.")).toBe(
      "Nadia Belkacem Benali",
    );
  });

  it("objet direct sans préposition (« Montre-moi Karim. ») => Karim", () => {
    expect(extraireMentionExplicite("Montre-moi Karim.")).toBe("Karim");
  });

  it("objet direct plurimot (« Montre-moi Karim Djilali. ») => nom complet", () => {
    expect(extraireMentionExplicite("Montre-moi Karim Djilali.")).toBe("Karim Djilali");
  });

  it("le verbe d'ouverture ne se sonde jamais (« Résume le dossier. » => null)", () => {
    expect(extraireMentionExplicite("Résume le dossier.")).toBeNull();
  });

  it("question de savoir (« Quelle est la posologie usuelle ? » => null)", () => {
    expect(extraireMentionExplicite("Quelle est la posologie usuelle ?")).toBeNull();
  });

  it("« Et pour Nadia, sa dernière consultation ? » => Nadia", () => {
    expect(extraireMentionExplicite("Et pour Nadia, sa dernière consultation ?")).toBe("Nadia");
  });

  it("pronom seul => null (aucune désignation)", () => {
    expect(extraireMentionExplicite("Et sa dernière consultation ?")).toBeNull();
  });

  it("question de connaissance => null", () => {
    expect(extraireMentionExplicite("Quelle est la posologie usuelle ?")).toBeNull();
  });

  it("vide => null", () => {
    expect(extraireMentionExplicite("   ")).toBeNull();
  });
});

describe("aUneReferencePatient", () => {
  it("possessif + nom clinique => true", () => {
    expect(aUneReferencePatient("Et sa dernière consultation ?")).toBe(true);
  });

  it("question de connaissance => false", () => {
    expect(aUneReferencePatient("Quelle est la demi-vie ?")).toBe(false);
  });
});
