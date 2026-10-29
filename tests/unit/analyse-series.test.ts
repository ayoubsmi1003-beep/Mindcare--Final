/**
 * Les fonctions pures de l'écran Statistiques.
 *
 * ⚠️ CE QUI EST ÉPROUVÉ ICI EST DE LA PRÉSENTATION, PAS DU MÉTIER. Les comptes
 * et les fenêtres viennent de Postgres. Ce qui peut se tromper côté navigateur,
 * c'est un libellé de seau, un écart calculé sur un dénominateur nul, une
 * abscisse qui sort du cadre. Ces quatre défauts-là se voient à l'écran et ne
 * se voient pas en relecture.
 */
import { describe, expect, it } from "vitest";

import {
  ecart,
  formaterDate,
  formaterEcart,
  formaterNombre,
  indexLePlusProche,
  indicesEtiquettes,
  libelleSeau,
  numeroSemaineIso,
  plafondLisible,
  positionRelative,
  titreSeau,
} from "@/lib/analyse-series";

describe("formatage", () => {
  it("groupe les nombres à la française", () => {
    // U+202F (espace fine insécable) est ce que produit Intl ; on ne réécrit
    // pas le séparateur, on vérifie que le groupement a eu lieu.
    expect(formaterNombre(1558).replace(/\s/g, " ")).toBe("1 558");
  });

  it("écrit une date civile sans décaler d'un jour", () => {
    expect(formaterDate("2026-10-29")).toBe("29 oct. 2026");
  });
});

describe("libellés de seau", () => {
  it("donne un libellé différent par granularité", () => {
    const jour = libelleSeau("2026-10-29", "jour");
    const semaine = libelleSeau("2026-10-26", "semaine");
    const mois = libelleSeau("2026-10-01", "mois");
    expect(jour).toBe("29/10");
    expect(semaine).toBe("S44");
    expect(mois).toBe("oct 26");
    expect(new Set([jour, semaine, mois]).size).toBe(3);
  });

  it("numérote les semaines ISO, y compris au changement d'année", () => {
    // 2026-01-01 est un jeudi : semaine 1. 2025-12-29 (lundi) appartient à la
    // même semaine 1 de 2026 — c'est la définition ISO, pas un arrondi.
    expect(numeroSemaineIso(new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(numeroSemaineIso(new Date("2025-12-29T12:00:00Z"))).toBe(1);
    expect(numeroSemaineIso(new Date("2026-10-26T12:00:00Z"))).toBe(44);
  });

  it("nomme la semaine et le mois en toutes lettres dans l'infobulle", () => {
    expect(titreSeau("2026-10-26", "semaine")).toContain("Semaine du");
    expect(titreSeau("2026-10-01", "mois")).toBe("octobre 2026");
  });
});

describe("écart à la période précédente", () => {
  it("calcule un pourcentage signé", () => {
    expect(ecart(314, 214)).toEqual({ absolu: 100, pct: 46.7 });
    expect(ecart(159, 331)).toEqual({ absolu: -172, pct: -52 });
  });

  it("refuse de diviser par zéro", () => {
    // ⚠️ LE DÉFAUT QUE CE TEST FERME : « +100 % » calculé sur zéro séance.
    expect(ecart(12, 0)).toEqual({ absolu: 12, pct: null });
  });

  it("distingue « précédent absent » de « précédent nul »", () => {
    expect(ecart(12, null).pct).toBeNull();
    expect(ecart(0, 0)).toEqual({ absolu: 0, pct: null });
  });

  it("écrit le signe typographique, jamais un tiret", () => {
    expect(formaterEcart(12.4)).toBe("+12,4 %");
    expect(formaterEcart(-3)).toBe("−3 %");
    expect(formaterEcart(null)).toBe("—");
  });
});

describe("géométrie", () => {
  it("borne une position entre 0 et 100", () => {
    expect(positionRelative(5, 10)).toBe(50);
    expect(positionRelative(20, 10)).toBe(100);
    expect(positionRelative(-2, 10)).toBe(0);
  });

  it("rend null pour une valeur absente, jamais 0", () => {
    // Un trou n'est pas un plancher : la barre ne doit pas exister.
    expect(positionRelative(null, 10)).toBeNull();
  });

  it("arrondit le plafond d'axe au pas supérieur", () => {
    expect(plafondLisible(0)).toBe(1);
    expect(plafondLisible(27)).toBe(30);
    expect(plafondLisible(140)).toBe(150);
  });

  it("choisit au plus N abscisses, sans dépasser les bornes", () => {
    const idx = indicesEtiquettes(30, 7);
    expect(idx).toHaveLength(7);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(29);
  });

  it("trouve le point le plus proche, même hors cadre", () => {
    expect(indexLePlusProche(0, 300, 30)).toBe(0);
    expect(indexLePlusProche(150, 300, 30)).toBe(15);
    expect(indexLePlusProche(999, 300, 30)).toBe(29);
    expect(indexLePlusProche(10, 0, 30)).toBe(0);
  });
});
