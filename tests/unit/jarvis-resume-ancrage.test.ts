/**
 * Ancrage du « Résumé du cas » (§8/§9) — CE QUE LE MODÈLE NE PEUT PAS INVENTER.
 *
 * `assemblerSchema2` est la dernière porte avant `save_case_summary` : tout
 * ce qu'elle laisse passer est enregistré au dossier. Ce fichier fige ses
 * propriétés de sûreté, sans modèle, sans base :
 *
 * 1. TRI imposé ici, jamais demandé au prompt (récent → ancien, toujours).
 * 2. CITATIONS filtrées sur les ids de la porte 068 (un id inconnu perd sa
 *    source, jamais le résumé) et sur les six domaines de 053.
 * 3. PLAFONDS (8 périodes, 6 entrées/période) : un récit fleuve ne noie pas
 *    le traitement actuel.
 * 4. VIDE = refus (`null`) : sans récit, l'aperçu déterministe seul ne fait
 *    pas un résumé — la version précédente reste en place.
 * 5. APERÇU recopié, jamais rédigé : nom/âge/traitements viennent du socle.
 */

import { describe, expect, it } from "vitest";

import {
  assemblerSchema2,
  construireApercu,
  type Apercu,
} from "@/server/jarvis/resume-chronologie";

const APERCU: Apercu = {
  nom: "ESSAI",
  age: 40,
  residence: null,
  diagnostics: [],
  traitements: [{ texte: "Sertraline 50 mg", sources: [{ t: "prescription", id: "rx-1" }] }],
  contexte: [],
};

const IDS = new Set(["c-1", "c-2", "rx-1"]);

function item(texte: string, id = "c-1", t = "consultation") {
  return { texte, sources: [{ t, id }] };
}

describe("assemblerSchema2 — le temps est imposé, pas demandé", () => {
  it("trie les périodes récent → ancien même si le modèle les envoie à l'envers", () => {
    const brut = {
      chronologie: [
        { periode: "2024", entrees: [item("ancien")] },
        { periode: "2026-09", entrees: [item("récent")] },
        { periode: "2025", entrees: [item("milieu")] },
      ],
      anterieur: [],
      etat_actuel: [],
    };
    const r = assemblerSchema2(APERCU, brut, IDS);
    expect(r?.chronologie.map((p) => p.periode)).toEqual(["2026-09", "2025", "2024"]);
  });

  it("un id inconnu perd sa source, pas sa phrase — le résumé survit", () => {
    const brut = {
      chronologie: [],
      anterieur: [],
      etat_actuel: [item("Poursuite du traitement.", "id-invente-par-le-modele")],
    };
    const r = assemblerSchema2(APERCU, brut, IDS);
    expect(r?.etat_actuel).toHaveLength(1);
    expect(r?.etat_actuel[0]?.sources).toEqual([]);
    expect(r?.etat_actuel[0]?.texte).toBe("Poursuite du traitement.");
  });

  it("un domaine inconnu de 053 est refusé comme citation", () => {
    const brut = {
      chronologie: [],
      anterieur: [],
      etat_actuel: [item("Affirmation.", "c-1", "telepathie")],
    };
    const r = assemblerSchema2(APERCU, brut, IDS);
    expect(r?.etat_actuel[0]?.sources).toEqual([]);
  });

  it("les six domaines de 053 passent", () => {
    const brut = {
      chronologie: [],
      anterieur: [],
      etat_actuel: [
        item("a", "c-1", "diagnostic"),
        item("b", "c-1", "echelle"),
        item("c", "c-1", "prescription"),
        item("d", "c-2", "consultation"),
        item("e", "c-2", "rdv"),
        item("f", "c-2", "document"),
      ],
    };
    const r = assemblerSchema2(APERCU, brut, IDS);
    expect(r?.etat_actuel).toHaveLength(6);
  });

  it("plafond : 6 entrées par période, 8 périodes — le récit fleuve est coupé, pas le résumé", () => {
    const entrees = Array.from({ length: 20 }, (_, i) => item(`e${i}`));
    const periodes = Array.from({ length: 12 }, (_, i) => ({
      periode: `2026-${String(i + 1).padStart(2, "0")}`,
      entrees,
    }));
    const r = assemblerSchema2(APERCU, { chronologie: periodes, anterieur: [], etat_actuel: [] }, IDS);
    expect(r?.chronologie).toHaveLength(8);
    for (const p of r?.chronologie ?? []) expect(p.entrees.length).toBeLessThanOrEqual(6);
  });

  it("sans récit : null — l'aperçu seul n'écrase jamais la version précédente", () => {
    expect(assemblerSchema2(APERCU, { chronologie: [], anterieur: [], etat_actuel: [] }, IDS)).toBeNull();
    expect(assemblerSchema2(APERCU, null, IDS)).toBeNull();
    expect(assemblerSchema2(APERCU, "du texte hors JSON", IDS)).toBeNull();
  });

  it("l'aperçu traverse intact : le traitement du socle n'est ni réécrit ni perdu", () => {
    const r = assemblerSchema2(APERCU, { chronologie: [], anterieur: [], etat_actuel: [item("x")] }, IDS);
    expect(r?.apercu.traitements[0]?.texte).toBe("Sertraline 50 mg");
    expect(r?.schema).toBe(2);
  });
});

describe("construireApercu — recopié du socle, jamais rédigé", () => {
  it("nom, âge et traitements sont recopiés tels quels", () => {
    const a = construireApercu({
      identite: { first_name: "Nadia", last_name: "Belkacem", age: 34 },
      ordonnances: [],
    });
    expect(a?.nom).toContain("Nadia");
    expect(a?.nom).toContain("Belkacem");
    expect(a?.age).toBe(34);
  });

  it("un champ absent reste absent : jamais de devinette", () => {
    const a = construireApercu({ identite: { first_name: "Nadia", last_name: "Belkacem" } });
    expect(a?.age).toBeNull();
    expect(a?.traitements).toEqual([]);
  });

  it("sans identité : null — pas de résumé sans dossier", () => {
    expect(construireApercu(null)).toBeNull();
    expect(construireApercu({})).toBeNull();
    expect(construireApercu({ identite: { first_name: "", last_name: "" } })).toBeNull();
  });
});
