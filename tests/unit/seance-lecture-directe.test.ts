/**
 * Lecture directe des séances précédentes — garde-fous.
 *
 * Exigence : un clic sur la date d'une séance précédente montre TOUTES ses
 * notes en lecture directe (brut + SOAP + analyse), sans second clic par
 * rubrique. Et la pastille « Consultation terminée » ne recouvre plus la
 * date dans le rail étroit (~21rem). Données écrites à la main, aucune PII.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DETAIL = readFileSync(
  join(process.cwd(), "src/components/consultation/DetailSeanceAccordion.tsx"),
  "utf8",
);
const PANNEAU = readFileSync(
  join(process.cwd(), "src/components/consultation/PanneauHistorique.tsx"),
  "utf8",
);
const CARTE = readFileSync(
  join(process.cwd(), "src/components/consultation/CarteSeancePasse.tsx"),
  "utf8",
);
const CHRONO = readFileSync(
  join(process.cwd(), "src/components/patients/ChronologiePatient.tsx"),
  "utf8",
);

describe("séance précédente en lecture directe", () => {
  it("DetailSeanceAccordion ne replie plus les rubriques une par une", () => {
    // Un seul niveau de pli (la séance) : aucune bascule par section.
    expect(DETAIL, "bascule par section").not.toContain("onBasculerSection");
    expect(DETAIL, "section ouverte unique").not.toContain("sectionOuverte");
    expect(DETAIL, "bouton dépliable").not.toContain("aria-expanded");
    expect(DETAIL, "aperçu tronqué 90 signes").not.toContain("apercu(");
    // Le texte intégral reste affiché en lecture seule.
    expect(DETAIL, "texte intégral").toContain("whitespace-pre-wrap");
  });

  it("PanneauHistorique ne garde aucun état de section dépliée", () => {
    expect(PANNEAU, "état sections").not.toContain("sectionsOuvertes");
    expect(PANNEAU, "bascule section").not.toContain("basculerSection");
    expect(PANNEAU, "première section auto").not.toContain("premiereSection");
  });

  it("ChronologiePatient ne garde aucun état de section dépliée", () => {
    expect(CHRONO, "état section").not.toContain("sectionOuverte");
    expect(CHRONO, "première section auto").not.toContain("premiereSection");
  });

  it("garde une date de séance lisible quand la carte se replie dans le rail étroit", () => {
    expect(PANNEAU, "l'historique doit rendre la carte de séance").toContain("CarteSeancePasse");
    expect(CARTE, "l'en-tête doit autoriser le retour à la ligne").toMatch(
      /<header className="flex flex-wrap items-start justify-between/u,
    );
    expect(CARTE, "la date doit rester dans un bloc réductible").toContain(
      'className="flex min-w-0 items-center gap-3"',
    );
    expect(CARTE, "les repères de séance doivent pouvoir se replier").toContain(
      'className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-label text-ink-500"',
    );
  });
});
