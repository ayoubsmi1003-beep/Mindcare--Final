/**
 * `jarvis-catalogue-synthese.test.ts` — LE CATALOGUE N'INONDE PLUS LA SYNTHÈSE.
 *
 * ═══ LE DÉFAUT QUE CES TESTS FIGENT ═══
 * `descriptionDesCapacites()` pèse 7 782 caractères, au plafond de
 * `MAX_CAR_CAPACITES` (8 000). La boucle la renvoyait à CHAQUE itération, y
 * compris après qu'une capacité avait rendu la donnée demandée. Le modèle
 * recevait alors un résultat correct ET un catalogue de vingt-deux outils
 * l'invitant à en appeler un ; il rappelait la même capacité, la déduplication
 * rendait le même résultat, et le garde de répétition rompait le tour.
 *
 * ⚠️ CE N'ÉTAIT PAS UNE LIMITE DU MODÈLE, ET C'EST LE POINT. Expérience
 * contrôlée sur le modèle configuré, même message et même résultat d'outil,
 * seule la longueur du catalogue variant :
 *
 *     ~1 000 car. → réponse en langue   1/2
 *     ~2 000 car. → réponse en langue   2/2
 *      4 000 car. → rappelle l'outil    2/2
 *      7 782 car. → rappelle l'outil    3/3
 *
 * Le correctif est donc de cesser d'inonder, PAS d'assouplir le garde — qui
 * avait raison, et qui reste intact.
 *
 * Sujets RÉELS : la vraie boucle, le vrai registre, les vraies descriptions.
 * Seul le transport est un faux, parce qu'un test ne doit pas appeler un
 * fournisseur.
 */

import { describe, expect, it, vi } from "vitest";

import {
  descriptionCompacteDesCapacites,
  descriptionDesCapacites,
  descriptionSyntheseSeule,
  capaciteLecture,
} from "@/services/jarvis-capacites";
import { executerTour, type DependancesBoucle } from "@/services/jarvis-boucle";
import { BUDGETS } from "@/services/jarvis-contexte";
import type { CapaciteEnregistree, ValeurSafe } from "@/services/jarvis-capacites";

/**
 * Les deux types injectés, nommés une fois. Les faux ci-dessous sont annotés
 * AVEC eux : le compilateur vérifie donc leur forme, au lieu qu'on la lui
 * impose par une double assertion — que `no-restricted-syntax` interdit, et
 * qui masquerait une divergence de contrat le jour où la boucle change.
 */
type Registre = DependancesBoucle["registre"];

/** Le plus petit résultat qui soit un `ValeurSafe` légitime : un agenda vide. */
const RESULTAT_NEUTRE: ValeurSafe = { creneaux: [], provenance: [] };
type Transport = DependancesBoucle["transport"];

/** Une capacité de test, typée par le contrat réel du registre. */
function capaciteFausse(
  nom: string,
  resultat: () => ReturnType<CapaciteEnregistree["lancer"]>,
): CapaciteEnregistree {
  return { nom, description: "faux", budgetOctets: 4_000, champsAttendus: "jour", lancer: resultat };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LES DEUX CATALOGUES
// ═══════════════════════════════════════════════════════════════════════════

describe("les deux catalogues", () => {
  it("le catalogue COMPLET reste volumineux — c'est lui qu'on n'envoie plus deux fois", () => {
    const complet = descriptionDesCapacites();
    // Le chiffre mesuré le 2026-09-06. On ne fige pas la valeur exacte (elle
    // grandira avec le registre) mais on fige le FAIT qu'elle est massive.
    expect(complet.length).toBeGreaterThan(4_000);
  });

  /**
   * ⚠️ LA GARDE ANTI-RÉGRESSION LA PLUS IMPORTANTE DE CE FICHIER. Le seuil de
   * 2 000 est celui auquel le modèle configuré répond de façon fiable
   * (2/2 mesuré) ; à 4 000 il rappelle l'outil (2/2 mesuré). Si l'ajout de
   * nouvelles capacités fait franchir ce seuil au catalogue COURT, le défaut
   * revient EN SILENCE — et ce test devient rouge avant.
   */
  it("le catalogue COURT reste sous le seuil mesuré de 2 000 caractères", () => {
    expect(descriptionCompacteDesCapacites().length).toBeLessThan(2_000);
  });

  it("le catalogue court garde les NOMS et la FORME des arguments", () => {
    const court = descriptionCompacteDesCapacites();
    // Sans les noms, une demande légitimement multi-étapes serait impossible.
    expect(court).toContain("get_today_agenda");
    expect(court).toContain("get_patient_context");
    expect(court).toContain("get_current_medications");
    // Sans la forme des arguments, un second appel échouerait sur Zod.
    expect(court).toContain("arguments exacts");
    // Et la consigne de RÉPONDRE doit y être, explicitement.
    expect(court).toMatch(/Réponds en\s+langue naturelle/);
  });

  it("le catalogue court garde le rappel des références", () => {
    // Sans lui, un second appel renverrait un nom en clair au lieu d'un jeton.
    expect(descriptionCompacteDesCapacites()).toContain("{{PATIENT_001}}");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LA BOUCLE — QUEL CATALOGUE PART, ET QUAND
// ═══════════════════════════════════════════════════════════════════════════

/** Un résultat de capacité réussi, de la forme LISTE — celle qui échouait. */
const AGENDA_LISTE: ValeurSafe = {
  creneaux: [
    {
      ref: "RDV_001",
      patient: "PATIENT_001",
      debut: "2026-09-06T17:41:00+01:00",
      fin: "2026-09-06T18:11:00+01:00",
      dureeMinutes: 30,
      statut: "confirmed",
      type: "evaluation_psychiatrique",
      arriveA: null,
    },
  ],
  provenance: [{ porte: "app.dashboard_today", luA: "2026-09-06T16:57:05.193Z", tronque: false }],
};

/**
 * Un registre RÉEL sur un nom réel, dont l'exécution est remplacée pour ne
 * toucher ni la base ni le réseau. On garde `lancer` du vrai registre quand
 * c'est possible ; ici on fournit une capacité minimale de même forme.
 */
function registreFaux(nom: string, donnees: ValeurSafe, ok = true): Registre {
  const registre: Registre = (n) =>
    n === nom
      ? capaciteFausse(nom, async () =>
          ok
            ? { ok: true, data: donnees }
            : { ok: false, error: { code: "indisponible", message: "x" } },
        )
      : null;
  return registre;
}

interface Envoi {
  readonly capacites: string;
  readonly aDesResultats: boolean;
}

/**
 * Transport instrumenté : il note ce que la boucle envoie à chaque itération,
 * puis joue le scénario qu'on lui a donné.
 */
function transportEnregistreur(
  scenario: readonly ({ proposition: { nom: string; args: unknown } } | { texte: string })[],
  envois: Envoi[],
): Transport {
  let i = 0;
  const transport: Transport = async (charge) => {
    const brut: Record<string, unknown> = { ...charge };
    const resultats = brut["resultatsOutils"];
    envois.push({
      capacites: String(brut["capacites"] ?? ""),
      aDesResultats: Array.isArray(resultats) && resultats.length > 0,
    });
    const etape = scenario[Math.min(i, scenario.length - 1)];
    i += 1;
    if (etape !== undefined && "proposition" in etape) {
      return {
        ok: true as const,
        data: {
          texte: "",
          chemin: "patient" as const,
          proposition: etape.proposition,
          conversationId: "c1",
          interrompu: false,
          persiste: true,
          preuves: [],
        },
      };
    }
    return {
      ok: true as const,
      data: {
        texte: etape !== undefined && "texte" in etape ? etape.texte : "",
        chemin: "patient" as const,
        proposition: null,
        conversationId: "c1",
        interrompu: false,
        persiste: true,
        preuves: [],
      },
    };
  };
  return transport;
}

describe("la boucle rétrécit le catalogue après un succès", () => {
  it("1er tour : catalogue COMPLET — le modèle doit pouvoir CHOISIR", async () => {
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_today_agenda", args: {} } }, { texte: "Un patient à 17h41." }],
        envois,
      ),
      registre: registreFaux("get_today_agenda", AGENDA_LISTE),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
    };

    await executerTour(
      { message: "Qui vient aujourd'hui ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    expect(envois[0]?.aDesResultats).toBe(false);
    expect(envois[0]?.capacites).toBe(descriptionDesCapacites());
    expect(envois[0]?.capacites.length).toBeGreaterThan(4_000);
  });

  it("après un succès : catalogue COURT, et le résultat reste intact", async () => {
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_today_agenda", args: {} } }, { texte: "Un patient à 17h41." }],
        envois,
      ),
      registre: registreFaux("get_today_agenda", AGENDA_LISTE),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
    };

    const r = await executerTour(
      { message: "Qui vient aujourd'hui ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    // Le 2e envoi porte le résultat ET le catalogue court.
    expect(envois[1]?.aDesResultats).toBe(true);
    expect(envois[1]?.capacites).toBe(descriptionCompacteDesCapacites());
    expect(envois[1]?.capacites.length).toBeLessThan(2_000);

    // La synthèse aboutit, et UNE SEULE exécution a eu lieu.
    expect(r.ok && r.data.texte).toBe("Un patient à 17h41.");
    expect(r.ok && r.data.appels.filter((a) => !a.deduplique).length).toBe(1);
  });

  it("un ÉCHEC laisse le catalogue COMPLET — c'est là que le modèle tâtonne", async () => {
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_today_agenda", args: {} } }, { texte: "Je n'ai pas pu." }],
        envois,
      ),
      registre: registreFaux("get_today_agenda", RESULTAT_NEUTRE, false),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
    };

    await executerTour(
      { message: "Qui vient aujourd'hui ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    // Après un échec, le catalogue reste ENTIER : choisir une AUTRE capacité
    // demande les descriptions complètes.
    expect(envois[1]?.capacites).toBe(descriptionDesCapacites());
  });

  it("un résultat OBJET UNIQUE fonctionne comme avant", async () => {
    const envois: Envoi[] = [];
    const objet: ValeurSafe = AGENDA_LISTE;
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_next_patient", args: {} } }, { texte: "Le prochain est à 17h41." }],
        envois,
      ),
      registre: registreFaux("get_next_patient", objet),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
    };

    const r = await executerTour(
      { message: "Qui est le prochain ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(r.ok && r.data.texte).toBe("Le prochain est à 17h41.");
  });

  it("une demande MULTI-ÉTAPES légitime peut encore appeler une 2e capacité", async () => {
    // ⚠️ LE CONTRE-TEST. Rétrécir le catalogue ne doit pas EMPÊCHER un second
    // appel nécessaire — sinon on aurait échangé une panne contre une autre.
    const envois: Envoi[] = [];
    const registre: Registre = (n) =>
      n === "get_next_patient" || n === "get_current_medications"
        ? capaciteFausse(n, async () => ({ ok: true, data: RESULTAT_NEUTRE }))
        : null;

    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [
          { proposition: { nom: "get_next_patient", args: {} } },
          { proposition: { nom: "get_current_medications", args: { patientId: "x" } } },
          { texte: "Le prochain est X, sous Y." },
        ],
        envois,
      ),
      registre,
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
    };

    const r = await executerTour(
      { message: "Qui est le prochain, et quel est son traitement ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    expect(r.ok && r.data.texte).toBe("Le prochain est X, sous Y.");
    // DEUX exécutions distinctes, malgré le catalogue court au 2e envoi.
    expect(r.ok && r.data.appels.filter((a) => !a.deduplique).length).toBe(2);
    expect(envois[1]?.capacites).toBe(descriptionCompacteDesCapacites());
  });

  it("le garde de répétition reste ACTIF sur une vraie boucle", async () => {
    // ⚠️ Le garde n'a pas été affaibli. Il avait raison : il exposait une
    // corruption en amont. On vérifie qu'il mord toujours.
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_today_agenda", args: {} } }],
        envois,
      ),
      registre: registreFaux("get_today_agenda", AGENDA_LISTE),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
    };

    const r = await executerTour(
      { message: "Qui vient aujourd'hui ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    expect(r.ok && r.data.texte).toContain("Je tourne en rond");
  });

  it("sans `descriptionCompacte`, le comportement d'avant est conservé", async () => {
    // Rétrocompatibilité : les faux de test existants n'ont pas ce champ.
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_today_agenda", args: {} } }, { texte: "ok" }],
        envois,
      ),
      registre: registreFaux("get_today_agenda", AGENDA_LISTE),
      description: () => "- get_today_agenda : faux",
    };

    await executerTour(
      { message: "Qui vient aujourd'hui ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(envois[1]?.capacites).toBe("- get_today_agenda : faux");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · L'APPEL FINAL — AUCUNE CAPACITÉ ANNONCÉE
// ═══════════════════════════════════════════════════════════════════════════

describe("l'appel final de verbalisation n'annonce aucune capacité", () => {
  /**
   * ⚠️ LE DÉFAUT DE « QUI VIENT DEMAIN ? », MESURÉ LE 2026-09-06.
   * Deux capacités appelées (`get_today_agenda` sur demain, puis
   * `get_agenda_range` sur le même jour — la même information), toutes deux
   * RÉUSSIES, puis une 3ᵉ proposition : budget épuisé, aveu d'échec rendu à la
   * praticienne alors que la donnée était complète depuis le premier appel.
   *
   * La boucle accordait déjà un dernier appel pour verbaliser, mais elle y
   * renvoyait encore un catalogue — donc l'invitation à faire la seule chose
   * qui ne peut plus aboutir.
   */
  it("le catalogue de synthèse ne nomme AUCUNE capacité", () => {
    const s = descriptionSyntheseSeule();
    for (const c of ["get_today_agenda", "get_agenda_range", "search_patients", "get_day_revenue"]) {
      expect(s).not.toContain(c);
    }
    expect(s).toMatch(/Réponds MAINTENANT/);
    expect(s.length).toBeLessThan(600);
  });

  it("après épuisement du budget, l'appel final part SANS capacités", async () => {
    const envois: Envoi[] = [];
    // Le modèle propose un outil à chaque itération : le budget s'épuise.
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [
          { proposition: { nom: "cap_a", args: { i: 1 } } },
          { proposition: { nom: "cap_b", args: { i: 2 } } },
          { proposition: { nom: "cap_c", args: { i: 3 } } },
          { texte: "Demain, trois patients." },
        ],
        envois,
      ),
      registre: (n) =>
        ["cap_a", "cap_b", "cap_c"].includes(n)
          ? capaciteFausse(n, async () => ({ ok: true, data: RESULTAT_NEUTRE }))
          : null,
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
      descriptionSynthese: descriptionSyntheseSeule,
    };

    const r = await executerTour(
      { message: "Qui vient demain ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    // 4 envois : 3 itérations + l'appel final de verbalisation.
    expect(envois).toHaveLength(4);
    const dernier = envois[3];
    expect(dernier?.capacites).toBe(descriptionSyntheseSeule());
    expect(dernier?.aDesResultats).toBe(true);
    // Et la réponse ABOUTIT au lieu d'avouer.
    expect(r.ok && r.data.texte).toBe("Demain, trois patients.");
    expect(r.ok && r.data.texte).not.toContain("pas réussi à aboutir");
  });

  it("une demande multi-étapes reste possible AVANT l'appel final", async () => {
    // Contre-test : l'appel final sans capacités ne doit pas empêcher les
    // itérations normales d'en utiliser plusieurs.
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [
          { proposition: { nom: "cap_a", args: {} } },
          { proposition: { nom: "cap_b", args: {} } },
          { texte: "Réponse composée." },
        ],
        envois,
      ),
      registre: (n) =>
        ["cap_a", "cap_b"].includes(n)
          ? capaciteFausse(n, async () => ({ ok: true, data: RESULTAT_NEUTRE }))
          : null,
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
      descriptionSynthese: descriptionSyntheseSeule,
    };

    const r = await executerTour(
      { message: "Qui est le prochain, et quel est son traitement ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    expect(r.ok && r.data.texte).toBe("Réponse composée.");
    expect(r.ok && r.data.appels.filter((a) => !a.deduplique).length).toBe(2);
    // La synthèse est arrivée AVANT l'épuisement : pas d'appel final.
    expect(envois).toHaveLength(3);
    expect(envois[2]?.capacites).toBe(descriptionCompacteDesCapacites());
  });

  it("le budget d'outils n'a PAS été relevé", () => {
    // Le correctif ne doit pas être un relèvement de budget déguisé.
    expect(BUDGETS.MAX_TOURS_OUTIL).toBe(3);
    expect(BUDGETS.MAX_APPELS_OUTIL).toBe(6);
  });
});

// Vitest exige au moins une utilisation de `vi` pour justifier l'import ;
// on l'emploie pour attester que rien n'est simulé côté registre réel.
describe("le registre réel n'est pas simulé", () => {
  it("capaciteLecture est la vraie fonction du module", () => {
    expect(vi.isMockFunction(capaciteLecture)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · UNE RÉPÉTITION COUPE L'OFFRE D'OUTILS
// ═══════════════════════════════════════════════════════════════════════════

describe("dès la première répétition, plus aucun outil n'est offert", () => {
  /**
   * ⚠️ MESURÉ SUR « QU'AI-JE DEMAIN MATIN ? » LE 2026-09-06.
   * Le modèle appelait `get_agenda`, puis son alias `get_agenda_range`. Une
   * fois la déduplication corrigée (elle voyait enfin les deux comme un seul
   * appel), la boucle réoffrait pourtant un catalogue : le modèle reproposait,
   * et le garde rompait le tour à la 2ᵉ répétition — sur une donnée complète
   * depuis le premier appel.
   *
   * Une répétition EST le signal que le modèle n'a plus rien à chercher. On
   * lui retire la tentation ; on ne touche pas au garde.
   */
  it("après une répétition, le catalogue devient synthèse-seule", async () => {
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [
          { proposition: { nom: "get_today_agenda", args: {} } },
          { proposition: { nom: "get_today_agenda", args: {} } }, // répétition
          { texte: "Demain matin, trois patients." },
        ],
        envois,
      ),
      registre: registreFaux("get_today_agenda", AGENDA_LISTE),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
      descriptionSynthese: descriptionSyntheseSeule,
    };

    const r = await executerTour(
      { message: "Qu'ai-je demain matin ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );

    expect(envois[0]?.capacites).toBe(descriptionDesCapacites());
    expect(envois[1]?.capacites).toBe(descriptionCompacteDesCapacites());
    // 3ᵉ envoi : la répétition a eu lieu → plus aucune capacité offerte.
    expect(envois[2]?.capacites).toBe(descriptionSyntheseSeule());
    // Le tour ABOUTIT au lieu d'avouer.
    expect(r.ok && r.data.texte).toBe("Demain matin, trois patients.");
    // Une seule EXÉCUTION : la seconde a été servie par le cache.
    expect(r.ok && r.data.appels.filter((a) => !a.deduplique).length).toBe(1);
    expect(r.ok && r.data.appels.filter((a) => a.deduplique).length).toBe(1);
  });

  it("le garde de répétition n'a PAS été desserré", async () => {
    // Si le modèle s'obstine malgré le catalogue vide, le garde mord toujours.
    const envois: Envoi[] = [];
    const deps: DependancesBoucle = {
      transport: transportEnregistreur(
        [{ proposition: { nom: "get_today_agenda", args: {} } }],
        envois,
      ),
      registre: registreFaux("get_today_agenda", AGENDA_LISTE),
      description: descriptionDesCapacites,
      descriptionCompacte: descriptionCompacteDesCapacites,
      descriptionSynthese: descriptionSyntheseSeule,
    };
    const r = await executerTour(
      { message: "Qu'ai-je demain matin ?", conversationId: "c1" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(r.ok && r.data.texte).toContain("Je tourne en rond");
  });
});
