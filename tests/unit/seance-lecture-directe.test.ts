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

  it("la ligne séance du rail ne laisse plus la pastille recouvrir la date", () => {
    const bouton = PANNEAU.match(
      /<button\s+type="button"\s+onClick=\{\(\) => basculer\(e\.eventId\)\}[\s\S]*?className="([^"]*)"/,
    );
    expect(bouton, "bouton ligne séance introuvable").not.toBeNull();
    expect(bouton?.[1] ?? "", "la ligne doit passer sur deux rangées").toContain("flex-wrap");
    expect(PANNEAU, "pastille à taille fixe").toMatch(/<span[^>]*shrink-0[^>]*>\s*<Badge/);
  });
});
