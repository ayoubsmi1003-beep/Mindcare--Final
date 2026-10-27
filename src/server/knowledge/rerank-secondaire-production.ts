/**
 * `rerank-secondaire-production.ts` — le SHELL SERVEUR du reranker secondaire.
 *
 * ═══ CE QUE C'EST ═══
 * La coquille IMPURE autour des pièces pures (`rerank-cross-encoder.ts`) pour
 * le cross-encoder mmarco-mMiniLMv2 (117,6 M, Apache-2.0) : lecture de la
 * recette épinglée, résolution du dossier modèle, vérification SHA-256,
 * import dynamique des binaires natifs, singleton paresseux. Inférence 100 %
 * locale, zéro octet externe. La voie synchrone reste l'heuristique ; la voie
 * async lève si le modèle est indisponible, et l'orchestrateur replie en le
 * signalant (`repliReranker: true`).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas la voie BGE (568 M) : `rerank-cross-encoder.ts` reste inchangé par
 *     défaut ; ce module ne fait que fournir un autre nom/version.
 *   · Pas une promotion : sans recette épinglée et sans modèle vérifié, la
 *     voie async lève et le service reste heuristique.
 */

import { existsSync } from "node:fs";
import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  chargerSessionLocale,
  resoudreDossierModele,
  verifierEmpreintesParFlux,
  type FabriqueSession,
  type OrtMinimal,
  type SessionLocalePrete,
  type TokenizerLocalMinimal,
} from "./embeddings-local";
import { extraireEmpreintesSecondaires } from "./embeddings-secondaires";
import {
  creerRerankerCrossEncoder,
  noterPairesDepuisSession,
} from "./rerank-cross-encoder";
import { HeuristiqueBaseline, type RerankerLocalAsync } from "./rerank";
import type { CandidatFusionne } from "./recherche";

/** Variable d'environnement du dossier modèle (serveur uniquement). */
export const ENV_DOSSIER_RERANK_SECONDAIRE = "MINDCARE_MMARCO_DIR" as const;

/** Fichier recette (jamais édité : nouvelle mesure = nouvelle version). */
export const CHEMIN_RECETTE_RERANK_SECONDAIRE = ["knowledge", "recette-rerank-secondaire.json"] as const;

/** Nom de dossier stable, partagé par le téléchargeur et le paquetage. */
export const SLUG_RERANK_SECONDAIRE = "mmarco-rerank" as const;

/**
 * Budget de coût mesuré sur le corpus réel (i3-4150, 2 threads) :
 *   · 8 paires × 173 tokens = 1 336 ms ; 6 paires × 109 = 540 ms.
 *   · Poste cible (i7 5e gén., 4 cœurs) ≈ moitié : 8 paires ≈ 670 ms.
 * On borne donc à 8 passages ET 160 tokens, et on SAUTE le cross-encoder
 * quand l'heuristique a déjà tranché (score ≥ 0,55) : la dépense n'a lieu que
 * sur les questions réellement ambiguës (FR→EN, paraphrases).
 */
export const CANDIDATS_RERANK = 8 as const;
export const TRONCATURE_RERANK_SECONDAIRE = 160 as const;
export const SEUIL_RERANK_INUTILE = 0.55 as const;

export interface StatutRerankSecondaire {
  readonly etat: "non-initialise" | "pret" | "indisponible";
  readonly motif?: string;
}

interface DependancesChargeurRerank {
  readonly racine: string;
  readonly lireEnv: (nom: string) => string | undefined;
  readonly existe: (chemin: string) => boolean;
  readonly ouvrirLecture: (chemin: string) => AsyncIterable<Uint8Array>;
  readonly lireFichier: (chemin: string) => string;
  readonly dossierLocalAppData: string | undefined;
  readonly importerBinaires: () => Promise<{
    readonly ort: OrtMinimal;
    readonly creerTokenizer: (json: unknown, config: unknown) => TokenizerLocalMinimal;
    readonly creerSession: FabriqueSession["creerSession"];
  }>;
}

function dependancesReelles(): DependancesChargeurRerank {
  return {
    racine: process.cwd(),
    lireEnv: (nom: string) => process.env[nom],
    existe: (chemin: string) => existsSync(chemin),
    ouvrirLecture: (chemin: string) => createReadStream(chemin),
    lireFichier: (chemin: string) => readFileSync(chemin, "utf8"),
    dossierLocalAppData: process.env["LOCALAPPDATA"],
    importerBinaires: async () => {
      const ortReel = (await import("onnxruntime-node")) as OrtMinimal & {
        readonly InferenceSession: {
          create(
            chemin: string,
            options: { readonly intraOpNumThreads: number; readonly executionProviders: readonly string[] },
          ): Promise<SessionLocalePrete["session"]>;
        };
      };
      const { Tokenizer } = (await import("@huggingface/tokenizers")) as {
        readonly Tokenizer: new (json: unknown, config: unknown) => TokenizerLocalMinimal;
      };
      return {
        ort: ortReel,
        creerTokenizer: (json: unknown, config: unknown) => new Tokenizer(json, config),
        creerSession: (
          chemin: string,
          options: { readonly intraOpNumThreads: number; readonly executionProviders: readonly string[] },
        ) => ortReel.InferenceSession.create(chemin, { ...options, intraOpNumThreads: 2 }),
      };
    },
  };
}

/** Recette minimale : modèle + révision + SHA des deux artefacts suivis. */
export interface RecetteRerankSecondaire {
  readonly model: string;
  readonly revision: string;
  readonly artifact_sha256: Readonly<Record<string, string>>;
}

export function lireRecetteRerankSecondaire(lireFichier: (chemin: string) => string, racine: string): RecetteRerankSecondaire {
  const brut = lireFichier(join(racine, ...CHEMIN_RECETTE_RERANK_SECONDAIRE));
  const recette = JSON.parse(brut) as Record<string, unknown>;
  const model = recette["model"];
  const revision = recette["revision"];
  const sha = recette["artifact_sha256"];
  if (typeof model !== "string" || model === "" || typeof revision !== "string" || revision === "") {
    throw new Error("Recette rerank secondaire illisible : recette-incomplete (model/revision).");
  }
  if (typeof sha !== "object" || sha === null) {
    throw new Error("Recette rerank secondaire illisible : recette-incomplete (artifact_sha256).");
  }
  return { model, revision, artifact_sha256: sha as Record<string, string> };
}

let statut: StatutRerankSecondaire = { etat: "non-initialise" };
let promesse: Promise<RerankerLocalAsync | null> | null = null;

async function initialiser(deps: DependancesChargeurRerank): Promise<RerankerLocalAsync | null> {
  try {
    const recette = lireRecetteRerankSecondaire(deps.lireFichier, deps.racine);
    const envModele = deps.lireEnv(ENV_DOSSIER_RERANK_SECONDAIRE);
    const cacheDev = deps.dossierLocalAppData === undefined
      ? undefined
      : join(deps.dossierLocalAppData, "MindCare", "modeles", SLUG_RERANK_SECONDAIRE);
    const dossier = resoudreDossierModele(
      {
        ...(envModele === undefined || envModele.trim() === "" ? {} : { env: envModele }),
        ressources: join(deps.racine, "resources", "models", SLUG_RERANK_SECONDAIRE),
        ...(cacheDev === undefined ? {} : { cache: cacheDev }),
      },
      deps.existe,
    );
    await verifierEmpreintesParFlux(dossier, extraireEmpreintesSecondaires({ artifact_sha256: recette.artifact_sha256 }), deps.ouvrirLecture);
    const binaires = await deps.importerBinaires();
    const prete: SessionLocalePrete = await chargerSessionLocale(
      dossier,
      deps.lireFichier,
      binaires.creerTokenizer,
      { creerSession: binaires.creerSession },
    );
    const scoreur = noterPairesDepuisSession(
      { Tensor: binaires.ort.Tensor },
      prete.session,
      prete.tokenizer,
      { maxLongueur: TRONCATURE_RERANK_SECONDAIRE },
    );
    statut = { etat: "pret" };
    return creerRerankerCrossEncoder(scoreur, {
      nom: "mmarco-mMiniLMv2",
      version: recette.revision,
      maxCandidats: CANDIDATS_RERANK,
      skipIfScoreAtLeast: SEUIL_RERANK_INUTILE,
    });
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    const motif = message.split(":")[0] ?? "indisponible";
    statut = { etat: "indisponible", motif: motif.slice(0, 80) };
    return null;
  }
}

/**
 * Le reranker secondaire de production. La voie sync reste l'heuristique ; la
 * voie async charge le modèle une fois, puis note. Modèle indisponible →
 * l'async LÈVE et l'orchestrateur replie en le signalant.
 */
export function rerankerSecondaireProduction(deps: DependancesChargeurRerank = dependancesReelles()): RerankerLocalAsync {
  return {
    nom: "mmarco-mMiniLMv2",
    version: "revision-epinglee",
    reranker: (requete: string, candidats: readonly CandidatFusionne[], topN = 5) =>
      HeuristiqueBaseline.reranker(requete, candidats, topN),
    rerankerAsync: async (
      requete: string,
      candidats: readonly CandidatFusionne[],
      topN = 5,
    ) => {
      if (promesse === null) promesse = initialiser(deps);
      const charge = await promesse;
      if (charge === null) throw new Error(`Reranker secondaire indisponible : ${statut.motif ?? "indisponible"}.`);
      return charge.rerankerAsync(requete, candidats, topN);
    },
  };
}

/** Seam de test : le prochain appel reconstruit. */
export function reinitialiserRerankSecondaireProduction(): void {
  promesse = null;
  statut = { etat: "non-initialise" };
}

export function statutRerankSecondaire(): StatutRerankSecondaire {
  return statut;
}
