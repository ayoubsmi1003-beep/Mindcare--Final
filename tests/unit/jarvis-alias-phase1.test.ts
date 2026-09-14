/**
 * Phase 1 du plan Alexa — alias compatibles + `get_system_status`.
 *
 * ═══ CE QUE CES TESTS GARDENT ═══
 * 1. Chaque alias DÉLÈGUE à une capacité réelle : même budget, même validation
 *    Zod (éprouvée par un appel qui échoue AVANT toute lecture), pas de
 *    requête propre.
 * 2. Les traductions d'arguments sont pures : renommage et élagage de clés,
 *    jamais de valeur inventée — et un non-objet traverse tel quel pour que
 *    le schéma de la cible le refuse proprement.
 * 3. Les trois noms de phase 2 NE SONT PAS offerts : le registre rend `null`
 *    dessus (chemin existant de proposition inconnue), et `estEnPhase2` les
 *    documente.
 * 4. `SafeSystemContext` est une liste blanche fermée : toute clé ajoutée à
 *    `projeterSysteme` fait tomber le test — ajouter un champ au modèle est
 *    un acte délibéré, pas un `...spread` distrait.
 *
 * ⚠️ AUCUNE DONNÉE PATIENT DANS CE FICHIER, AUCUN ACCÈS BASE. Les seuls
 * `lancer` exécutés échouent à la validation Zod, avant toute lecture —
 * c'est précisément ce qui prouve la délégation sans exiger de base.
 */
import { describe, expect, it } from "vitest";

import {
  ALIAS_CAPACITES,
  estEnPhase2,
} from "../../src/services/jarvis-alias";
import {
  capaciteLecture,
  descriptionDesCapacites,
  estCapaciteLecture,
  nomsDeLecture,
} from "../../src/services/jarvis-capacites";
import { CarteIdentite } from "../../src/services/jarvis-identite";
import { projeterSysteme } from "../../src/services/jarvis-projections";

function ctxTour() {
  return {
    carte: new CarteIdentite(),
    signal: new AbortController().signal,
    aujourdHui: "2026-09-03",
  };
}

describe("alias Phase 1 — délégation aux capacités réelles", () => {
  it("chaque alias cible une capacité enregistrée, avec son budget", () => {
    for (const [nom, alias] of Object.entries(ALIAS_CAPACITES)) {
      const cible = capaciteLecture(alias.cible);
      expect(cible, `cible de ${nom}`).not.toBeNull();
      const via = capaciteLecture(nom);
      expect(via, `alias ${nom}`).not.toBeNull();
      expect(via?.nom).toBe(nom);
      expect(via?.budgetOctets).toBe(cible?.budgetOctets);
      expect(via?.champsAttendus).toBe(cible?.champsAttendus);
      expect(estCapaciteLecture(nom)).toBe(true);
      expect(nomsDeLecture()).toContain(nom);
    }
  });

  it("un appel d'alias invalide échoue en regle-metier avant toute lecture", async () => {
    // `get_agenda` sans bornes → traduit en `{}` → le schéma strict de
    // `get_agenda_range` refuse, sans qu'aucune porte n'ait été frappée.
    const via = capaciteLecture("get_agenda");
    expect(via).not.toBeNull();
    const r = await via?.lancer({}, ctxTour());
    expect(r?.ok).toBe(false);
    if (r !== undefined && !r.ok) {
      const echec = r as { ok: false; error: { code: string } };
      expect(echec.error.code).toBe("regle-metier");
    }
  });

  it("les traductions renomment et élaguent, sans inventer de valeur", () => {
    expect(ALIAS_CAPACITES["get_agenda"]?.traduire({ date_from: "a", date_to: "b", praticien: "x" })).toEqual({
      du: "a",
      au: "b",
    });
    expect(ALIAS_CAPACITES["get_agenda"]?.traduire({ du: "a", au: "b" })).toEqual({
      du: "a",
      au: "b",
    });
    expect(ALIAS_CAPACITES["search_patient"]?.traduire({ q: "nad", limit: 99 })).toEqual({
      query: "nad",
    });
    expect(
      ALIAS_CAPACITES["get_patient_summary"]?.traduire({ patient_id: "{{PATIENT_001}}", extra: 1 }),
    ).toEqual({ patientId: "{{PATIENT_001}}" });
    expect(ALIAS_CAPACITES["get_finance_overview"]?.traduire({ period: "mois" })).toEqual({
      periode: "mois",
    });
    expect(ALIAS_CAPACITES["get_pending_payments"]?.traduire({ date: "2026-09-03" })).toEqual({
      jour: "2026-09-03",
    });
    expect(ALIAS_CAPACITES["get_next_appointment"]?.traduire({ parasite: 1 })).toEqual({});
    expect(ALIAS_CAPACITES["get_attention_items"]?.traduire("texte-libre")).toBe("texte-libre");
  });
});

describe("phase 2 — livrée : les trois noms sont des capacités réelles", () => {
  it.each(["get_consultation_history", "get_current_medications", "get_patient_financial_summary"])(
    "%s est au registre et n'est plus marqué phase 2",
    (nom) => {
      expect(estEnPhase2(nom)).toBe(false);
      expect(estCapaciteLecture(nom)).toBe(true);
      expect(capaciteLecture(nom)).not.toBeNull();
      expect(nomsDeLecture()).toContain(nom);
    },
  );

  it("les capacités réelles ne sont pas marquées phase 2", () => {
    expect(estEnPhase2("get_next_patient")).toBe(false);
    expect(estEnPhase2("get_system_status")).toBe(false);
  });
});

describe("get_system_status — enregistré, liste blanche", () => {
  it("est au registre avec un budget borne et aucun argument", () => {
    const cap = capaciteLecture("get_system_status");
    expect(cap).not.toBeNull();
    expect(cap?.budgetOctets).toBe(800);
    expect(cap?.champsAttendus).toBe("aucun argument");
    expect(estCapaciteLecture("get_system_status")).toBe(true);
  });

  it("projeterSysteme ne rend que des champs non identifiants", () => {
    const projete = projeterSysteme({
      environnement: "cloud-dev",
      aujourdHui: "2026-09-03",
      maintenant: "2026-09-03T10:00:00+01:00",
      entreesCarte: 2,
    });
    expect(Object.keys(projete).sort()).toEqual(
      ["aujourdHui", "entreesCarte", "environnement", "maintenant", "provenance"].sort(),
    );
    expect(projete.environnement).toBe("cloud-dev");
    expect(projete.entreesCarte).toBe(2);
    expect(projete.provenance).toHaveLength(1);
  });
});

describe("descriptions — générées depuis le registre, jamais recopiées", () => {
  it("listent les alias comme alias et le statut système", () => {
    const texte = descriptionDesCapacites();
    expect(texte).toContain("- get_agenda : Alias de get_agenda_range.");
    expect(texte).toContain("- get_next_appointment : Alias de get_next_patient.");
    expect(texte).toContain("- get_system_status :");
  });
});
