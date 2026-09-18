/**
 * `connaissance-recherche.ts` — M07 · le SERVICE de recherche gouvernée.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * Les modules `server/knowledge/*` sont purs : ils n'appellent ni portes ni
 * réseau. Ce service est la fine plomberie qui les relie aux portes SQL via
 * `db()` (ADR-020) — comme tous les services du dépôt.
 *
 * ═══ ALLOWLIST (gen-db-allowlist, pré-vol 13) ═══
 * Les noms de portes sont des LITTÉRAUX aux sites d'appel ci-dessous :
 * le générateur d'allowlist refuse les noms calculés. Ne pas réintroduire
 * d'appel `rpc` via un nom variable — la porte tomberait en 404 réseau
 * alors que les tests (setDbPort) resteraient verts.
 *
 * ═══ PIPELINE ═══
 * valider → porte lexicale (+ vectorielle si embedding dispo) → filtrer
 * l'attestation (défense en profondeur, le SQL impose déjà) → fusion →
 * rerank top-5 → preuves → budget → qualifier → issue honnête.
 *
 * ═══ DÉGRADATIONS NOMMÉES ═══
 *   · Portes absentes (migration 092 non appliquée) ou erreur porte →
 *     `indisponible` honnête, jamais de preuve partielle présentée comme
 *     complète : un pipeline hybride à une jambe ne se fait pas passer pour
 *     deux (même discipline que M06 `inconnue`).
 *   · Modèle local absent (voie vectorielle indisponible) → lexical seul,
 *     repli nommé par le statut du chargeur (`vecteur-production.ts`) —
 *     jamais d'exception, jamais de silence sur la cause côté ops.
 *   · Requête vide/trop longue → refus borné avant tout appel.
 */

import {
  AUCUNE_PREUVE,
  CONNAISSANCE_INDISPONIBLE,
  HISTORIQUE_NON_DISPONIBLE,
  PREUVE_FAIBLE,
  REQUETE_TROP_LONGUE,
  REQUETE_VIDE,
} from "@/i18n/connaissance";
import {
  appliquerBudgetOctets,
  fusionnerCandidats,
  LIMITES,
  orchestrerRecherche,
  type CandidatBrut,
} from "@/server/knowledge/recherche";
import { reranker, type CalibrationFusion, type RerankerLocalAsync } from "@/server/knowledge/rerank";
import { CALIBRATION_A3 } from "@/server/knowledge/rerank";
import { vecteurRequeteProduction } from "@/server/knowledge/vecteur-production";
import { construirePreuve, qualifier } from "@/server/knowledge/preuve";
import { porteLexicale, porteVectorielle, type AppelPorte } from "@/server/knowledge/stockage";
import type { Langue, ResultatRecherche, RetrievedEvidence } from "@/server/knowledge/types";

import { db } from "./db";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/** Requête bornée : aucune requête non bornée n'atteint les portes (§18). */
export const MAX_REQUETE_CARACTERES = 500;

/**
 * Type ré-exporté depuis `server/knowledge/stockage.ts` (M07 slice 2 : UNE
 * validation pour le service comme pour la passerelle). Compatibilité des
 * tests : l'import historique depuis ce service reste valide.
 */
export type { LignePorte } from "@/server/knowledge/stockage";

export interface DependancesConnaissance {
  /** Vecteur de la requête, ou `null` si aucun fournisseur (état nominal pré-B). */
  readonly vecteurRequete: (requete: string) => Promise<readonly number[] | null>;
  /**
   * Reranker cross-encoder (R4, OPTIONNEL) : quand il est absent — ou quand
   * il lève — la baseline heuristique synchrone s'applique (fail-closed :
   * un reranker en panne ne produit jamais un ordre bricolé, il s'efface).
   * Le score transporté reste l'échelle heuristique (ranking ≠ gating).
   */
  readonly rerankerLocal?: RerankerLocalAsync;
  /**
   * Calibration de fusion (M07 slice 3, mesure uniquement) : forme du score
   * heuristique (`rerank.ts`). Absente = `CALIBRATION_COURANTE` (historique).
   * Jamais depuis le client : seuls les scripts d'évaluation la renseignent.
   */
  readonly calibration?: CalibrationFusion;
}

const DEPENDANCES_REELLES: DependancesConnaissance = {
  // Hybride-live (M07 slice 3) : BGE-M3 local paresseux, fail-closed.
  // Modèle absent → `null` → lexical seul (état nominal pré-câblage, raison
  // inchangée) ; jamais d'exception vers l'appelant. Zéro octet externe (M05).
  vecteurRequete: (requete: string) => vecteurRequeteProduction(requete),
  // Calibration A3 mesurée `--reel` (42 findings → 2, rappel intact).
  // Transparente en lexical pur (candidats corroborés : porte exempte).
  calibration: CALIBRATION_A3,
};

function traduireResultatPorte(
  resultat: Result<unknown>,
  contexte: string,
): Result<readonly unknown[]> {
  if (!resultat.ok) {
    log.error("connaissance.porte", { code: resultat.error.code, context: contexte });
    return err({
      code: "indisponible",
      message: CONNAISSANCE_INDISPONIBLE,
      context: contexte,
    });
  }
  // Enveloppe inattendue (pas un tableau de lignes) : échec fermé, jamais de
  // preuve bricolée sur une forme inconnue.
  if (!Array.isArray(resultat.data)) {
    log.error("connaissance.porte", { code: "inattendu", context: contexte });
    return err({
      code: "indisponible",
      message: CONNAISSANCE_INDISPONIBLE,
      context: contexte,
    });
  }
  return ok(resultat.data);
}

async function appelerPorteLexicale(appel: AppelPorte): Promise<Result<readonly unknown[]>> {
  // Noms NUS (sans `app.`) : pgPort qualifie lui-même, et verifierAllowlist
  // matche le proname nu — même convention que tous les services (pré-vol 13).
  const resultat = await db().rpc<unknown>("search_knowledge_lexical", appel.args);
  return traduireResultatPorte(resultat, "rpc:search_knowledge_lexical");
}

async function appelerPorteVectorielle(appel: AppelPorte): Promise<Result<readonly unknown[]>> {
  const resultat = await db().rpc<unknown>("search_knowledge_vector", appel.args);
  return traduireResultatPorte(resultat, "rpc:search_knowledge_vector");
}

/**
 * Recherche gouvernée. Ne lève jamais (contrat `Result`) ; ne rend `ok`
 * qu'avec une issue honnête — `faible` et `aucune` sont des succès HONNÊTES,
 * pas des échecs : ils disent l'insuffisance au lieu d'halluciner.
 */
export async function rechercherConnaissance(
  requete: string,
  langue: Langue | "toutes" = "toutes",
  deps: DependancesConnaissance = DEPENDANCES_REELLES,
  options: { readonly inclureHistorique?: boolean } = {},
): Promise<Result<ResultatRecherche>> {
  const question = requete.trim();
  if (question === "") {
    return ok({ issue: "aucune", evidences: [], raison: REQUETE_VIDE });
  }
  if (question.length > MAX_REQUETE_CARACTERES) {
    return err({ code: "regle-metier", message: REQUETE_TROP_LONGUE, context: "connaissance:requete" });
  }
  // H1 : l'historique est une variante de porte séparée (porte A). En
  // attendant, refus explicite — jamais de mélange silencieux.
  if (options.inclureHistorique === true) {
    return err({ code: "regle-metier", message: HISTORIQUE_NON_DISPONIBLE, context: "connaissance:historique" });
  }

  const lexical = await appelerPorteLexicale(porteLexicale(question, langue, LIMITES.LEXICAL));
  if (!lexical.ok) return err(lexical.error);

  let lignesVectorielles: readonly unknown[] = [];
  const vecteur = await deps.vecteurRequete(question);
  if (vecteur !== null) {
    const vectoriel = await appelerPorteVectorielle(
      porteVectorielle(JSON.stringify([...vecteur]), LIMITES.VECTORIEL),
    );
    if (!vectoriel.ok) return err(vectoriel.error);
    lignesVectorielles = vectoriel.data;
  }

  // Orchestration PARTAGÉE avec la passerelle (`server/knowledge/recherche.ts` :
  // `orchestrerRecherche`) : validation + gouvernance + fusion + rerank +
  // qualification + preuves + budget, UNE sémantique des deux côtés.
  const { issue, evidences, repliReranker } = await orchestrerRecherche(
    question,
    lexical.data,
    lignesVectorielles,
    deps.rerankerLocal,
    deps.calibration,
  );
  if (repliReranker) {
    // Repli heuristique déjà appliqué dans l'orchestrateur : on le garde
    // tel quel, en le journalisant ici (jamais de log direct côté serveur).
    log.error("connaissance.reranker", { code: "repli-heuristique" });
  }
  if (issue === "aucune") return ok({ issue, evidences: [], raison: AUCUNE_PREUVE });
  if (issue === "faible") return ok({ issue, evidences, raison: PREUVE_FAIBLE });
  return ok({ issue, evidences, raison: "" });
}
