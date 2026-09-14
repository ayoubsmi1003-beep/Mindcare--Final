/**
 * `jarvis-recette-encaisse.test.ts` — « ENCAISSÉ » VEUT DIRE ENCAISSÉ.
 *
 * ═══ LE DÉFAUT QUE CES TESTS FIGENT ═══
 * Mesuré au navigateur le 2026-09-06, deux portes du MÊME produit sur le MÊME
 * jour et les MÊMES bornes `Africa/Algiers` :
 *
 *     app.dashboard_today.encaisse  →  27 000 DA   (collected_at IS NOT NULL)
 *     Alexa, « combien ai-je encaissé aujourd'hui ? » → 74 000 DA
 *
 * `projeterRecetteDuJour` recopiait `total_dzd` — la somme de TOUS les
 * paiements du jour, encaissés ou non — dans un champ nommé `encaisseDzd`. Les
 * 47 000 DA d'écart étaient l'IMPAYÉ, annoncé à la praticienne comme de
 * l'argent en caisse.
 *
 * ⚠️ LES DEUX NOMBRES N'ONT PAS ÉTÉ RENDUS ÉGAUX, ET NE DOIVENT PAS L'ÊTRE :
 * facturé et encaissé sont deux mesures distinctes, toutes deux légitimes. Ce
 * qui était faux, c'était l'ÉTIQUETTE. Le contrat de `SafeFinanceContext` le
 * disait déjà noir sur blanc — « le mot “encaissé” est choisi, pas subi » — et
 * c'est l'implémentation qui avait dévié.
 *
 * Fixtures synthétiques, aucun accès base.
 */

import { describe, expect, it } from "vitest";

import { projeterRecetteDuJour } from "@/services/jarvis-projections";

/** Les chiffres RÉELS mesurés le 2026-09-06 sur la base de développement. */
const MESURE = { totalDzd: 74_000, attenteDzd: 47_000, encaisseAttendu: 27_000 };

function recette(totalDzd: number, attenteDzd: number) {
  return {
    totalDzd,
    seances: 6,
    attenteNombre: 3,
    attenteDzd,
    perimetre: "cabinet" as const,
  };
}

const PERIODE = { nom: "jour" as const, du: "2026-09-06", au: "2026-09-06" };

describe("recette du jour — encaissé ≠ facturé", () => {
  it("rend l'ENCAISSÉ, pas le facturé (le cas mesuré)", () => {
    const p = projeterRecetteDuJour(recette(MESURE.totalDzd, MESURE.attenteDzd), PERIODE);
    expect(p.encaisseDzd).toBe(MESURE.encaisseAttendu);
    // La valeur que `app.dashboard_today` rend déjà pour le même jour.
    expect(p.encaisseDzd).toBe(27_000);
    // Et surtout : PLUS le total facturé.
    expect(p.encaisseDzd).not.toBe(MESURE.totalDzd);
  });

  it("l'attente reste un chiffre SÉPARÉ, jamais fondu dans l'encaissé", () => {
    const p = projeterRecetteDuJour(recette(MESURE.totalDzd, MESURE.attenteDzd), PERIODE);
    expect(p.enAttenteDzd).toBe(47_000);
    // L'invariant comptable : encaissé + attente = facturé. Il doit tenir sans
    // que les deux premiers soient jamais confondus.
    expect(p.encaisseDzd + p.enAttenteDzd).toBe(MESURE.totalDzd);
  });

  it("tout encaissé : l'attente est nulle et l'encaissé vaut le total", () => {
    const p = projeterRecetteDuJour(recette(50_000, 0), PERIODE);
    expect(p.encaisseDzd).toBe(50_000);
    expect(p.enAttenteDzd).toBe(0);
  });

  it("rien d'encaissé : l'encaissé est ZÉRO, pas le total", () => {
    // Le cas le plus dangereux : une journée entièrement impayée annoncée
    // comme une bonne journée de caisse.
    const p = projeterRecetteDuJour(recette(50_000, 50_000), PERIODE);
    expect(p.encaisseDzd).toBe(0);
    expect(p.enAttenteDzd).toBe(50_000);
  });

  it("journée vide : zéro partout, jamais un NaN", () => {
    const p = projeterRecetteDuJour(recette(0, 0), PERIODE);
    expect(p.encaisseDzd).toBe(0);
    expect(p.enAttenteDzd).toBe(0);
  });

  it("les montants restent des ENTIERS en dinars (ADR-018)", () => {
    const p = projeterRecetteDuJour(recette(MESURE.totalDzd, MESURE.attenteDzd), PERIODE);
    expect(Number.isInteger(p.encaisseDzd)).toBe(true);
    expect(Number.isInteger(p.enAttenteDzd)).toBe(true);
  });

  it("la provenance nomme toujours la porte réelle", () => {
    const p = projeterRecetteDuJour(recette(1_000, 0), PERIODE);
    expect(p.provenance[0]?.porte).toBe("app.day_revenue");
  });
});
