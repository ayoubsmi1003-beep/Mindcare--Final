/**
 * L'ANCRE DE CONVERSATION — ce qu'un tour a lu, prêté au tour suivant.
 *
 * ═══ LA PROPRIÉTÉ QUE CES TESTS GARDENT ═══
 *
 * L'ancre est une aide de COMPRÉHENSION. Elle permet à « et ses traitements ? »
 * de désigner le patient dont on vient de parler. Elle n'est JAMAIS une
 * autorisation, et trois choses l'en empêchent :
 *
 *   1. elle ne naît que d'une exécution serveur RÉUSSIE — pas d'une proposition
 *      du modèle, pas d'un candidat de recherche, pas d'un nom prononcé ;
 *   2. elle se pose comme une cible ORDINAIRE, donc le tour suivant repasse par
 *      la carte d'identité, Zod, la porte SQL et la RLS ;
 *   3. tout ce qui est plus fort la couvre — écran, cible en cours, ambiguïté.
 *
 * ═══ POURQUOI ELLE SE POSE AU DÉBUT DU TOUR SUIVANT ═══
 *
 * ⚠️ LA VERSION PRÉCÉDENTE DE CETTE IDÉE (« rang 1 ») A ÉTÉ RETIRÉE APRÈS
 * MESURE. Elle posait la cible PENDANT le tour ; `definirCible` y voyait un
 * changement et réinitialisait la carte d'identité — sa raison d'être — de
 * sorte que le jeton `PATIENT_001` que le modèle s'apprêtait à passer à la
 * capacité suivante devenait « reference-inconnue ». Mesuré :
 * `jarvis-boucle-verbalisation` tombait de 4 appels à 3, et le flux le plus
 * courant du produit — chercher puis lire — cassait.
 *
 * L'ancre ne touche donc plus rien pendant le tour : la boucle se contente de
 * RAPPORTER un candidat, et `conversation.ts` le pose au début du tour suivant,
 * là où `executerTour` réinitialise de toute façon la carte. La purge de
 * `definirCible` n'a plus aucun effet observable — et elle n'a pas été affaiblie
 * d'une ligne. Le cas 12 de ce fichier est la garde permanente de ce défaut.
 *
 * AUCUNE DONNÉE PATIENT RÉELLE, AUCUN ACCÈS BASE, AUCUN APPEL DE MODÈLE.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  ancreApplicable,
  cibleValide,
  definirCible,
  effacerCible,
  TTL_CONTEXTE_MS,
} from "../../src/services/jarvis-contexte";
import {
  carte as carteCourante,
  reinitialiserCarte,
  type RefPatient,
} from "../../src/services/jarvis-identite";
import { executerTour, type DependancesBoucle } from "../../src/services/jarvis-boucle";
import type {
  CapaciteEnregistree,
  SafeRechercheContext,
} from "../../src/services/jarvis-capacites";
import type { TourFlux } from "../../src/services/jarvis";
import { err, ok } from "../../src/services/result";
import { HOMONYMES, KARIM, MAHMOUD } from "../fixtures/patients";

// Les identités viennent de la population synthétique du cabinet : le même
// « Karim Djilali » qu'en base de développement et qu'à l'écran.

const T0 = Date.parse("2026-09-07T10:00:00+01:00");

beforeEach(() => {
  effacerCible();
  reinitialiserCarte();
});

/**
 * Un tour scripté : à chaque itération, le transport rend l'étape suivante.
 * `etapes` est une FONCTION pour que les jetons frappés en cours de tour soient
 * lus au moment de l'appel, et non figés à la construction.
 */
function depsScriptees(
  etapes: () => readonly ({ nom: string; args: unknown } | null)[],
  registre: DependancesBoucle["registre"],
  texteFinal = "Voilà.",
): DependancesBoucle {
  let n = 0;
  return {
    registre,
    description: () => "- faux",
    transport: (p) => {
      const prop = etapes()[n++] ?? null;
      return Promise.resolve(
        ok({
          chemin: "patient",
          texte: prop === null ? texteFinal : "",
          proposition: prop,
          conversationId: p.conversationId,
          persiste: false,
          interrompu: false,
        } satisfies TourFlux),
      );
    },
  };
}

/**
 * Un faux de capacité, TYPÉ. L'annotation de retour n'est pas cosmétique : sans
 * elle l'objet reste une forme anonyme, et `tsconfig.test.json` refuse de la
 * voir comme une `CapaciteEnregistree`. C'est ce contrôle qui garantit qu'un
 * faux ne peut pas rendre autre chose que ce que le vrai registre rend.
 */
function capacite(
  nom: string,
  champsAttendus: string,
  lancer: CapaciteEnregistree["lancer"],
): CapaciteEnregistree {
  return { nom, description: "faux", budgetOctets: 1000, champsAttendus, lancer };
}

/** Une capacité patient-spécifique : son schéma accepte `patientId`. */
function capacitePatient(
  nom: string,
  lancer: CapaciteEnregistree["lancer"],
): CapaciteEnregistree {
  return capacite(nom, "patientId", lancer);
}

/**
 * La charge utile de substitution — même procédé que
 * `jarvis-boucle-verbalisation`. Ce qu'une capacité REND n'a aucune importance
 * pour l'ancre : seul compte qu'elle réussisse. On rend donc la plus petite
 * valeur de l'union fermée `ValeurSafe`, plutôt qu'un objet inventé qui ne
 * franchirait pas le type.
 */
const CONTENU: SafeRechercheContext = { resultats: [], ambigu: false, total: 0 };

async function jouer(deps: DependancesBoucle) {
  return executerTour(
    { message: "peu importe", conversationId: "conv-ancre" },
    {},
    new AbortController().signal,
    deps,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// A · CE QUI PRODUIT UNE ANCRE — ET CE QUI N'EN PRODUIT PAS
// ═══════════════════════════════════════════════════════════════════════════

describe("A · l'ancre naît d'une exécution réussie, et d'elle seule", () => {
  it("1. un patient lu avec succès → ancre portant son identité", async () => {
    let jeton: RefPatient | null = null;
    const deps = depsScriptees(
      () => [
        { nom: "search_patients", args: { query: "Djilali" } },
        { nom: "get_patient_context", args: { patientId: jeton } },
        null,
      ],
      (nom) => {
        if (nom === "search_patients") {
          return capacite("search_patients", "query", () => {
            jeton = carteCourante().patient(KARIM.id, KARIM.libelle, [KARIM.libelle]);
            return Promise.resolve(ok({ resultats: [jeton], ambigu: false, total: 1 }));
          });
        }
        if (nom === "get_patient_context") {
          return capacitePatient(nom, () => Promise.resolve(ok(CONTENU)));
        }
        return null;
      },
      "Voici le dossier.",
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ancreCandidate).not.toBeNull();
    expect(r.data.ancreCandidate?.id).toBe(KARIM.id);
    // Le libellé vient de la carte du tour : l'écran doit pouvoir la nommer.
    expect(r.data.ancreCandidate?.libelle).toBe(KARIM.libelle);
  });

  it("2. ambiguïté → AUCUNE ancre (l'ancre ne rattrape jamais un homonyme)", async () => {
    const deps = depsScriptees(
      () => [{ nom: "search_patients", args: { query: "Sadli" } }, null],
      (nom) =>
        nom === "search_patients"
          ? capacite("search_patients", "query", () => {
              const jetons = HOMONYMES.slice(0, 2).map((h) =>
                carteCourante().patient(h.id, h.libelle, [h.libelle]),
              );
              return Promise.resolve(ok({ resultats: jetons, ambigu: true, total: 7 }));
            })
          : null,
      "Plusieurs dossiers correspondent.",
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ancreCandidate).toBeNull();
  });

  it("2bis. un patient lu PUIS une ambiguïté → aucune ancre", async () => {
    // ⚠️ SEULE COUVERTURE RÉELLE DE LA GARDE D'AMBIGUÏTÉ, AJOUTÉE APRÈS MESURE.
    // Le cas « 2 » passait même en RETIRANT `if (ambiguiteConstatee) return
    // null` : l'ambiguïté y empêche déjà toute lecture patient, donc le compte
    // est nul de toute façon. Ici la lecture de Karim RÉUSSIT d'abord et
    // l'ambiguïté ne survient qu'ensuite : le compte vaut 1, et seule la garde
    // empêche d'ancrer une conversation devenue trouble.
    let jeton: RefPatient | null = null;
    const deps = depsScriptees(
      () => [
        { nom: "search_patients", args: { query: "Djilali" } },
        { nom: "get_patient_context", args: { patientId: jeton } },
        { nom: "search_patients", args: { query: "Sadli" } },
        null,
      ],
      (nom) => {
        if (nom === "search_patients") {
          return capacite("search_patients", "query", (args) => {
            const q = (args as { query?: string }).query;
            if (q === "Djilali") {
              jeton = carteCourante().patient(KARIM.id, KARIM.libelle, [KARIM.libelle]);
              return Promise.resolve(ok({ resultats: [jeton], ambigu: false, total: 1 }));
            }
            const autres = HOMONYMES.slice(0, 2).map((h) =>
              carteCourante().patient(h.id, h.libelle, [h.libelle]),
            );
            return Promise.resolve(ok({ resultats: autres, ambigu: true, total: 7 }));
          });
        }
        if (nom === "get_patient_context") {
          return capacitePatient(nom, () => Promise.resolve(ok(CONTENU)));
        }
        return null;
      },
      "Plusieurs dossiers correspondent.",
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.appels.some((a) => a.capacite === "get_patient_context" && a.ok)).toBe(true);
    expect(r.data.ancreCandidate).toBeNull();
  });

  it("3. DEUX patients lus → aucune ancre (on ne parie pas sur l'un d'eux)", async () => {
    const jetons: RefPatient[] = [];
    const deps = depsScriptees(
      () => [
        { nom: "search_patients", args: { query: "D" } },
        { nom: "get_patient_context", args: { patientId: jetons[0] } },
        { nom: "get_patient_context", args: { patientId: jetons[1] } },
        null,
      ],
      (nom) => {
        if (nom === "search_patients") {
          return capacite("search_patients", "query", () => {
            jetons.push(carteCourante().patient(KARIM.id, KARIM.libelle, [KARIM.libelle]));
            jetons.push(carteCourante().patient(MAHMOUD.id, MAHMOUD.libelle, [MAHMOUD.libelle]));
            // Deux résultats mais NON ambigus : deux personnes différentes,
            // toutes deux légitimement lisibles. C'est leur PLURALITÉ qui
            // interdit l'ancre, pas un doute d'identité.
            return Promise.resolve(ok({ resultats: jetons, ambigu: false, total: 2 }));
          });
        }
        if (nom === "get_patient_context") {
          return capacitePatient(nom, () => Promise.resolve(ok(CONTENU)));
        }
        return null;
      },
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.appels.filter((a) => a.capacite === "get_patient_context").length).toBe(2);
    expect(r.data.ancreCandidate).toBeNull();
  });

  it("4. capacité patient en ÉCHEC → aucune ancre", async () => {
    let jeton: RefPatient | null = null;
    const deps = depsScriptees(
      () => [
        { nom: "search_patients", args: { query: "Djilali" } },
        { nom: "get_patient_context", args: { patientId: jeton } },
        null,
      ],
      (nom) => {
        if (nom === "search_patients") {
          return capacite("search_patients", "query", () => {
            jeton = carteCourante().patient(KARIM.id, KARIM.libelle, [KARIM.libelle]);
            return Promise.resolve(ok({ resultats: [jeton], ambigu: false, total: 1 }));
          });
        }
        if (nom === "get_patient_context") {
          // Refus côté serveur : la RLS, une porte, un dossier hors périmètre.
          return capacitePatient(nom, () =>
            Promise.resolve(err({ code: "introuvable", message: "introuvable" })),
          );
        }
        return null;
      },
      "Je n'ai pas pu lire ce dossier.",
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ⚠️ LE POINT LE PLUS IMPORTANT DE CE FICHIER. Une autorisation refusée ne
    // doit pas laisser derrière elle un contexte de conversation : sinon le tour
    // suivant parlerait « de lui » en désignant un dossier que le serveur vient
    // précisément de refuser.
    expect(r.data.ancreCandidate).toBeNull();
  });

  it("5. une capacité NON patient-spécifique n'ancre rien (agenda)", async () => {
    const deps = depsScriptees(
      () => [{ nom: "get_agenda_range", args: { du: "2026-09-07", au: "2026-09-08" } }, null],
      (nom) =>
        nom === "get_agenda_range"
          ? capacite("get_agenda_range", "du, au", () => Promise.resolve(ok(CONTENU)))
          : null,
      "Trois rendez-vous.",
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ancreCandidate).toBeNull();
  });

  it("6. une proposition d'ÉCRITURE en attente n'ancre rien", async () => {
    const deps = depsScriptees(
      () => [{ nom: "reschedule_appointment", args: { rdvId: "RDV_001" } }],
      () => null,
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.propositionInconnue).not.toBeNull();
    // Rien n'a été exécuté et l'humaine n'a pas décidé : ancrer ici ferait d'une
    // proposition non confirmée un contexte de conversation.
    expect(r.data.ancreCandidate).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B · LA PRÉCÉDENCE — l'ancre est le dernier des signaux
// ═══════════════════════════════════════════════════════════════════════════

describe("B · ancreApplicable : tout ce qui est plus fort la couvre", () => {
  const ancre = { poseeA: T0 };

  it("7. aucune ancre → false", () => {
    expect(ancreApplicable(null, false, T0)).toBe(false);
  });

  it("8. un dossier ouvert à l'écran gagne", () => {
    expect(ancreApplicable(ancre, true, T0)).toBe(false);
  });

  it("9. une cible encore valide gagne — le fil n'a pas besoin d'être rattrapé", () => {
    definirCible(
      {
        id: KARIM.id,
        libelle: KARIM.libelle,
        numeroDossier: KARIM.numeroDossier,
        origine: "ecran",
      },
      T0,
    );
    expect(ancreApplicable(ancre, false, T0 + 60_000)).toBe(false);
  });

  it("10. ancre périmée = ancre absente", () => {
    expect(ancreApplicable(ancre, false, T0 + TTL_CONTEXTE_MS)).toBe(false);
    expect(ancreApplicable(ancre, false, T0 + TTL_CONTEXTE_MS - 1000)).toBe(true);
  });

  it("11. silence de tous les autres signaux → l'ancre sert", () => {
    expect(cibleValide(T0)).toBeNull();
    expect(ancreApplicable(ancre, false, T0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C · LA RÉGRESSION DURE — « chercher puis lire » ne doit jamais retomber
// ═══════════════════════════════════════════════════════════════════════════

describe("C · chercher puis lire reste intact", () => {
  it("12. les DEUX appels partent, et le jeton n'est jamais invalidé", async () => {
    // ⚠️ C'EST LE TEST QUI INTERDIT LE RETOUR DU « RANG 1 ». L'ancienne version
    // posait la cible PENDANT le tour ; `definirCible` réinitialisait la carte
    // et le second appel échouait en « reference-inconnue ». On exige ici que
    // les deux capacités s'exécutent VRAIMENT, et qu'aucune ne rende ce code.
    let jeton: RefPatient | null = null;
    let lectureExecutee = false;
    const deps = depsScriptees(
      () => [
        { nom: "search_patients", args: { query: "Djilali" } },
        { nom: "get_current_medications", args: { patientId: jeton } },
        null,
      ],
      (nom) => {
        if (nom === "search_patients") {
          return capacite("search_patients", "query", () => {
            jeton = carteCourante().patient(KARIM.id, KARIM.libelle, [KARIM.libelle]);
            return Promise.resolve(ok({ resultats: [jeton], ambigu: false, total: 1 }));
          });
        }
        if (nom === "get_current_medications") {
          return capacitePatient(nom, () => {
            lectureExecutee = true;
            return Promise.resolve(ok(CONTENU));
          });
        }
        return null;
      },
      "Il prend deux traitements.",
    );
    const r = await jouer(deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lectureExecutee).toBe(true);
    expect(r.data.appels.map((a) => a.capacite)).toEqual([
      "search_patients",
      "get_current_medications",
    ]);
    expect(r.data.appels.some((a) => a.code === "reference-inconnue")).toBe(false);
    // Et le tour, ayant lu UN patient, propose bien son ancre.
    expect(r.data.ancreCandidate?.id).toBe(KARIM.id);
  });
});
