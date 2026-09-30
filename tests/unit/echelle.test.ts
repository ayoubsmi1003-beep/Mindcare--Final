/**
 * LES ÉCHELLES — des graduations rondes, et deux domaines qui ne se mentent pas.
 *
 * POURQUOI CE FICHIER EXISTE. Le graphique « Évolution » shared `echelleSignee` :
 * elle posait le plafond à `haut + étendue × 12 %` et interpolait ensuite cinq
 * graduations ENTRE le plafond et le plancher. Sur les données réelles de l'écran
 * (six mois, quatre à zéro, un mois très déficitaire) l'axe affichait
 *
 *     185 380 · 101 660 · 17 940 · −65 780 · −149 500
 *
 * Aucun de ces nombres n'est rond. Aucun n'est comparable au précédent d'un
 * coup d'œil. Et comme le domaine englobait la ligne du résultat net — une
 * différence, qui peut être négative — les deux barres se retrouvaient
 * écrasées dans le tiers supérieur d'une aire à moitié vide.
 *
 * Ce module sépare donc deux questions que l'ancien conflait :
 *
 *   · `echelleBarres` — un domaine TOUJOURS positif, parce que recettes et
 *     charges ne peuvent pas être négatives, et une comparaison de hauteurs qui
 *     reste exacte entre les deux séries.
 *   · `echelleNette` — un domaine signé et SYMÉTRIQUE autour de zéro, parce
 *     qu'une différence se lit comme un écart à l'équilibre, pas comme une
 *     hauteur comparable à celle d'une recette.
 *
 * Aucun React, aucun DOM : c'est de l'arithmétique, elle se teste seule.
 */
import { describe, expect, it } from "vitest";

import { echelleBarres, echelleNette, graduations, pasJoli } from "@/components/ui/echelle";

describe("pasJoli — un pas de 1 / 2 / 2,5 / 5 × 10ⁿ", () => {
  it("tombe sur une graduation lisible, jamais sur un nombre arbitraire", () => {
    // Les quatre valeurs que l'ancien axe produisait, ramenées à un pas.
    expect(pasJoli(46345)).toBe(50000); // → 0 / 50k / 100k / 150k / 200k
    expect(pasJoli(3)).toBe(5);
    expect(pasJoli(7)).toBe(10);
    expect(pasJoli(1)).toBe(1);
    expect(pasJoli(0.4)).toBe(0.5);
  });

  it("couvre la valeur demandée, sans jamais un cran de trop", () => {
    for (const cible of [1, 3, 7, 9, 12, 34, 67, 99, 150, 480, 1234, 98765]) {
      expect(pasJoli(cible), `pasJoli(${cible})`).toBeGreaterThanOrEqual(cible);
      // Un pas dix fois trop grand ne donnerait que deux graduations sur toute
      // la hauteur : l'axe perdrait sa fonction de repère.
      expect(pasJoli(cible), `pasJoli(${cible})`).toBeLessThan(cible * 10);
    }
  });

  it("reste défini quand la cible est nulle — une série entièrement à zéro", () => {
    expect(pasJoli(0)).toBeGreaterThan(0);
  });
});

describe("graduations — du plus petit au plus grand, en valeurs rondes", () => {
  it("cinq repères sur une échelle de montants ronds", () => {
    // L'équivalent des repères 0 / 85 / 170 / 255 / 340 de la maquette 21st.dev.
    expect(graduations(0, 200000, 4)).toEqual([0, 50000, 100000, 150000, 200000]);
  });

  it("chaque graduation est un multiple entier du pas", () => {
    const g = graduations(-130000, 40000, 4);
    const pas = pasJoli(170000 / 4);
    for (const v of g) {
      expect(Number.isInteger(v / pas), `${v} n'est pas un multiple de ${pas}`).toBe(true);
    }
  });

  it("jamais de graduation fractionnaire — les montants sont des entiers DZD", () => {
    // `amount_dzd` est un `integer` (CLAUDE.md §5). Un axe qui proposerait « 0,5 »
    // afficherait un demi-dinar, et deux repères se formateraient à l'identique
    // sous `maximumFractionDigits: 0`.
    const g = graduations(0, 1, 4);
    expect(g).toEqual([0, 1]);
    for (const v of graduations(0, 100000, 5)) {
      expect(Number.isInteger(v), `${v} n'est pas entier`).toBe(true);
    }
  });

  it("encadre les valeurs, sans trou ni doublon", () => {
    const g = graduations(-130000, 40000, 4);
    expect(g[0]).toBeLessThanOrEqual(-130000);
    expect(g[g.length - 1]).toBeGreaterThanOrEqual(40000);
    const pas = g[1]! - g[0]!;
    for (let i = 1; i < g.length; i += 1) {
      expect(g[i]! - g[i - 1]!).toBe(pas);
    }
  });
});

describe("echelleBarres — un domaine toujours positif", () => {
  const SIX_MOIS = [17940, 0, 0, 0, 185380, 105000]; // le cas réel de l'écran

  it("le plancher est TOUJOURS zéro, même avec un résultat net négatif", () => {
    // C'était le défaut : les barres régnaient sur une échelle signée, alors
    // qu'une charge ne peut pas être négative. Un mois déficitaire étirait donc
    // l'aire vers le bas et écrasait les deux séries qui, elles, se comparent.
    const ech = echelleBarres([...SIX_MOIS, -130000]);
    expect(ech.bas).toBe(0);
    expect(ech.y(0)).toBe(100);
  });

  it("le plafond est rond, et il laisse de la respiration", () => {
    const ech = echelleBarres(SIX_MOIS);
    expect(ech.plafond % 50000).toBe(0);
    // La barre maximale ne doit PAS toucher le bord supérieur : elle se lirait
    // comme un débordement du cadre plutôt que comme un maximum.
    expect(ech.plafond).toBeGreaterThan(Math.max(...SIX_MOIS));
    expect(ech.y(185380)).toBeGreaterThan(0);
  });

  it("une hauteur est PROPORTIONNELLE à sa valeur — la comparaison reste exacte", () => {
    const ech = echelleBarres(SIX_MOIS);
    const hauteur = (v: number): number => ech.y(0) - ech.y(v);
    // Deux fois plus de charges que de recette → deux fois plus haut. C'est
    // toute la raison d'être d'un domaine partagé : si ce rapport bougeait, la
    // comparaison entre les deux séries s'arrêterait d'être vraie à l'écran.
    expect(hauteur(80000) / hauteur(40000)).toBeCloseTo(2, 6);
    expect(hauteur(0)).toBe(0);
  });

  it("une série entièrement à zéro ne produit ni NaN ni une infinité", () => {
    const ech = echelleBarres([0, 0, 0]);
    expect(ech.plafond).toBeGreaterThan(0);
    expect(Number.isFinite(ech.y(0))).toBe(true);
  });
});

describe("echelleNette — un domaine signé, symétrique autour de zéro", () => {
  it("le zéro est à mi-hauteur, quelle que soit la répartition", () => {
    // Asymétrique en données (−130 000 contre +40 000) : la symétrie garde la
    // « ligne d'équilibre » au milieu de la bande, donc l'écart se lit dans les
    // deux sens sans qu'un mois favorable occupe trois fois la place d'un mois
    // déficitaire.
    const ech = echelleNette([-130000, 40000, 0]);
    expect(ech.plafond).toBe(-ech.plancher);
    expect(ech.zero).toBe(50);
  });

  it("conserve les deux signes — un mois déficitaire reste SOUS la règle", () => {
    // L'ancien code écrasait les négatifs à zéro : le mois déficitaire se
    // couchait sur l'axe et se lisait comme un mois à l'équilibre. Sur un
    // graphique d'argent, c'est un mensonge.
    const ech = echelleNette([-130000, 40000]);
    expect(ech.y(-130000)).toBeGreaterThan(ech.y(0));
    expect(ech.y(40000)).toBeLessThan(ech.y(0));
  });

  it("le plafond et le plancher sont ronds", () => {
    const ech = echelleNette([-130000, 40000]);
    const pas = pasJoli(130000 / 2);
    // Rapport et non modulo : en JavaScript `-200000 % 100000` vaut `-0`, que
    // `Object.is` distingue de `0` alors que la graduation est bien ronde.
    expect(ech.plafond / pas, `${ech.plafond} / ${pas}`).toBe(Math.round(ech.plafond / pas));
    expect(ech.plancher / pas, `${ech.plancher} / ${pas}`).toBe(Math.round(ech.plancher / pas));
  });

  it("une série entièrement à zéro ne produit ni NaN ni une infinité", () => {
    const ech = echelleNette([0, 0, 0]);
    expect(ech.zero).toBe(50);
    expect(Number.isFinite(ech.y(0))).toBe(true);
  });
});
