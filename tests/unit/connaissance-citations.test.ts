/**
 * Vérification déterministe des citations — le dernier lien non vérifié.
 *
 * Le modèle cite en prose (`Selon le DSM-5 (5e édition)…`) ; ces tests
 * prouvent que le vérificateur n'accepte qu'une attribution désignant un
 * item de l'ensemble de preuves DU TOUR, avec édition compatible quand elle
 * est revendiquée — et qu'il ne devine jamais, ne substitue jamais, ne
 * réinterroge jamais. Déterministe : purs appels, mêmes entrées.
 */
import { describe, expect, it } from "vitest";

import {
  normaliserForme,
  nomCourt,
  verifierCitations,
  type PreuveMinimale,
} from "../../src/server/knowledge/citations";

const DSM: PreuveMinimale = {
  titre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
  version: "5e édition, traduction française",
};
const REF: PreuveMinimale = {
  titre: "Référentiel de Psychiatrie et Addictologie",
  version: "3e édition",
};
const CATALOGUE: PreuveMinimale = {
  titre: "Catalogue medicaments — libelles seuls, zero posologie",
  version: "2026-09-15",
};
const TOUR = [DSM, REF, CATALOGUE];

function verdict(reponse: string, preuves: readonly PreuveMinimale[] = TOUR) {
  return verifierCitations(reponse, preuves);
}

describe("normalisation de forme (jamais d'identité)", () => {
  it("unifie casse/accents/ponctuation, conserve chiffres et sigles", () => {
    expect(normaliserForme("DSM-5 — Manuel « Psychiatrie »")).toBe("dsm-5 - manuel psychiatrie");
    expect(normaliserForme("Référentiel d’Addictologie")).toBe("referentiel d'addictologie");
  });

  it("nom court : segment avant séparateur éditorial, trait d'union intact", () => {
    expect(nomCourt(normaliserForme(DSM.titre))).toBe("dsm-5");
    expect(nomCourt(normaliserForme(CATALOGUE.titre))).toBe("catalogue medicaments");
    expect(nomCourt(normaliserForme(REF.titre))).toBe("referentiel de psychiatrie et addictologie");
  });
});

describe("A/B — attributions valides acceptées", () => {
  it("A : titre exact accepté", () => {
    const r = verdict("Selon le DSM-5, la sertraline est un ISRS.");
    expect(r.verdict).toBe("accepte");
  });

  it("B : titre + édition exacte acceptés", () => {
    const r = verdict("Selon le DSM-5 (5e édition), critère A…");
    expect(r.verdict).toBe("accepte");
    if (r.verdict === "accepte") {
      expect(r.citations).toHaveLength(1);
      expect(r.citations[0]?.preuve).toBe(0);
    }
  });

  it("B : millésime seul ⊂ version datée accepté", () => {
    const r = verdict("D'après le Catalogue medicaments (2026), …");
    expect(r.verdict).toBe("accepte");
  });
});

describe("C — tolérance de forme sans perte d'identité", () => {
  it("ponctuation/casse/accents : « d’après le Référentiel… (3e édition) » accepté", () => {
    const r = verdict("D’après le Référentiel de Psychiatrie et Addictologie — 3e édition — …");
    expect(r.verdict).toBe("accepte");
  });
});

describe("D/E/F — attributions invalides rejetées, fail-closed", () => {
  it("D : source absente du tour rejetée (Kaplan & Sadock)", () => {
    const r = verdict("Selon Kaplan & Sadock, …");
    expect(r.verdict).toBe("rejete");
    if (r.verdict === "rejete") expect(r.motif).toBe("source-inconnue");
  });

  it("E : source existant globalement mais absente DU TOUR rejetée", () => {
    // Le Référentiel existe dans le corpus mais le tour ne contient que le DSM.
    const r = verdict("Selon le Référentiel de Psychiatrie et Addictologie, …", [DSM]);
    expect(r.verdict).toBe("rejete");
    if (r.verdict === "rejete") expect(r.motif).toBe("source-inconnue");
  });

  it("F : DSM-5-TR contre preuve DSM-5 rejeté (garde de continuation)", () => {
    const r = verdict("Selon le DSM-5-TR, …");
    expect(r.verdict).toBe("rejete");
  });

  it("F : édition revendiquée absente du tour rejetée", () => {
    const r = verdict("Selon le DSM-5 (4e édition), …");
    expect(r.verdict).toBe("rejete");
    if (r.verdict === "rejete") expect(r.motif).toBe("edition-absente");
  });

  it("référence indexée hors portée rejetée", () => {
    const r = verdict("Voir Source 9 pour le détail.");
    expect(r.verdict).toBe("rejete");
    if (r.verdict === "rejete") expect(r.motif).toBe("reference-hors-portee");
  });
});

describe("G/H/I — citations multiples", () => {
  it("G : deux attributions valides acceptées", () => {
    const r = verdict("Selon le DSM-5 (5e édition)… et d'après le Référentiel (3e édition)…");
    expect(r.verdict).toBe("accepte");
    if (r.verdict === "accepte") expect(r.citations).toHaveLength(2);
  });

  it("H : une valide + une invalide = rejet global (fail-closed, pas de partiel)", () => {
    const r = verdict("Selon le DSM-5 (5e édition)… et selon Kaplan & Sadock…");
    expect(r.verdict).toBe("rejete");
  });

  it("I : répétition valide acceptée", () => {
    const r = verdict("Selon le DSM-5… Plus loin, le DSM-5 précise…");
    expect(r.verdict).toBe("accepte");
  });
});

describe("J/K — silence et ambiguïté", () => {
  it("J : réponse sans citation explicite acceptée (le vague ne se vérifie pas)", () => {
    expect(verdict("La sertraline est un antidépresseur ISRS souvent prescrit.").verdict).toBe("accepte");
    expect(verdict("Selon les recommandations en vigueur, prudence.").verdict).toBe("accepte");
  });

  it("K : attribution sans objet identifiable = ambiguë = rejetée", () => {
    const r = verdict("Selon : la suite.");
    // « Selon : » : span vide avant le premier coupe-phrase → ambigu, fail-closed.
    expect(r.verdict).toBe("rejete");
    if (r.verdict === "rejete") expect(r.motif).toBe("citation-ambigue");
  });

  it("K : mention nue du titre sans édition ni cue = prose ordinaire, acceptée", () => {
    expect(verdict("Le DSM-5 est un manuel diagnostique largement utilisé.").verdict).toBe("accepte");
  });

  it("K : forme courte légitime acceptée, préfixe partagé = ambigu rejeté", () => {
    // « Référentiel » seul désigne sans ambiguïté l'unique item du tour.
    expect(verdict("D'après le Référentiel, …").verdict).toBe("accepte");
    const deuxReferentiels: PreuveMinimale[] = [
      { titre: "Référentiel de Psychiatrie et Addictologie", version: "3e édition" },
      { titre: "Référentiel de Pédiatrie", version: "2e édition" },
    ];
    const r = verdict("Selon le Référentiel, …", deuxReferentiels);
    expect(r.verdict).toBe("rejete");
    if (r.verdict === "rejete") expect(r.motif).toBe("citation-ambigue");
  });
});

describe("L/M — déterminisme et autorité du tour", () => {
  it("L : même entrée, même verdict (déterminisme byte-stable)", () => {
    const texte = "Selon le DSM-5 (5e édition), … et selon Kaplan, …";
    const a = verifierCitations(texte, TOUR);
    const b = verifierCitations(texte, TOUR);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.verdict).toBe("rejete");
  });

  it("M : l'ensemble n'est jamais élargi — version d'un AUTRE item du même titre exigée", () => {
    const deuxEditions: PreuveMinimale[] = [
      { titre: DSM.titre, version: "5e édition" },
      { titre: DSM.titre, version: "4e édition" },
    ];
    expect(verdict("Selon le DSM-5 (4e édition)…", deuxEditions).verdict).toBe("accepte");
    expect(verdict("Selon le DSM-5 (3e édition)…", deuxEditions).verdict).toBe("rejete");
  });

  it("M : preuves vides + citation revendiquée = rejet (rien à rattacher)", () => {
    const r = verdict("Selon le DSM-5 (5e édition)…", []);
    expect(r.verdict).toBe("rejete");
  });

  it("M : preuves vides + aucune citation = accepté (vide honnête)", () => {
    expect(verdict("Je ne peux pas répondre sur cette base.", []).verdict).toBe("accepte");
  });
});
