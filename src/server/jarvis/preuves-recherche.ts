/**
 * `preuves-recherche.ts` — M07 slice 3 · récupération gouvernée pour la passerelle.
 *
 * Le chemin connaissance récupère les preuves AVANT l'appel au modèle :
 * hybride-live (lexical + BGE-M3 local paresseux, calibration A3) via les
 * portes allowlistées, sous l'identité de l'appelante (le `rpc` injecté porte
 * déjà le JWT via `withCaller`). Même orchestration partagée que le service
 * (`orchestrerRecherche`) : validation + gouvernance + fusion + rerank +
 * qualification + budget — UNE sémantique, pas deux.
 *
 * Échec de porte ou modèle absent → lexical seul ou liste vide (dégradations
 * honnêtes : le prompt v3.2 instruit le constat d'absence, jamais une panne
 * ne tue la réponse). Zéro octet externe : l'embedding est calculé sur la
 * machine (M05). Pureté testable : le `rpc` et le vecteur sont injectés,
 * aucune I/O ici.
 */

import { LIMITES, orchestrerRecherche } from "@/server/knowledge/recherche";
import { CALIBRATION_A3 } from "@/server/knowledge/rerank";
import { porteLexicale, porteVectorielle } from "@/server/knowledge/stockage";
import { vecteurRequeteProduction } from "@/server/knowledge/vecteur-production";
import type { PreuveConnnaissance } from "@/shared/jarvis/preuves";

export interface RpcPreuves {
  readonly rpc: <T = unknown>(
    nom: string,
    args?: Readonly<Record<string, unknown>>,
  ) => Promise<{ readonly data: T | null; readonly error: { readonly message?: unknown } | null }>;
}

/** Vecteur requête injectable (le réel : BGE-M3 local paresseux, `null` = lexical seul). */
export type FnVecteurPreuves = (requete: string) => Promise<readonly number[] | null>;

/** Extraits plafonnés au contrat fil (le client revalide de toute façon). */
export const MAX_EXTRAIT_FIL = 800;

/** État machine de la récupération : succès, preuves faibles, absence, ou panne. */
export type EtatRecuperation = "ok" | "faible" | "sans-preuve" | "panne";

export interface ResultatPreuves {
  readonly preuves: PreuveConnnaissance[];
  readonly etat: EtatRecuperation;
}

export async function recupererPreuves(
  client: RpcPreuves,
  question: string,
  vecteurRequete: FnVecteurPreuves = vecteurRequeteProduction,
): Promise<ResultatPreuves> {
  try {
    const requete = question.slice(0, 500);
    const porte = porteLexicale(requete, "toutes", LIMITES.LEXICAL);
    const { error, data } = await client.rpc<unknown[]>("search_knowledge_lexical", {
      p_requete: porte.args["p_requete"],
      p_langue: porte.args["p_langue"],
      p_limite: porte.args["p_limite"],
    });
    if (error !== null || !Array.isArray(data)) return { preuves: [], etat: "panne" };
    // Jambe vectorielle (hybride-live) : modèle absent ou porte en panne →
    // lexical seul, jamais d'exception (même honnêteté que la jambe lexicale).
    let lignesVectorielles: readonly unknown[] = [];
    const vecteur = await vecteurRequete(requete).catch(() => null);
    if (vecteur !== null) {
      const porteV = porteVectorielle(JSON.stringify([...vecteur]), LIMITES.VECTORIEL);
      const resVec = await client
        .rpc<unknown[]>("search_knowledge_vector", {
          p_embedding_json: porteV.args["p_embedding_json"],
          p_limite: porteV.args["p_limite"],
        })
        .catch(() => ({ error: { message: "indisponible" }, data: null }));
      if (resVec.error === null && Array.isArray(resVec.data)) lignesVectorielles = resVec.data;
    }
    const { evidences, issue } = await orchestrerRecherche(question, data, lignesVectorielles, undefined, CALIBRATION_A3);
    const preuves = evidences.map((e) => ({
      titre: e.sourceTitre,
      section: e.section,
      version: e.sourceVersion,
      extrait: e.texte.slice(0, MAX_EXTRAIT_FIL),
    }));
    // L'issue `faible` voyage jusqu'au prompt (marqueur PREUVES_FAIBLES) :
    // la passerelle ne requalifie jamais du faible en solide.
    if (preuves.length === 0) return { preuves, etat: "sans-preuve" as const };
    return { preuves, etat: issue === "faible" ? ("faible" as const) : ("ok" as const) };
  } catch {
    return { preuves: [], etat: "panne" };
  }
}
