import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let Courbe: typeof import("@/components/ui/Courbe").Courbe;
let BarresRang: typeof import("@/components/ui/Barres").BarresRang;
let StatutsRendezVous: typeof import("@/components/analyse/PanneauxActivite").StatutsRendezVous;
let QualiteDossier: typeof import("@/components/analyse/PanneauxCliniques").QualiteDossier;
let EchellesCliniques: typeof import("@/components/analyse/PanneauxCliniques").EchellesCliniques;

beforeAll(async () => {
  vi.stubGlobal("React", React);
  ({ Courbe } = await import("@/components/ui/Courbe"));
  ({ BarresRang } = await import("@/components/ui/Barres"));
  ({ StatutsRendezVous } = await import("@/components/analyse/PanneauxActivite"));
  ({ QualiteDossier, EchellesCliniques } = await import("@/components/analyse/PanneauxCliniques"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("états vides — aucun chiffre inventé", () => {
  it("la courbe dit qu'il n'y a rien, elle ne trace pas une ligne plate", () => {
    const html = renderToStaticMarkup(
      React.createElement(Courbe, {
        points: [],
        ariaLabel: "Séances",
        libellePrimaire: "Séances",
      }),
    );
    expect(html).toContain("Aucun point à afficher");
    expect(html).not.toContain("<svg");
  });

  it("un anneau sans rendez-vous affiche une phrase, pas un cercle vide", () => {
    const html = renderToStaticMarkup(
      React.createElement(StatutsRendezVous, { statuts: [], onStatut: () => undefined }),
    );
    expect(html).toContain("Aucune donnée sur cette période");
  });

  it("une qualité sans défaut le dit calmement", () => {
    const html = renderToStaticMarkup(
      React.createElement(QualiteDossier, {
        notesManquantes: 0,
        rdvNonClotures: 0,
        onNotes: () => undefined,
        onRdv: () => undefined,
      }),
    );
    expect(html).toContain("Rien à signaler sur la période");
  });

  it("une échelle sans mesure n'affiche pas de barème à zéro", () => {
    const html = renderToStaticMarkup(
      React.createElement(EchellesCliniques, { echelles: [], onMesure: () => undefined }),
    );
    expect(html).toContain("Aucune échelle administrée sur la période");
  });
});

describe("rendu des valeurs", () => {
  it("les barres classées portent le libellé ET le compte", () => {
    const html = renderToStaticMarkup(
      React.createElement(BarresRang, {
        lignes: [
          { cle: "F41.1", libelle: "Trouble anxieux généralisé", valeur: 106 },
          { cle: "G47.0", libelle: "Insomnie", valeur: 95 },
        ],
        ariaLabel: "Diagnostics",
      }),
    );
    expect(html).toContain("Trouble anxieux généralisé");
    expect(html).toContain("106");
    expect(html).toContain("<table");
  });

  it("une mesure dont la bande est nulle reste lisible", () => {
    // Le barème peut rendre `interpretation = null` sur une administration
    // ancienne : la ligne doit dire « — », jamais casser le rendu.
    const html = renderToStaticMarkup(
      React.createElement(EchellesCliniques, {
        echelles: [
          {
            code: "PHQ9",
            nom: "PHQ-9 — dépression",
            n: 3,
            patientes: 2,
            bandes: [{ cle: null, n: 1 }],
            derniers: [],
            repetes: 0,
          },
        ],
        onMesure: () => undefined,
      }),
    );
    expect(html).toContain("PHQ-9");
    expect(html).toContain("—");
  });
});
