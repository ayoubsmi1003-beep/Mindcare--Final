import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PatientWorkspace } from "@/services/patients";

let DepuisDerniere: typeof import("@/components/consultation/cockpit/DepuisDerniere").DepuisDerniere;
let PointDeSituation: typeof import("@/components/patients/SectionsDeterministes").PointDeSituation;
let SectionDepuisDerniere: typeof import("@/components/patients/SectionsDeterministes").SectionDepuisDerniere;
let ListeSignaux: typeof import("@/components/patients/SectionsDeterministes").ListeSignaux;

beforeAll(async () => {
  // Vitest uses the classic JSX runtime; the app uses Next's automatic runtime.
  vi.stubGlobal("React", React);
  ({ DepuisDerniere } = await import("@/components/consultation/cockpit/DepuisDerniere"));
  ({ PointDeSituation, SectionDepuisDerniere, ListeSignaux } = await import(
    "@/components/patients/SectionsDeterministes"
  ));
});
afterAll(() => vi.unstubAllGlobals());

function workspace(): PatientWorkspace {
  return {
    contrat: 1, genereA: "2026-10-03T10:00:00+01:00",
    identite: { id: "test", recordNumber: "TEST", firstName: "Fixture", lastName: "Test", birthDate: null, age: null, sex: null, maritalStatus: null, isActive: true },
    contact: { phone: "", phoneAlt: null, address: null, emergencyContact: null },
    identification: { idDocumentNumber: null, idDocumentIssuer: null }, admin: { notesAdmin: null },
    clinique: { diagnostics: [], echelles: [], derniereConsultation: null, nombreConsultations: 0 },
    traitements: { dernierePrescription: null, nombrePrescriptions: 0 }, traitementsV2: null,
    agenda: { prochainRendezVous: null, dernierRendezVous: null, nombreRendezVous: 0 },
    documents: { nombre: 0, dernierEmisLe: null }, rendezVousDuJour: [], resume: null,
  };
}

function html(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("repères de consultation — absence et provenance", () => {
  it("does not assert the absence of review points when the summary is unavailable", () => {
    const text = html(React.createElement(DepuisDerniere, { espace: workspace() }));
    expect(text).toContain("Points à vérifier indisponibles");
    expect(text).not.toContain("Aucun signal à examiner");
  });

  it("names empty records instead of rendering anonymous dashes", () => {
    const text = html(
      React.createElement(PointDeSituation, { espace: workspace(), compact: true }),
    );
    expect(text).toContain("Aucune prescription enregistrée");
    expect(text).toContain("Aucun rendez-vous programmé");
    expect(text).toContain("Aucune évaluation enregistrée");
  });

  it("does not describe inaccessible clinical domains as empty", () => {
    const text = html(
      React.createElement(PointDeSituation, {
        espace: { ...workspace(), clinique: null, traitements: null },
        compact: true,
      }),
    );
    expect(text).toContain("Données cliniques indisponibles");
    expect(text).toContain("Prescriptions indisponibles");
    expect(text).not.toContain("Aucune prescription enregistrée");
    expect(text).not.toContain("Premier passage documenté");
  });

  it("ne conserve QUE les points à vérifier dans le rail, sans redoubler le point de situation", () => {
    const w = workspace();
    const text = html(
      React.createElement(DepuisDerniere, {
        espace: {
          ...w,
          resume: {
            id: "summary", version: 1, genereLe: "2026-10-02T09:00:00+01:00", generePar: null, aJour: false,
            contenu: { schema: 1, enBref: [], evolutionRecente: [], aDiscuter: [{ texte: "Vérifier le document rapporté", sources: [{ t: "document", id: "doc" }] }], dernierEtat: null, traitementsDocumentes: [], pointsAttention: [] },
          },
        },
      }),
    );
    expect(text).toContain("Vérifier le document rapporté");
    expect(text).toContain("Résumé du cas");
    expect(text).toContain("Données modifiées depuis ce résumé");
    expect(text).not.toContain("Depuis la dernière consultation");
    expect(text).not.toContain("Derniers repères");
  });

  it("preserves schema 2 review text and does not invent a score for null", () => {
    const w = workspace();
    const espace: PatientWorkspace = {
      ...w,
      clinique: {
        ...w.clinique!,
        echelles: [{ scaleCode: "PHQ9", scaleName: "PHQ-9", dernier: { score: null, date: "2026-10-02", interpretation: null }, precedent: null, delta: null }],
      },
      resume: {
        id: "summary", version: 2, genereLe: "2026-10-02T09:00:00+01:00", generePar: null, aJour: true,
        contenu: { schema: 2, apercu: { nom: "Fixture", age: null, residence: null, diagnostics: [], traitements: [], contexte: [] }, chronologie: [], anterieur: [], etatActuel: [{ texte: "Document à relire", sources: [{ t: "document", id: "doc" }] }] },
      },
    };
    const text = html(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ListeSignaux, { espace, compact: true }),
        React.createElement(PointDeSituation, { espace, compact: true }),
      ),
    );
    expect(text).toContain("Document à relire");
    expect(text).toContain("Score non renseigné");
    expect(text).not.toContain("PHQ-9 0");
  });

  it("distinguishes an available empty summary from a missing summary", () => {
    const text = html(
      React.createElement(ListeSignaux, {
        espace: {
          ...workspace(),
          resume: {
            id: "summary", version: 1, genereLe: "2026-10-02T09:00:00+01:00", generePar: null, aJour: true,
            contenu: { schema: 1, enBref: [], evolutionRecente: [], aDiscuter: [], dernierEtat: null, traitementsDocumentes: [], pointsAttention: [] },
          },
        },
        compact: true,
      }),
    );
    expect(text).toContain("Aucun point à vérifier dans ce résumé");
    expect(text).not.toContain("Points à vérifier indisponibles");
  });

  it("shows only changes after the reference consultation, with dates and scores", () => {
    const w = workspace();
    const espace: PatientWorkspace = {
      ...w,
      clinique: {
        ...w.clinique!,
        derniereConsultation: { id: "consultation", startedAt: "2026-10-01T09:00:00+01:00", endedAt: "2026-10-01T10:00:00+01:00", status: "closed", kind: null, practitionerName: null },
        echelles: [{ scaleCode: "PHQ9", scaleName: "PHQ-9", dernier: { score: 0, date: "2026-10-02", interpretation: null }, precedent: null, delta: null }],
      },
      traitements: { nombrePrescriptions: 1, dernierePrescription: { id: "prescription", prescribedAt: "2026-09-30T09:00:00+01:00", isHandwritten: false, practitionerName: null, lignes: [] } },
      documents: { nombre: 1, dernierEmisLe: "2026-10-03T09:00:00+01:00" },
      agenda: { ...w.agenda, prochainRendezVous: { id: "appointment", startsAt: "2026-10-10T09:00:00+01:00", endsAt: "2026-10-10T10:00:00+01:00", status: "scheduled", kind: null, practitionerName: null } },
    };
    const changes = html(
      React.createElement(SectionDepuisDerniere, { espace, compact: true }),
    );
    expect(changes).toContain("PHQ-9");
    expect(changes).toContain("02/10/2026");
    expect(changes).toContain("03/10/2026");
    expect(changes).not.toContain("Dernière prescription");

    const situation = html(
      React.createElement(PointDeSituation, { espace, compact: true }),
    );
    expect(situation).toContain("PHQ-9 · 0");
    expect(situation).not.toContain("Aucun rendez-vous programmé");
  });
});
