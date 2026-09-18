/**
 * Slice 2 — LA RÉSOLUTION DU PATIENT COMME FRONTIÈRE.
 *
 * ═══ LES DEUX DÉFAUTS MESURÉS QUE CES TESTS GARDENT ═══
 *
 * 1. CLARIFICATION MULTILINGUE — sonde hors ligne du 2026-09-07, 22 cas.
 *    « دواءه؟ », « dwa dyalou? », « And his medication? » et 8 autres ne
 *    déclenchaient AUCUNE clarification : 11 trous, 0 faux positif. Sans cible,
 *    la question partait au modèle, qui devinait de quel dossier il s'agissait.
 *    C'est le seul défaut de la tranche qui produit une réponse FAUSSE en
 *    silence — les trous de routage de Slice 1 produisaient un refus ou une
 *    boucle, tous deux visibles.
 *
 *    ⚠️ ET LA NORMALISATION SEULE N'EN REFERMAIT AUCUN (0/11, même sonde) :
 *    `REFERENCE_PATIENT` exige un possessif français DEVANT un nom clinique, et
 *    le lexique rendait le nom sans le possessif. C'est le groupe POSSESSIF du
 *    lexique qui referme, pas l'appel au normaliseur.
 *
 * 2. AMBIGUÏTÉ NON CLOSE — lecture du flot de contrôle, `jarvis-boucle.ts`.
 *    Deux dossiers au même nom : `search_patients` rendait `ambigu:true`,
 *    `signalerAmbiguite()` purgeait bien la cible — et le modèle gardait les
 *    DEUX jetons. Rien ne l'empêchait d'enchaîner `get_patient_context` sur
 *    l'un des deux et de répondre avec assurance sur un dossier choisi par
 *    défaut. « Ne jamais deviner » était affirmé à un endroit et contredit au
 *    suivant.
 *
 * AUCUNE DONNÉE PATIENT RÉELLE, AUCUN ACCÈS BASE, AUCUN APPEL DE MODÈLE.
 * Horloge injectée (`maintenantMs`) : aucune attente réelle de 15 minutes.
 */
import { describe, expect, it, beforeEach } from "vitest";

import { classerMultilingue } from "../../src/shared/jarvis/normalisation";
import {
  adopterPatientActif,
  adopterResolution,
  besoinDeClarification,
  cibleCourante,
  cibleValide,
  definirCible,
  effacerCible,
  resoudreCible,
  TTL_CONTEXTE_MS,
} from "../../src/services/jarvis-contexte";
import {
  carte as carteCourante,
  reinitialiserCarte,
  type RefPatient,
} from "../../src/services/jarvis-identite";
import { capaciteLecture, estPatientSpecifique } from "../../src/services/jarvis-capacites";
import { executerTour, type DependancesBoucle } from "../../src/services/jarvis-boucle";
import type {
  CapaciteEnregistree,
  SafeRechercheContext,
} from "../../src/services/jarvis-capacites";
import type { TourFlux } from "../../src/services/jarvis";
import { ok } from "../../src/services/result";
import { KARIM, MAHMOUD } from "../fixtures/patients";

const T0 = Date.parse("2026-09-07T10:00:00+01:00");

/**
 * La charge utile de substitution des faux — même procédé que
 * `jarvis-boucle-verbalisation`. Ce qu'une capacité REND est sans importance
 * ici ; on rend donc la plus petite valeur de l'union fermée `ValeurSafe`
 * plutôt qu'un objet inventé qui ne franchirait pas le type.
 */
const CONTENU: SafeRechercheContext = { resultats: [], ambigu: false, total: 0 };

// Les identités viennent de la population synthétique du cabinet : « A » et
// « B » désignent ici les mêmes personnes qu'en base de développement et qu'à
// l'écran, ce qui permet de rejouer un test unitaire dans le navigateur sans
// traduction mentale.
const A = {
  id: KARIM.id,
  libelle: KARIM.libelle,
  numeroDossier: KARIM.numeroDossier,
  origine: "ecran" as const,
};
const B = {
  id: MAHMOUD.id,
  libelle: MAHMOUD.libelle,
  numeroDossier: MAHMOUD.numeroDossier,
  origine: "recherche" as const,
};

beforeEach(() => {
  effacerCible();
  reinitialiserCarte();
});

// ═══════════════════════════════════════════════════════════════════════════
// LA PRÉCÉDENCE — l'ordre est le livrable
// ═══════════════════════════════════════════════════════════════════════════

describe("précédence : ambigu > explicite > écran > conversation > aucun", () => {
  it("1. écran=A, explicite=B → B", () => {
    const r = resoudreCible({ ecran: A, explicite: B }, T0);
    expect(r.etat).toBe("explicite");
    expect(r.etat === "explicite" && r.cible.id).toBe(B.id);
  });

  it("2. conversation=A, explicite=B → B", () => {
    definirCible(A, T0);
    const r = resoudreCible({ explicite: B }, T0 + 1000);
    expect(r.etat).toBe("explicite");
    expect(r.etat === "explicite" && r.cible.id).toBe(B.id);
  });

  it("3. écran=A, conversation=B, aucun explicite → l'écran, et c'est documenté", () => {
    definirCible(B, T0);
    const r = resoudreCible({ ecran: A }, T0 + 1000);
    expect(r.etat).toBe("ecran");
    expect(r.etat === "ecran" && r.cible.id).toBe(A.id);
  });

  it("4. homonymes → « ambigu », et JAMAIS une sélection", () => {
    const r = resoudreCible({ ambigu: true, ecran: A, explicite: B }, T0);
    // ⚠️ `ambigu` domine même une désignation explicite : si la désignation
    // avait tranché, elle n'aurait pas été ambiguë.
    expect(r.etat).toBe("ambigu");
    expect(JSON.stringify(r)).not.toContain(A.id);
    expect(JSON.stringify(r)).not.toContain(B.id);
  });

  it("6. conversation expirée → « aucun », jamais un repli sur la cible périmée", () => {
    definirCible(A, T0);
    const r = resoudreCible({}, T0 + TTL_CONTEXTE_MS + 1000);
    expect(r.etat).toBe("aucun");
    // Et la purge paresseuse a bien eu lieu : rien ne survit à son TTL.
    expect(cibleCourante()).toBeNull();
  });

  it("conversation TTL-valide, aucun autre signal → le fil", () => {
    definirCible(A, T0);
    const r = resoudreCible({}, T0 + 60_000);
    expect(r.etat).toBe("conversation");
  });

  it("aucun signal, aucun fil → « aucun »", () => {
    expect(resoudreCible({}, T0).etat).toBe("aucun");
  });

  it("`ecran: null` est un RETRAIT explicite, pas une absence de signal", () => {
    // ⚠️ LE PIÈGE DE CETTE FONCTION. Si `null` et `undefined` étaient traités
    // pareil, le rang 3 rattraperait la cible que la praticienne vient de
    // fermer par [Changer] — un dossier refermé qui continue de parler.
    definirCible(A, T0);
    expect(resoudreCible({ ecran: null }, T0 + 1000).etat).toBe("aucun");
    expect(resoudreCible({}, T0 + 1000).etat).toBe("conversation");
  });

  it("9. le patient à l'écran change → la carte ne connaît plus rien de l'ancien", () => {
    adopterPatientActif({ id: A.id, nom: A.libelle, numero: A.numeroDossier, etablieA: T0 }, T0);
    carteCourante().patient(A.id, A.libelle, [A.libelle, A.numeroDossier]);
    adopterPatientActif(
      { id: B.id, nom: B.libelle, numero: B.numeroDossier, etablieA: T0 + 1000 },
      T0 + 1000,
    );
    expect(carteCourante().identites()).not.toContain(A.libelle);
    expect(carteCourante().identites()).not.toContain(A.numeroDossier);
    expect(cibleValide(T0 + 1000)?.id).toBe(B.id);
  });

  it("adopterResolution écrit pour explicite/écran, et JAMAIS pour conversation", () => {
    definirCible(A, T0);
    const avant = cibleValide(T0 + 60_000)?.etablieA;
    // ⚠️ Conserver ce qui est déjà là ne doit pas ré-armer le TTL : une
    // conversation qui tourne en rond garderait sinon vivante indéfiniment une
    // cible que personne n'a reconfirmée.
    adopterResolution(resoudreCible({}, T0 + 60_000), T0 + 60_000);
    expect(cibleValide(T0 + 60_000)?.etablieA).toBe(avant);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA PORTE — après une ambiguïté, on demande, on ne choisit pas
// ═══════════════════════════════════════════════════════════════════════════

describe("estPatientSpecifique : dérivé du schéma, jamais d'une liste", () => {
  it("les capacités qui acceptent `patientId` sont couvertes", () => {
    const ctx = capaciteLecture("get_patient_context");
    expect(ctx).not.toBeNull();
    expect(ctx !== null && estPatientSpecifique(ctx)).toBe(true);
  });

  it("`search_patients` est exclu DE DROIT — son schéma accepte `query`", () => {
    // ⚠️ Pas une exception nommée : le résolveur n'accepte pas `patientId`,
    // donc il n'est pas patient-spécifique. Une liste tenue à la main aurait
    // dû l'inscrire en cas particulier, et se serait désynchronisée.
    const s = capaciteLecture("search_patients");
    expect(s).not.toBeNull();
    expect(s !== null && estPatientSpecifique(s)).toBe(false);
  });
});

describe("4bis. après une ambiguïté, AUCUNE capacité patient ne s'exécute", () => {
  it("le tour n'appelle jamais get_patient_context sur un des deux homonymes", async () => {
    // ⚠️ AUCUNE CIBLE PRÉALABLE, ET C'EST TOUT LE SUJET.
    // Deuxième écriture de ce test : il posait une cible avant le tour. Il
    // passait alors MÊME AVEC LA PORTE DÉSARMÉE, vérifié en la neutralisant —
    // parce que `signalerAmbiguite()` purgeait cette cible, ce qui
    // réinitialise la carte d'identité et invalide les jetons. Le chemin
    // était bien fermé, mais par un effet de bord, et seulement dans ce cas.
    //
    // Or `signalerAmbiguite()` SORT IMMÉDIATEMENT quand aucune cible n'existe
    // (`if (cible === null) return`) : rien n'est purgé, la carte reste
    // intacte, les deux jetons homonymes restent résolvables. C'est le cas
    // COURANT — la praticienne demande « le dossier de Benali » sans dossier
    // ouvert à l'écran — et c'est là que le modèle pouvait lire l'un des deux
    // au hasard. La porte est ce qui ferme ce cas-là.
    expect(cibleCourante()).toBeNull();
    let contexteExecute = false;
    let rechercheExecutee = false;

    const repondre = (
      params: { conversationId: string },
      suivante: { texte?: string; proposition?: { nom: string; args: unknown } | null },
    ): ReturnType<typeof ok<TourFlux>> =>
      ok({
        chemin: "patient",
        texte: suivante.texte ?? "",
        proposition: suivante.proposition ?? null,
        conversationId: params.conversationId,
        persiste: false,
        interrompu: false,
        preuves: [],
      });

    // ⚠️ LES JETONS SONT FRAPPÉS POUR DE VRAI, ET C'EST INDISPENSABLE.
    // Première écriture de ce test : les jetons étaient des chaînes littérales
    // « {{PATIENT_001}} ». Le test passait — Y COMPRIS AVEC LA PORTE DÉSARMÉE,
    // vérifié en la neutralisant. Il ne prouvait rien : un jeton jamais frappé
    // n'est pas résolu par la carte, `executerCapacite` rendait
    // « reference-inconnue », et la capacité n'était de toute façon jamais
    // atteinte. Le vert venait d'un mécanisme sans rapport avec la porte.
    let jetonPremier: RefPatient | null = null;
    let jetonSecond: RefPatient | null = null;

    let tour = 0;
    const transport = async (params: { message: string; conversationId: string }) => {
      const n = tour++;
      if (n === 0) {
        return repondre(params, {
          proposition: { nom: "search_patients", args: { query: "Benali" } },
        });
      }
      if (n === 1) {
        // Le modèle a les deux jetons en main et tente d'en lire un.
        return repondre(params, {
          proposition: { nom: "get_patient_context", args: { patientId: jetonPremier } },
        });
      }
      return repondre(params, { texte: "Deux dossiers correspondent, lequel ?" });
    };

    const registre = (nom: string): CapaciteEnregistree | null => {
      if (nom === "search_patients") {
        return {
          nom,
          description: "faux",
          budgetOctets: 1000,
          champsAttendus: "query",
          lancer: () => {
            rechercheExecutee = true;
            // Deux homonymes, frappés par la carte du tour — comme le ferait
            // `projeterPatientListItem` sur un vrai résultat de recherche.
            jetonPremier = carteCourante().patient(A.id, A.libelle, [A.libelle]);
            jetonSecond = carteCourante().patient(B.id, B.libelle, [B.libelle]);
            return Promise.resolve(
              ok({ resultats: [jetonPremier, jetonSecond], ambigu: true, total: 2 }),
            );
          },
        };
      }
      if (nom === "get_patient_context") {
        return {
          nom,
          description: "faux",
          budgetOctets: 1000,
          champsAttendus: "patientId",
          lancer: () => {
            contexteExecute = true;
            return Promise.resolve(ok(CONTENU));
          },
        };
      }
      return null;
    };

    const deps: DependancesBoucle = {
      transport,
      registre,
      description: () => "- search_patients : faux",
    };

    const r = await executerTour(
      { message: "le dossier de Benali", conversationId: "conv-precedence" },
      {},
      new AbortController().signal,
      deps,
    );

    expect(r.ok).toBe(true);
    expect(rechercheExecutee).toBe(true);
    // Deux jetons DISTINCTS ont bien été frappés : le tour a réellement eu
    // deux homonymes en main, ce qui est la prémisse de tout ce test.
    expect(jetonPremier).not.toBeNull();
    expect(jetonSecond).not.toBe(jetonPremier);
    // ⚠️ LE CŒUR DE LA TRANCHE. Avant la porte, cette assertion échouait :
    // la capacité patient s'exécutait sur le premier des deux homonymes.
    expect(contexteExecute).toBe(false);
    // La cible reste purgée : on n'a rien choisi.
    expect(cibleCourante()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA CLARIFICATION — multilingue, et sans faux positif
// ═══════════════════════════════════════════════════════════════════════════

describe("8. sans cible, une référence pronominale demande — dans les 4 langues", () => {
  const REFERENCES: readonly [string, string][] = [
    ["Et ses médicaments ?", "français"],
    ["Résume-moi son dossier", "français"],
    ["Parle-moi de lui", "français"],
    ["و دواءه؟", "arabe"],
    ["شنو دواءه؟", "arabe"],
    ["ملفه؟", "arabe"],
    ["علاجه؟", "arabe"],
    ["آخر حصة ديالو؟", "darija (arabe)"],
    ["wach 3andou dwa?", "darija latine"],
    ["dwa dyalou?", "darija latine"],
    ["akher hessa dyalou?", "darija latine"],
    ["And his medication?", "anglais"],
    ["his last session?", "anglais"],
    ["What is his file?", "anglais"],
  ];

  for (const [texte, langue] of REFERENCES) {
    it(`demande au lieu de deviner — ${langue} : ${texte}`, () => {
      expect(besoinDeClarification(texte, T0)).toBe(true);
    });
  }
});

describe("aucun faux positif — une clarification indue BLOQUE une question légitime", () => {
  const LEGITIMES: readonly [string, string][] = [
    ["Qu'ai-je demain matin ?", "agenda"],
    ["Quels sont les symptômes de la dépression ?", "savoir"],
    ["Quelle est sa demi-vie ?", "molécule, pas patient"],
    ["Combien j'ai encaissé aujourd'hui ?", "finance"],
    ["ما هي أعراض الاكتئاب؟", "savoir en arabe"],
    ["شكون عندي اليوم؟", "agenda en arabe"],
    ["Résume le dossier de Karim", "nom explicite"],
  ];

  for (const [texte, quoi] of LEGITIMES) {
    it(`ne demande rien — ${quoi} : ${texte}`, () => {
      // ⚠️ CETTE UNION N'EST PAS MONOTONE COMME CELLE DU ROUTAGE. Là-bas, plus
      // restrictif est toujours plus sûr. Ici, une clarification indue coûte
      // une question inutile à la praticienne, sur chaque tour concerné.
      expect(besoinDeClarification(texte, T0)).toBe(false);
    });
  }
});

describe("7. et 6. la cible décide de la clarification", () => {
  it("7. une cible explicite gagne : le pronom ne demande plus", () => {
    adopterResolution(resoudreCible({ explicite: B }, T0), T0);
    expect(besoinDeClarification("Et ses médicaments ?", T0 + 1000)).toBe(false);
    expect(besoinDeClarification("دواءه؟", T0 + 1000)).toBe(false);
  });

  it("6. cible expirée + pronom → on redemande, dans les deux écritures", () => {
    definirCible(A, T0);
    expect(besoinDeClarification("Et ses médicaments ?", T0 + TTL_CONTEXTE_MS + 1)).toBe(true);
    definirCible(A, T0);
    expect(besoinDeClarification("دواءه؟", T0 + TTL_CONTEXTE_MS + 1)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. LE REFUS RESTE EN AMONT — invariant de Slice 1, re-affirmé ici
// ═══════════════════════════════════════════════════════════════════════════

describe("10. un refus mentionnant un patient reste un refus, avant tout", () => {
  const REFUS = [
    "Est-ce que Karim est dépressif ?",
    "هل كريم مكتئب؟",
    "nzidlo la dose?",
    "Should I increase Karim's dose?",
  ];

  for (const texte of REFUS) {
    it(`refus tenu, sans modèle ni outil : ${texte}`, () => {
      // La frontière ADR-023 décide AVANT le contexte : la précédence de cette
      // tranche ne s'insère jamais devant elle.
      expect(classerMultilingue(texte).chemin).toBe("refus");
    });
  }

  it("la précédence n'ouvre aucun chemin : un refus le reste, cible posée ou non", () => {
    adopterResolution(resoudreCible({ explicite: B }, T0), T0);
    expect(classerMultilingue("هل كريم مكتئب؟").chemin).toBe("refus");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L'ORDRE DES DEUX GARDES — le refus passe devant la clarification
// ═══════════════════════════════════════════════════════════════════════════

describe("refus AVANT clarification — l'audit ne doit pas disparaître", () => {
  /**
   * ⚠️ MESURÉ LE 2026-09-07, sonde hors ligne sur 18 formulations : QUATRE sont
   * à la fois classées `refus` et reconnues comme référence pronominale.
   *
   *     dois-je augmenter sa posologie ?      ← FRANÇAIS
   *     faut-il arrêter son traitement ?      ← FRANÇAIS
   *     nzidlo la dose?
   *     نزيدلو الدوز؟
   *
   * Les deux premières se comportaient DÉJÀ ainsi avant la passe multilingue :
   * `REFERENCE_PATIENT` n'a pas changé et « sa posologie » y correspond en
   * clair. Ce n'est donc pas une régression de Slice 2, c'est un ordre qui
   * n'avait jamais été tranché — Slice 2 l'a seulement rendu visible en
   * étendant la classe à la darija.
   *
   * Ce que l'ordre inverse coûtait : la clarification est un échange LOCAL, sans
   * trace ; le refus, lui, est écrit dans la conversation. Clarifier d'abord
   * effaçait l'audit sur la classe de demandes la plus sensible du produit.
   */
  const CONFLIT = [
    "dois-je augmenter sa posologie ?",
    "faut-il arrêter son traitement ?",
    "nzidlo la dose?",
    "نزيدلو الدوز؟",
  ];

  for (const texte of CONFLIT) {
    it(`classé refus ET référence pronominale — le refus doit gagner : ${texte}`, () => {
      effacerCible();
      // Les deux gardes s'allument : c'est bien un cas de conflit.
      expect(classerMultilingue(texte).chemin).toBe("refus");
      expect(besoinDeClarification(texte, T0)).toBe(true);
    });
  }

  it("une référence pronominale SANS refus garde sa clarification", () => {
    // La garde ajoutée ne doit pas avaler les cas légitimes : ceux-ci ne sont
    // pas des refus, donc la clarification reste seule à décider.
    for (const texte of ["Et ses médicaments ?", "دواءه؟", "dwa dyalou?", "And his medication?"]) {
      effacerCible();
      expect(classerMultilingue(texte).chemin).not.toBe("refus");
      expect(besoinDeClarification(texte, T0)).toBe(true);
    }
  });

  it("un refus qui NOMME quelqu'un n'a jamais déclenché de clarification", () => {
    // Contre-test : le nom propre écarte déjà la clarification. Ces cas
    // partaient au refus avant comme après, et prouvent que le changement
    // d'ordre ne concerne QUE les quatre formulations ci-dessus.
    for (const texte of ["Est-ce que Karim est dépressif ?", "هل كريم مكتئب؟"]) {
      effacerCible();
      expect(classerMultilingue(texte).chemin).toBe("refus");
      expect(besoinDeClarification(texte, T0)).toBe(false);
    }
  });

  it("une question de traitement ORDINAIRE reste intacte", () => {
    effacerCible();
    // Ni refus, ni référence : elle doit traverser sans être interceptée.
    expect(classerMultilingue("Quels sont les effets secondaires de la sertraline ?").chemin)
      .not.toBe("refus");
    expect(besoinDeClarification("Quels sont les effets secondaires de la sertraline ?", T0))
      .toBe(false);
  });
});
