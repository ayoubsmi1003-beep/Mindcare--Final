/**
 * LE CONTRAT DE FRONTIÈRE ENTRE `get_patient_workspace` ET `resume-cas`.
 *
 * ═══ LE DÉFAUT QUE CES TESTS EMPÊCHENT DE REVENIR ═══
 *
 * La porte SQL émet du `snake_case` : `scale_name`, `derniere_consultation`,
 * `derniere_prescription`, `prochain_rendez_vous`, et l'identifiant de la
 * dernière passation d'échelle est NICHÉ dans `dernier.id` (migration 057).
 * `resume-cas.ts` lisait du `camelCase` et cherchait `e.id` à la racine.
 *
 * Rien ne plantait. `construireCandidats` rendait simplement une liste VIDE :
 * aucun signal d'échelle, aucun signal de prescription, aucune citation, et un
 * `sourceState` sans consultation ni prescription. Le résumé était généré, il
 * s'affichait, il était persisté — et il ne reposait sur presque rien. Une
 * relecture ne voit pas ce genre de défaut : les deux fichiers sont corrects
 * séparément, c'est leur RENCONTRE qui ne l'est pas.
 *
 * ⚠️ LES FIXTURES CI-DESSOUS ONT LA FORME EXACTE DE LA PORTE, relevée sur la
 * base réelle le 2026-08-30 (structure seulement — les valeurs sont inventées,
 * aucune donnée patient n'entre dans ce dépôt). Si la porte change de forme,
 * ces tests doivent tomber : c'est leur seule raison d'être.
 */
import { describe, expect, it } from "vitest";

import { adapterEspace, analyserEspacePorte } from "@/server/jarvis/contrat-workspace";
import {
  construireCandidats,
  DOMAINES_SOURCE,
  validerContenuResume,
} from "@/server/jarvis/resume-cas";

/** La forme RÉELLE de `clinique`/`traitements`/`agenda`, en snake_case. */
const CHARGE_PORTE = {
  clinique: {
    echelles: [
      {
        delta: -4,
        dernier: {
          id: "11111111-1111-4111-8111-111111111111",
          date: "2026-08-20",
          score: 8,
          interpretation: { libelle: "léger" },
        },
        precedent: { date: "2026-05-14", score: 12 },
        scale_code: "PHQ9",
        scale_name: "PHQ-9",
      },
    ],
    diagnostics: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        code: "F32.1",
        label: "Épisode dépressif moyen",
        is_primary: true,
        onset_date: "2025-11-02",
        code_system: "CIM-10",
        resolved_at: null,
      },
    ],
    nombre_consultations: 12,
    derniere_consultation: {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "suivi",
      status: "closed",
      ended_at: "2026-08-20T11:00:00+01:00",
      started_at: "2026-08-20T10:00:00+01:00",
      practitioner_name: "Dr Exemple",
    },
  },
  traitements: {
    nombre_prescriptions: 3,
    derniere_prescription: {
      id: "44444444-4444-4444-8444-444444444444",
      prescribed_at: "2026-01-05T09:00:00+01:00",
    },
  },
  agenda: {
    nombre_rendez_vous: 5,
    dernier_rendez_vous: {
      id: "55555555-5555-4555-8555-555555555555",
      starts_at: "2026-08-20T10:00:00+01:00",
    },
    prochain_rendez_vous: {
      id: "66666666-6666-4666-8666-666666666666",
      starts_at: "2026-09-15T10:00:00+01:00",
    },
  },
};

/**
 * La charge de la porte, remise telle quelle à `construireCandidats` — c'est
 * ce que faisait le code avant la frontière. Le passage par `unknown` est
 * l'unique cast, et il dit exactement ce qu'il fait : ces deux formes ne sont
 * PAS compatibles, et c'était tout le problème.
 */
function chargeNonAdaptee(): Parameters<typeof construireCandidats>[0] {
  const opaque: unknown = CHARGE_PORTE;
  return opaque as Parameters<typeof construireCandidats>[0];
}

describe("le schéma de la porte", () => {
  it("accepte la charge réelle en snake_case", () => {
    expect(analyserEspacePorte(CHARGE_PORTE).success).toBe(true);
  });

  it("REFUSE une charge camelCase — c'est exactement le défaut d'origine", () => {
    const camel = {
      clinique: {
        echelles: [{ scaleName: "PHQ-9", dernier: { score: 8, date: "2026-08-20" } }],
        diagnostics: [],
        derniereConsultation: { id: "x", startedAt: "2026-08-20T10:00:00+01:00" },
      },
      traitements: { dernierePrescription: null },
      agenda: { prochainRendezVous: null },
    };
    const analyse = analyserEspacePorte(camel);
    expect(analyse.success).toBe(false);
    // L'erreur doit NOMMER la cause, pas seulement constater un manque.
    expect(analyse.chemins?.join(",")).toContain("camelCase");
  });

  it("accepte l'absence de droit clinique — `clinique` et `traitements` à null", () => {
    const sansDroit = { clinique: null, traitements: null, agenda: CHARGE_PORTE.agenda };
    expect(analyserEspacePorte(sansDroit).success).toBe(true);
  });
});

describe("l'adaptation vers la forme interne", () => {
  it("remonte l'identifiant d'échelle depuis `dernier.id` (057)", () => {
    const espace = adapterEspace(CHARGE_PORTE);
    expect(espace.clinique?.echelles[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(espace.clinique?.echelles[0]?.scaleName).toBe("PHQ-9");
  });

  it("produit le signal d'écart d'échelle — VIDE avant la correction", () => {
    const { candidats } = construireCandidats(adapterEspace(CHARGE_PORTE));
    const echelle = candidats.find((c) => c.cle.startsWith("echelle:"));
    expect(echelle).toBeDefined();
    expect(echelle?.libelle).toContain("PHQ-9");
    // Le libellé reste FACTUEL : deux mesures datées, aucun mot de valence.
    expect(echelle?.libelle).not.toMatch(/amélior|aggrav|mieux|pire/i);
  });

  it("produit le signal « prescription antérieure à la dernière séance »", () => {
    const { candidats } = construireCandidats(adapterEspace(CHARGE_PORTE));
    expect(candidats.some((c) => c.cle.startsWith("prescription:"))).toBe(true);
  });

  it("ne fabrique aucun signal quand le droit clinique est absent", () => {
    const espace = adapterEspace({ clinique: null, traitements: null, agenda: CHARGE_PORTE.agenda });
    expect(construireCandidats(espace).candidats).toHaveLength(0);
  });
});

describe("la preuve que l'adaptation sert à quelque chose", () => {
  /**
   * ⚠️ NE PAS SUPPRIMER CES TESTS parce qu'ils « testent l'ancien code ». Ils
   * sont la seule chose qui empêche quelqu'un de retirer l'adaptation en la
   * croyant superflue.
   *
   * ET LE DÉFAUT EST PIRE QU'UN SIGNAL MANQUANT. Sur la charge brute,
   * `prochainRendezVous` est `undefined` — la clé s'appelle
   * `prochain_rendez_vous` — donc la règle 4 conclut « Aucun rendez-vous à
   * venir n'est fixé » ALORS QU'IL Y EN A UN. Ce n'est pas une omission, c'est
   * une AFFIRMATION FAUSSE, transmise au modèle comme un fait ancré, sur un
   * dossier clinique. Une donnée fabriquée est exactement ce que la règle 8
   * interdit.
   */
  it("la charge BRUTE fabrique un « aucun rendez-vous » FAUX", () => {
    const { candidats } = construireCandidats(chargeNonAdaptee());
    expect(candidats.some((c) => c.cle === "agenda:sans_prochain")).toBe(true);
  });

  it("la charge BRUTE ne produit NI signal d'échelle NI signal de prescription", () => {
    const { candidats } = construireCandidats(chargeNonAdaptee());
    expect(candidats.some((c) => c.cle.startsWith("echelle:"))).toBe(false);
    expect(candidats.some((c) => c.cle.startsWith("prescription:"))).toBe(false);
  });

  it("la MÊME charge, adaptée, ne prétend plus qu'il n'y a pas de rendez-vous", () => {
    const { candidats } = construireCandidats(adapterEspace(CHARGE_PORTE));
    expect(candidats.some((c) => c.cle === "agenda:sans_prochain")).toBe(false);
    expect(candidats.length).toBeGreaterThan(0);
  });
});

describe("le filtre de grounding échoue vide, jamais en levant", () => {
  /**
   * ⚠️ CE TEST VIENT D'UN 500 EN PRODUCTION, pas d'une hypothèse. La charge de
   * la porte a été passée à `validerContenuResume` telle quelle : le test
   * `derniereConsultation !== null` a laissé passer un `undefined`, et le `.id`
   * suivant a levé. Une fonction qui décide ce qu'un résumé a le droit de citer
   * ne doit jamais lever — elle doit restreindre.
   */
  it("ne lève pas sur une charge à la forme inattendue", () => {
    const opaque: unknown = CHARGE_PORTE;
    const inattendue = opaque as Parameters<typeof validerContenuResume>[1];
    expect(() => validerContenuResume({ en_bref: [] }, inattendue, [])).not.toThrow();
  });

  it("ne lève pas quand tout est absent", () => {
    const vide = { clinique: null, traitements: null, agenda: { prochainRendezVous: null } };
    expect(() => validerContenuResume({ en_bref: [] }, vide, [])).not.toThrow();
  });
});

describe("les domaines de citation", () => {
  /**
   * ⚠️ MESURÉ EN PRODUCTION LE 2026-08-30. Le modèle a émis une source d'un
   * type inventé ; la passerelle la castait sans vérifier, la porte refusait
   * alors le résumé ENTIER (`P0001 — Type de source inconnu.`), et la
   * praticienne n'obtenait rien. Une citation fautive doit coûter LA CITATION,
   * jamais le résumé.
   */
  it("écarte une source d'un domaine inventé, sans perdre l'item", () => {
    const dc = CHARGE_PORTE.clinique.derniere_consultation.id;
    const espace = adapterEspace(CHARGE_PORTE);
    const contenu = validerContenuResume(
      {
        en_bref: [
          {
            texte: "Un fait documenté.",
            sources: [
              { t: "hallucination", id: dc },
              { t: "consultation", id: dc },
            ],
          },
        ],
      },
      espace,
      [],
    );
    expect(contenu).not.toBeNull();
    const item = contenu?.en_bref[0];
    expect(item?.texte).toBe("Un fait documenté.");
    expect(item?.sources.map((s) => s.t)).toEqual(["consultation"]);
  });

  it("la liste des domaines reste celle de la migration 053", () => {
    expect([...DOMAINES_SOURCE]).toEqual([
      "diagnostic",
      "echelle",
      "prescription",
      "consultation",
      "rdv",
      "document",
    ]);
  });
});
