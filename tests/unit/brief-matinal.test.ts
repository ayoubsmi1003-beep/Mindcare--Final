import { describe, expect, it } from "vitest";
import { preparerEntreeBriefMatinal } from "@/services/brief-matinal";
import type { TableauDeBord } from "@/services/dashboard";
import { CarteIdentite } from "@/services/jarvis-identite";

const TABLEAU: TableauDeBord = {
  seanceOuverte: null,
  journee: [],
  suivant: null,
  attenteNombre: 2,
  encaisse: { montantDzd: 12000, seances: 3, perimetre: "cabinet" },
  nouveauxPatientsMois: 5,
  propositions: [],
  genereA: "2026-09-17T07:00:00+01:00",
};

describe("preparerEntreeBriefMatinal", () => {
  it("projette l'agenda depuis dashboard_today avec provenance", () => {
    const entree = preparerEntreeBriefMatinal(TABLEAU, "2026-09-17", "2026-09-17T07:00:00.000Z", new CarteIdentite());
    expect(entree.enAttente).toBe(2);
    expect(entree.agenda.creneaux).toEqual([]);
    expect(entree.agenda.provenance).toHaveLength(1);
    const prov = entree.agenda.provenance[0];
    expect(prov).toBeDefined();
    expect(prov?.porte).toBe("app.dashboard_today");
    expect(prov?.tronque).toBe(false);
    expect(typeof prov?.luA).toBe("string");
    expect(Number.isNaN(Date.parse(prov?.luA ?? ""))).toBe(false);
  });

  it("porte la caisse telle quelle, jamais zéro par défaut", () => {
    const entree = preparerEntreeBriefMatinal(TABLEAU, "2026-09-17", "2026-09-17T07:00:00.000Z", new CarteIdentite());
    expect(entree.finance?.encaisseDzd).toBe(12000);
    expect(entree.finance?.perimetre).toBe("cabinet");
    expect(entree.finance?.enAttenteDzd).toBe(0);
    expect(entree.finance?.provenance).toEqual([
      { porte: "app.dashboard_today", luA: "2026-09-17T07:00:00.000Z", tronque: false },
    ]);
  });

  it("hors périmètre financier → finance nulle, jamais recette nulle (ADR-005)", () => {
    const entree = preparerEntreeBriefMatinal(
      { ...TABLEAU, encaisse: null },
      "2026-09-17",
      "2026-09-17T07:00:00.000Z",
      new CarteIdentite(),
    );
    expect(entree.finance).toBeNull();
  });
});
