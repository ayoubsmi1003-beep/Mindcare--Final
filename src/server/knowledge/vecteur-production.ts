/**
 * `vecteur-production.ts` — M07 slice 3 · le SHELL SERVEUR du vecteur requête.
 *
 * ═══ CE QUE C'EST ═══
 * La coquille IMPURE autour des pièces pures (`embeddings-local.ts`,
 * `embeddings.ts`, déjà éprouvées) : lecture env/recette/fichiers, import
 * dynamique des binaires natifs (`onnxruntime-node`, `@huggingface/tokenizers`
 * — jamais statiques : les tests et l'analyse de bundle ne les chargent pas),
 * singleton paresseux. Inférence 100 % locale : zéro octet externe (M05
 * inchangé — le triple verrou gouverne l'embedding des DOCUMENTS, pas les
 * questions calculées sur la machine).
 *
 * ═══ DÉGRADATION NOMMÉE ═══
 * Tout échec (modèle absent, recette dérivée/illisible, session en panne) →
 * `null` + statut `indisponible` + motif, JAMAIS d'exception vers l'appelant :
 * le service retombe en lexical seul (même discipline que M06 `inconnue`).
 * L'échec est mis en cache (les fichiers modèle sont statiques — redémarrer
 * pour réessayer après installation).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas du navigateur : `node:fs`/`node:crypto` — serveur Next / scripts.
 *   · Pas une inférence aveugle : session vérifiée par contrat de graphe
 *     (`inferenceDepuisSession`), recette gelée refusant toute dérive.
 */

import { existsSync } from "node:fs";
import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";

import { FournisseurLocalOnnx } from "./embeddings";
import {
  chargerSessionLocale,
  configLocaleDepuisRecette,
  extraireEmpreintes,
  inferenceDepuisSession,
  resoudreDossierModele,
  vecteurRequeteDepuisFournisseur,
  verifierEmpreintesParFlux,
  type FabriqueSession,
  type OrtMinimal,
  type SessionLocalePrete,
  type TokenizerLocalMinimal,
} from "./embeddings-local";

/** Variable d'environnement du dossier modèle (serveur uniquement, jamais `NEXT_PUBLIC_*`). */
export const ENV_DOSSIER_MODELE = "MINDCARE_BGE_M3_DIR" as const;

/** Fichier recette (miroir gelé R2, jamais édité : nouvelle mesure = nouvelle version). */
export const CHEMIN_RECETTE = ["knowledge", "recette-embedding-pinee.json"] as const;

/** Le vecteur d'une requête, ou `null` si la voie locale est indisponible (repli lexical). */
export type FnVecteurRequete = (requete: string) => Promise<readonly number[] | null>;

/** État observable du chargeur (ops/tests — le service reste muet vers l'utilisateur). */
export interface StatutVecteur {
  readonly etat: "non-initialise" | "pret" | "indisponible";
  /** Motif stable de l'indisponibilité (`modele-introuvable`, `recette-…`, `session-…`). */
  readonly motif?: string;
}

/** Dépendances injectées (pureté testable ; le réel : `node:fs`, imports dynamiques). */
export interface DependancesChargeurVecteur {
  readonly racine: string;
  readonly lireEnv: (nom: string) => string | undefined;
  readonly existe: (chemin: string) => boolean;
  readonly ouvrirLecture: (chemin: string) => AsyncIterable<Uint8Array>;
  readonly lireFichier: (chemin: string) => string;
  readonly importerBinaires: () => Promise<{
    readonly ort: OrtMinimal;
    readonly creerTokenizer: (json: unknown, config: unknown) => TokenizerLocalMinimal;
    readonly creerSession: FabriqueSession["creerSession"];
  }>;
}

export interface ChargeurVecteur {
  readonly vecteurRequete: FnVecteurRequete;
  readonly statut: () => StatutVecteur;
}

/**
 * Fabrique le chargeur (singleton d'appel : UNE initialisation, promise
 * partagée — les appels concurrents attendent la même). Toute erreur →
 * `null` + statut, jamais levée.
 */
export function creerChargeurVecteur(deps: DependancesChargeurVecteur): ChargeurVecteur {
  let statut: StatutVecteur = { etat: "non-initialise" };
  let promesse: Promise<FnVecteurRequete | null> | null = null;

  const initialiser = async (): Promise<FnVecteurRequete | null> => {
    try {
      const brutRecette = deps.lireFichier(join(deps.racine, ...CHEMIN_RECETTE));
      const recette = JSON.parse(brutRecette) as unknown;
      const config = configLocaleDepuisRecette(recette);
      // `exactOptionalPropertyTypes` : n'émettre que les clefs renseignées
      // (un `env: undefined` explicite est un type distinct de l'absence).
      const envModele = deps.lireEnv(ENV_DOSSIER_MODELE);
      const dossier = resoudreDossierModele(
        {
          ...(envModele === undefined || envModele.trim() === "" ? {} : { env: envModele }),
          ressources: join(
            deps.racine,
            "resources",
            "models",
            "bge-m3",
            String((recette as Record<string, unknown>)["revision"] ?? ""),
          ),
        },
        deps.existe,
      );
      await verifierEmpreintesParFlux(dossier, extraireEmpreintes(recette), deps.ouvrirLecture);
      const binaires = await deps.importerBinaires();
      const prete: SessionLocalePrete = await chargerSessionLocale(
        dossier,
        deps.lireFichier,
        binaires.creerTokenizer,
        { creerSession: binaires.creerSession },
      );
      const inference = inferenceDepuisSession(binaires.ort, prete.session, prete.tokenizer);
      const fournisseur = new FournisseurLocalOnnx(config, inference);
      statut = { etat: "pret" };
      return vecteurRequeteDepuisFournisseur(fournisseur);
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
function dependancesReelles(): DependancesChargeurVecteur {
  return {
    racine: process.cwd(),
    lireEnv: (nom: string) => process.env[nom],
    existe: (chemin: string) => existsSync(chemin),
    ouvrirLecture: (chemin: string) => createReadStream(chemin),
    lireFichier: (chemin: string) => readFileSync(chemin, "utf8"),
    importerBinaires: async () => {
      // Assertions SIMPLES (la double est interdite par le lint) : les types
      // réels recouvrent les interfaces minimales (comparabilité des méthodes
      // + `readonly`), sans quoi `tsc` refuse — la compatibilité est donc
      // prouvée, pas forcée. Même forme que `chargerBinaireNatif`
      // (scripts/embeddings-runtime.mjs) : espace de noms, pas de `default`.
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
        ) => ortReel.InferenceSession.create(chemin, options),
      };
    },
  };
}

let chargeurProduction: ChargeurVecteur | null = null;

/** Le chargeur de production (singleton de module, paresseux, fail-closed). */
export function chargeurVecteurProduction(): ChargeurVecteur {
  if (chargeurProduction === null) chargeurProduction = creerChargeurVecteur(dependancesReelles());
  return chargeurProduction;
}

/** Le vecteur d'une requête en production, ou `null` (repli lexical). */
export async function vecteurRequeteProduction(requete: string): Promise<readonly number[] | null> {
  return chargeurVecteurProduction().vecteurRequete(requete);
}

/** Seam de test (idiome `setDbPort`) : le prochain appel reconstruit. */
export function reinitialiserVecteurProduction(): void {
  chargeurProduction = null;
}
