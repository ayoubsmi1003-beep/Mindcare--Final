/**
 * `classifieur-jev.ts` — PRÉ-ROUTAGE RAPIDE PAR MODÈLE DE DÉCISION (spike Slice 1).
 *
 * ═══ CE QUE JEV EST, ET N'EST PAS ═══
 * `typesafe/jev-1.13` (registre OpenRouter, 2026-09-18) n'est PAS un LLM de
 * conversation : il ne génère aucun texte. Il répond à des questions typées
 * (`choice`, `noul`) via l'API Decisions (`decisions()` dans la passerelle).
 * Il ne peut donc NI extraire des entités (pas de `patientMention`), NI
 * valider un `Intent` complet : ce module rend un VERDICT DE ROUTE
 * (`patient` | `connaissance` | `commit`) + un signal patient, que la couche
 * déterministe (M02, extraction, portes) exploite ensuite. L'extraction
 * d'intention complète reste l'affaire de M01.
 *
 * ═══ PLACE PRÉVUE (NON CÂBLÉE DANS CETTE SLICE) ═══
 * En production future : APRÈS le test déterministe `commit` de
 * `classifierIntentSiUtile` (le commit déterministe garde la primauté —
 * jamais un modèle ne tranche un commit), et AVANT l'appel LLM de M01.
 * Accord JEV (confiance ≥ seuil) + route déterministe → on saute M01.
 * Désaccord, confiance basse, panne → M01 nominal. Ce fichier ne change
 * AUCUN appelant : il est éprouvé seul, derrière `JARVIS_JEV_ENABLED`.
 *
 * ═══ MÊMES GARDES QUE M01 ═══
 * Message vide → `invalide`. Motif identifiant (tél/courriel) → AUCUN appel
 * réseau, `motif-interdit`. Panne/transport muet → `indisponible`. Réponse
 * malformée → `invalide`. Confiance sous le seuil → `confiance-basse`.
 * Ce module ne journalise RIEN (comme M01) et ne lève JAMAIS.
 */

import type { ReponseDecision } from "@/server/egress/external-call";

import {
  porteUnMotifInterdit,
  MAX_CARACTERES_CLASSIFIEUR,
  TIMEOUT_MS_CLASSIFIEUR,
  type RaisonEcart,
} from "./classifieur-intentions";
import { SEUIL_CONFIANCE_MIN } from "@/shared/jarvis/intentions";

/** Version du questionnement JEV — bumpée à chaque changement de questions. */
export const JEV_PROMPT_VERSION = "jev-route-v1";

/** Budget JEV : une décision doit être VITE, sinon M01 nominal fait l'affaire. */
export const TIMEOUT_MS_JEV = 4_000;

/**
 * Les deux questions posées à JEV — CANONIQUES et versionnées avec
 * `JEV_PROMPT_VERSION`. La route les envoie telles quelles (plus `state` =
 * la demande) : les modifier change ce que l'audit a enregistré, d'où le
 * versionnage explicite.
 */
export const QUESTIONS_JEV = {
  route: {
    type: "choice",
    instructions:
      "La demande porte-t-elle sur le dossier d'une personne, sur le savoir médical général, ou demande-t-elle d'accomplir un acte clinique faisant foi ?",
    criteria: {
      patient: "Question sur une personne : dossier, traitement, séances, agenda la concernant.",
      connaissance: "Question de savoir général : référentiel, définition, mécanisme, sans personne visée.",
      commit:
        "Demande d'accomplir un acte faisant foi sans confirmation : émettre, signer, enregistrer au dossier.",
    },
  },
  signalPatient: {
    type: "noul",
    instructions: "La demande désigne-t-elle une personne précise (nom propre, « ce patient », « son/sa … ») ?",
    criteria: {
      true: "Une personne est nommée ou désignée sans ambiguïté.",
      false: "Aucune personne précise : pronom nu, question générale, acte sans cible.",
    },
  },
} as const;

/** Routes que JEV est autorisé à nommer — le même trio que le routeur. */
export const ROUTES_JEV = ["patient", "connaissance", "commit"] as const;
export type RouteJev = (typeof ROUTES_JEV)[number];

/**
 * Transport minimal : l'état contre des réponses typées. `reponses: null` =
 * panne/timeout (jamais une route devinée). `modele` = nom pour l'éval.
 */
export interface TransportJev {
  questionner(
    etat: string,
    opts: { readonly timeoutMs: number },
  ): Promise<{ readonly reponses: Readonly<Record<string, ReponseDecision>> | null; readonly modele: string }>;
}

export type ResultatRouteRapide =
  | {
    readonly statut: "valide";
    readonly route: RouteJev;
    /** `noul` signalPatient ≥ 0,5 : le message désigne une personne. */
    readonly signalPatient: boolean;
    readonly confiance: number;
    readonly latenceMs: number;
    readonly modele: string;
  }
  | {
    readonly statut: "ecarte";
    readonly raison: RaisonEcart;
    readonly latenceMs: number;
    readonly modele: string;
  };

function estRoute(value: unknown): value is RouteJev {
  return typeof value === "string" && (ROUTES_JEV as readonly string[]).includes(value);
}

/**
 * Faut-il SAUTER l'appel LLM de M01 ? Oui dans UN SEUL cas : double
 * `connaissance` (déterministe + JEV confiant) SANS signal patient. Alors
 * `classification: null` rend le chemin historique — exactement ce que M01
 * aurait produit en l'absence d'intention (cas B), moins un appel modèle.
 *
 * Tout le reste (signal patient, route patient/commit côté JEV, désaccord,
 * écarté) retombe sur M01 nominal : JEV ne fait jamais monter un dossier,
 * ne tranche jamais un commit, ne remplace jamais une extraction d'entités.
 */
export function devraitSauterM01(
  rapide: ResultatRouteRapide,
  cheminDeterministe: "patient" | "connaissance",
): boolean {
  return (
    rapide.statut === "valide" &&
    rapide.route === "connaissance" &&
    cheminDeterministe === "connaissance" &&
    !rapide.signalPatient
  );
}

/**
 * Pré-route. Ne lève JAMAIS : tout échec structural devient `ecarte`.
 * Ne décide d'AUCUN refus clinique : l'appelant garde la primauté du
 * déterminisme (commit d'abord, M01 en repli).
 */
export async function routerRapideJev(
  message: string,
  transport: TransportJev,
  opts?: { readonly timeoutMs?: number | undefined },
): Promise<ResultatRouteRapide> {
  const debut = Date.now();
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS_CLASSIFIEUR;
  const demande = message.trim().slice(0, MAX_CARACTERES_CLASSIFIEUR);

  if (demande === "") {
    return { statut: "ecarte", raison: "invalide", latenceMs: Date.now() - debut, modele: "n/a" };
  }
  if (porteUnMotifInterdit(demande)) {
    return {
      statut: "ecarte",
      raison: "motif-interdit",
      latenceMs: Date.now() - debut,
      modele: "n/a",
    };
  }

  let reponse: { readonly reponses: Readonly<Record<string, ReponseDecision>> | null; readonly modele: string };
  try {
    reponse = await transport.questionner(demande, { timeoutMs });
  } catch {
    return { statut: "ecarte", raison: "indisponible", latenceMs: Date.now() - debut, modele: "n/a" };
  }

  const latenceMs = Date.now() - debut;
  if (reponse.reponses === null) {
    return { statut: "ecarte", raison: "indisponible", latenceMs, modele: reponse.modele };
  }

  const route = reponse.reponses["route"];
  const signal = reponse.reponses["signalPatient"];
  if (
    route?.type !== "choice" ||
    !estRoute(route.choice) ||
    typeof route.confidence !== "number" ||
    signal?.type !== "noul" ||
    typeof signal.noul !== "number"
  ) {
    return { statut: "ecarte", raison: "invalide", latenceMs, modele: reponse.modele };
  }
  if (route.confidence < SEUIL_CONFIANCE_MIN) {
    return { statut: "ecarte", raison: "confiance-basse", latenceMs, modele: reponse.modele };
  }
  return {
    statut: "valide",
    route: route.choice,
    signalPatient: signal.noul >= 0.5,
    confiance: route.confidence,
    latenceMs,
    modele: reponse.modele,
  };
}
