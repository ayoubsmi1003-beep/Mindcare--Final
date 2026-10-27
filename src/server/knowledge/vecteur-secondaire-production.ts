/**
 * `vecteur-secondaire-production.ts` — le SHELL SERVEUR du vecteur secondaire.
 *
 * ═══ CE QUE C'EST ═══
 * La coquille IMPURE autour des pièces pures (`embeddings-secondaires.ts`) :
 * lecture de la recette épinglée, résolution du dossier modèle, vérification
 * SHA-256, import dynamique des binaires natifs, singleton paresseux.
 * Inférence 100 % locale, zéro octet externe.
 *
 * ═══ DÉGRADATION NOMMÉE ═══
 * Tout échec (modèle absent, recette dérivée, empreinte invalide, session en
 * panne) → `null` + statut `indisponible` + motif. L'appelant retombe alors en
 * lexical seul, en le DISANT (`vectoriel: "indisponible"`). Jamais d'exception
 * vers la requête.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas l'index BGE-M3 : `vecteur-production.ts` reste inchangé. Les deux
 *     modèles ne se mélangent jamais (188 filtre `modele` + `version`).
 *   · Pas un remplacement silencieux : sans recette épinglée, rien n'est chargé.
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
import {
  configSecondaireDepuisRecette,
  extraireEmpreintesSecondaires,
  inferenceSecondaireDepuisSession,
  vecteurRequeteSecondaire,
} from "./embeddings-secondaires";
import type { ConfigFournisseurLocal } from "./embeddings";

/** Variable d'environnement du dossier modèle secondaire (serveur uniquement). */
export const ENV_DOSSIER_SECONDAIRE = "MINDCARE_E5_DIR" as const;

/** Variable d'environnement qui choisit l'ESPACE secondaire (384 ou 768). */
export const ENV_RECETTE_SECONDAIRE = "KNOWLEDGE_VECTOR_RECETTE" as const;

/** Espace par défaut : 384d (historique). Le 768d est opt-in explicite. */
export const SLUG_RECETTE_SECONDAIRE_DEFAUT = "e5-small" as const;

/** Un chemin de recette par espace approuvé — jamais un chemin calculé. */
export const CHEMINS_RECETTE_SECONDAIRE: Readonly<Record<string, readonly string[]>> = {
  "e5-small": ["knowledge", "recette-embedding-secondaire.json"],
  "e5-base": ["knowledge", "recette-embedding-secondaire-768.json"],
};

/** Fichier recette de l'espace 384d (compatibilité : l'historique). */
export const CHEMIN_RECETTE_SECONDAIRE = CHEMINS_RECETTE_SECONDAIRE["e5-small"] as readonly string[];

/** Nom de dossier stable, partagé par le téléchargeur et le paquetage. */
export const SLUG_MODELE_SECONDAIRE = "e5-small" as const;

export type FnVecteurSecondaire = (requete: string) => Promise<readonly number[] | null>;

export interface StatutVecteurSecondaire {
  readonly etat: "non-initialise" | "pret" | "indisponible";
  readonly motif?: string;
}

export interface DependancesChargeurSecondaire {
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

export interface ChargeurSecondaire {
  readonly vecteurRequete: FnVecteurSecondaire;
  readonly statut: () => StatutVecteurSecondaire;
}

/**
 * Fabrique le chargeur (singleton d'appel : UNE initialisation, promesse
 * partagée — les appels concurrents attendent la même).
 */
export function creerChargeurSecondaire(deps: DependancesChargeurSecondaire): ChargeurSecondaire {
  let statut: StatutVecteurSecondaire = { etat: "non-initialise" };
  let promesse: Promise<FnVecteurSecondaire | null> | null = null;

  const initialiser = async (): Promise<FnVecteurSecondaire | null> => {
    try {
      // L'espace est choisi par un SLUG fermé : ni chemin ni nom de modèle
      // calculés. Un slug inconnu est un refus explicite (repli lexical).
      const slug = deps.lireEnv(ENV_RECETTE_SECONDAIRE)?.trim() || SLUG_RECETTE_SECONDAIRE_DEFAUT;
      const cheminRecette = CHEMINS_RECETTE_SECONDAIRE[slug];
      if (cheminRecette === undefined) throw new Error("recette-inconnue : espace secondaire non approuvé.");
      const brut = deps.lireFichier(join(deps.racine, ...cheminRecette));
      const recette = JSON.parse(brut) as unknown;
      const config: ConfigFournisseurLocal = configSecondaireDepuisRecette(recette);
      const envModele = deps.lireEnv(ENV_DOSSIER_SECONDAIRE);
      const cacheDev = deps.dossierLocalAppData === undefined
        ? undefined
        : join(deps.dossierLocalAppData, "MindCare", "modeles", slug);
      const dossier = resoudreDossierModele(
        {
          ...(envModele === undefined || envModele.trim() === "" ? {} : { env: envModele }),
          ressources: join(deps.racine, "resources", "models", slug),
          ...(cacheDev === undefined ? {} : { cache: cacheDev }),
        },
        deps.existe,
      );
      // Deux empreintes seulement (model.onnx + tokenizer.json) : le schéma
      // BGE-M3 (`extraireEmpreintes`) exige un `model.onnx_data` externe que
      // les modèles E5 n'ont PAS. L'appliquer ici rendait tout l'espace
      // secondaire `indisponible` — défaut dormant tant que la branche
      // vectorielle restait éteinte.
      const empreintes = extraireEmpreintesSecondaires(recette);
      await verifierEmpreintesParFlux(dossier, empreintes, deps.ouvrirLecture);
      const binaires = await deps.importerBinaires();
      const prete: SessionLocalePrete = await chargerSessionLocale(
        dossier,
        deps.lireFichier,
        binaires.creerTokenizer,
        { creerSession: binaires.creerSession },
      );
      const inference = inferenceSecondaireDepuisSession(
        { Tensor: binaires.ort.Tensor },
        prete.session,
        prete.tokenizer,
        { dimensions: config.dimensions },
      );
      statut = { etat: "pret" };
      return vecteurRequeteSecondaire(config, inference);
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      const motif = message.split(":")[0] ?? "indisponible";
      statut = { etat: "indisponible", motif: motif.slice(0, 80) };
      return null;
    }
  };

  return {
    vecteurRequete: async (requete: string) => {
      if (promesse === null) promesse = initialiser();
      const chargee = await promesse;
      if (chargee === null) return null;
      try {
        return await chargee(requete);
      } catch {
        return null;
      }
    },
    statut: () => statut,
  };
}

/** Dépendances réelles (serveur Next / main Electron — jamais le navigateur). */
function dependancesReelles(): DependancesChargeurSecondaire {
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

let chargeurProduction: ChargeurSecondaire | null = null;

/** Le chargeur de production (singleton de module, paresseux, fail-closed). */
export function chargeurSecondaireProduction(): ChargeurSecondaire {
  if (chargeurProduction === null) chargeurProduction = creerChargeurSecondaire(dependancesReelles());
  return chargeurProduction;
}

/** Le vecteur secondaire d'une requête, ou `null` (repli lexical explicite). */
export async function vecteurRequeteSecondaireProduction(requete: string): Promise<readonly number[] | null> {
  return chargeurSecondaireProduction().vecteurRequete(requete);
}

/** Seam de test (idiome `setDbPort`) : le prochain appel reconstruit. */
export function reinitialiserVecteurSecondaireProduction(): void {
  chargeurProduction = null;
}
