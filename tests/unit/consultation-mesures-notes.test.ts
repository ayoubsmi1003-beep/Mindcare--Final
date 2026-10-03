import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { ajouterPiste } from "../../src/components/consultation/cockpit/modele-cockpit";
import type { CleMesure } from "../../src/components/consultation/cockpit/MesuresSeance";

// Exécuter le callback réel sans monter les fournisseurs Next/voix/dossier.
// Le test détecte son effet clinique, sans recopier sa logique dans un modèle.
const cheminPage = new URL("../../src/app/consultation/[id]/page.tsx", import.meta.url);
const source = ts.createSourceFile(
  cheminPage.pathname,
  readFileSync(cheminPage, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let callback: ts.FunctionDeclaration | undefined;
function trouverCallback(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "appliquerMesure") {
    callback = node;
  }
  ts.forEachChild(node, trouverCallback);
}
trouverCallback(source);
if (callback === undefined) throw new Error("Callback de mesure introuvable");
const code = ts.transpileModule(callback.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const notesInitiales = {
  brut: "Brouillon de séance rédigé librement.",
  subjective: "Sommeil : 7/10\nTexte conservé de la praticienne.",
  objective: "Observation libre.",
  assessment: "Évaluation libre.",
  plan: "Conduite libre.",
};

function ouvrirCallback(noteModifiable = true, seanceClose = false) {
  let mesures: Record<CleMesure, number | null> = { anxiete: null, sommeil: null, humeur: null };
  const notes = { ...notesInitiales };
  const ecritures: unknown[] = [];
  const choisir = runInNewContext(`${code}\nappliquerMesure`, {
    noteModifiable,
    seanceClose,
    LIBELLES_MESURE: { anxiete: "Anxiété", sommeil: "Sommeil", humeur: "Humeur" },
    ajouterPiste,
    soap: notes,
    setMesures: (modifier: (courant: typeof mesures) => typeof mesures) => {
      mesures = modifier(mesures);
    },
    enregistrerSoap: (champ: "subjective" | "objective" | "assessment" | "plan", texte: string) => {
      notes[champ] = texte;
      ecritures.push({ champ, texte });
    },
    enregistrerBrut: (texte: string) => {
      notes.brut = texte;
      ecritures.push({ brut: texte });
    },
  }) as (cle: CleMesure, valeur: number) => void;
  return { choisir, notes, ecritures, mesures: () => mesures };
}

describe("curseurs de consultation et notes libres", () => {
  it("change les trois mesures sans modifier ni enregistrer les cinq notes", () => {
    const page = ouvrirCallback();
    page.choisir("sommeil", 4);
    page.choisir("anxiete", 8);
    page.choisir("humeur", 6);

    expect(page.mesures()).toEqual({ anxiete: 8, sommeil: 4, humeur: 6 });
    expect(page.notes).toEqual(notesInitiales);
    expect(page.ecritures).toEqual([]);
  });

  it.each([
    { noteModifiable: false, seanceClose: false, etat: "note verrouillée" },
    { noteModifiable: true, seanceClose: true, etat: "séance close" },
  ])("ignore une mesure pour une $etat", ({ noteModifiable, seanceClose }) => {
    const page = ouvrirCallback(noteModifiable, seanceClose);
    page.choisir("sommeil", 7);

    expect(page.mesures()).toEqual({ anxiete: null, sommeil: null, humeur: null });
    expect(page.notes).toEqual(notesInitiales);
    expect(page.ecritures).toEqual([]);
  });
});
