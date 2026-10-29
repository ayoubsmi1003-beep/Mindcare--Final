import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResumeEtat } from "@/components/patients/CarteResumeCas";

let CarteResumeCas: typeof import("@/components/patients/CarteResumeCas").CarteResumeCas;

beforeAll(async () => {
  vi.stubGlobal("React", React);
  ({ CarteResumeCas } = await import("@/components/patients/CarteResumeCas"));
});
afterAll(() => vi.unstubAllGlobals());

describe("Résumé du cas — diagnostics documentés", () => {
  it("shows the stored diagnosis snapshot as a readable paragraph", () => {
    const etat: ResumeEtat = {
      generationEnCours: false,
      indisponible: false,
      resume: {
        id: "summary-1",
        version: 2,
        genereLe: "2026-10-29T10:00:00Z",
        generePar: null,
        aJour: true,
        contenu: {
          schema: 2,
          apercu: {
            nom: "Patiente fictive",
            age: null,
            residence: null,
            diagnostics: [
              { texte: "Trouble anxieux actualisé (depuis le 2026-08-01)", sources: [{ t: "diagnostic", id: "diagnostic-active" }] },
              { texte: "Trouble panique (résolu le 2026-09-15)", sources: [{ t: "diagnostic", id: "diagnostic-resolved" }] },
            ],
            traitements: [],
            contexte: [{ texte: "Un suivi régulier est documenté.", sources: [{ t: "consultation", id: "consultation-1" }] }],
          },
          chronologie: [],
          anterieur: [],
          etatActuel: [],
        },
      },
    };

    const html = renderToStaticMarkup(React.createElement(CarteResumeCas, {
      etat,
      onEtatChange: () => {},
      onOuvrirSource: () => {},
      onGenerer: () => {},
    }));

    expect(html).toMatch(/<p\b[^>]*>Le dossier mentionne notamment les diagnostics suivants : Trouble anxieux actualisé \(depuis le 2026-08-01\); Trouble panique \(résolu le 2026-09-15\)\.<\/p>/u);
    expect(html).not.toContain("<ul");
  });
});
