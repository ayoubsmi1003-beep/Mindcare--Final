/**
 * `embeddings-secondaires.ts` — le runtime du modèle SECONDAIRE (< 300 M).
 *
 * ═══ CE QUE C'EST ═══
 * La partie PURE du chargeur de l'index secondaire (migration 188) : validation
 * de la recette épinglée, encodage, pooling moyen pondéré par `attention_mask`,
 * normalisation L2, vérification de dimension. Le modèle doit sortir
 * `last_hidden_state` (E05/ModernBERT), PAS une tête `sentence_embedding`.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas BGE-M3 : `embeddings-local.ts` reste l'index 1024d de production,
 *     intact. Les deux espaces ne se mélangent jamais (188 l'impose en SQL).
 *   · Pas une inférence : session + tokenizer sont INJECTÉS (testable hors
 *     ligne, aucun `onnxruntime` importé ici).
 *   · Pas un fallback : une recette dérivée ou une dimension inattendue est un
 *     REFUS explicite, jamais un vecteur « à peu près ».
 */

import type { ConfigFournisseurLocal, ResultatEmbedding } from "./embeddings";
import { normaliserL2 } from "./embeddings-local";

/** Dimension de l'index secondaire (miroir de la migration 188). */
export const DIMENSION_VECTEUR_SECONDAIRE = 384 as const;

/** Recette gelée du candidat E5-small (miroir du JSON épinglé, 384d). */
export const RECETTE_SECONDAIRE_GELEE = {
  modele: "intfloat/multilingual-e5-small",
  version: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
  dimensions: 384,
  normalisation: "l2-moyenne-masque-v1",
  instruction_requete: "query: ",
  instruction_document: "passage: ",
  distance: "cosine",
} as const;

/** Recette gelée de l'espace 768d (miroir de `recette-embedding-secondaire-768.json`). */
export const RECETTE_SECONDAIRE_768_GELEE = {
  modele: "intfloat/multilingual-e5-base",
  version: "d128750597153bb5987e10b1c3493a34e5a4502a",
  dimensions: 768,
  normalisation: "l2-moyenne-masque-v1",
  instruction_requete: "query: ",
  instruction_document: "passage: ",
  distance: "cosine",
} as const;

/**
 * Les DEUX espaces épinglés, indexés par leur slug de dossier modèle. Aucun
 * autre n'est admis : une recette inconnue est un refus, jamais un chargement
 * « au plus proche ».
 */
export const RECETTES_SECONDAIRES_GELEES = {
  "e5-small": RECETTE_SECONDAIRE_GELEE,
  "e5-base": RECETTE_SECONDAIRE_768_GELEE,
} as const;

export type SlugRecetteSecondaire = keyof typeof RECETTES_SECONDAIRES_GELEES;

/** Recette épinglée d'un slug, ou `null` si le slug n'est pas approuvé. */
export function recetteSecondaireGelee(slug: string): (typeof RECETTES_SECONDAIRES_GELEES)[SlugRecetteSecondaire] | null {
  return Object.hasOwn(RECETTES_SECONDAIRES_GELEES, slug)
    ? RECETTES_SECONDAIRES_GELEES[slug as SlugRecetteSecondaire]
    : null;
}

/** Troncature des passages : 128 tokens (mesuré sur le corpus réel). */
export const TRONCATURE_SECONDAIRE = 128 as const;

/** Sortie minimale d'un tokenizer (suffit à E5). */
export interface EncodageSecondaire {
  readonly ids: readonly number[];
  readonly attention_mask: readonly number[];
}

export interface TokenizerSecondaire {
  encode(texte: string): EncodageSecondaire;
  token_to_id(token: string): number | undefined;
}

export interface SessionSecondaire {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(entrees: Record<string, unknown>): Promise<Record<string, { readonly data: ArrayLike<number>; readonly dims?: readonly number[] }>>;
}

export interface ConstructeurTenseurSecondaire {
  new (type: string, data: BigInt64Array, dims: readonly number[]): unknown;
}

export interface OrtSecondaire {
  readonly Tensor: ConstructeurTenseurSecondaire;
}

/**
 * Promeut la recette JSON en config locale. Chaque champ gelé est comparé ;
 * le moindre écart → `recette-derive`. JSON illisible → `recette-illisible`.
 */
export function configSecondaireDepuisRecette(recette: unknown): ConfigFournisseurLocal {
  if (typeof recette !== "object" || recette === null) {
    throw new Error("Recette secondaire illisible : recette-vide ou type inattendu.");
  }
  const json = recette as Record<string, unknown>;
  const texte = (cle: string): string => {
    const valeur = json[cle];
    if (typeof valeur !== "string" || valeur === "") {
      throw new Error(`Recette secondaire illisible : recette-incomplete (${cle}).`);
    }
    return valeur;
  };
  const ecarts: string[] = [];
  // La dimension CHOISIT la recette épinglée : deux espaces vectoriels ne se
  // mélangent jamais. Une dimension sans recette approuvée est un refus.
  const dimensions = json["dimensions"];
  const gelee = Object.values(RECETTES_SECONDAIRES_GELEES)
    .find((candidate) => candidate.dimensions === dimensions);
  if (gelee === undefined) {
    throw new Error("Recette secondaire dérivée : recette-inconnue (dimensions).");
  }
  if (texte("model") !== gelee.modele) ecarts.push("model");
  if (texte("revision") !== gelee.version) ecarts.push("revision");
  if (json["dimensions"] !== gelee.dimensions) ecarts.push("dimensions");
  if (texte("normalization") !== gelee.normalisation) ecarts.push("normalization");
  if (texte("query_prefix") !== gelee.instruction_requete) ecarts.push("query_prefix");
  if (texte("document_prefix") !== gelee.instruction_document) ecarts.push("document_prefix");
  if (texte("distance") !== gelee.distance) ecarts.push("distance");
  if (ecarts.length > 0) {
    throw new Error(`Recette secondaire dérivée : recette-derive (${ecarts.join(", ")}).`);
  }
  return {
    modele: gelee.modele,
    version: gelee.version,
    dimensions: gelee.dimensions,
    normalisation: gelee.normalisation,
    instruction_requete: gelee.instruction_requete,
    instruction_document: gelee.instruction_document,
    distance: gelee.distance,
    versionChunk: "multi",
  };
}

/** Empreintes attendues : deux artefacts seulement (le reste est optionnel). */
export function extraireEmpreintesSecondaires(recette: unknown): Record<string, string> {
  if (typeof recette !== "object" || recette === null) {
    throw new Error("Recette secondaire illisible : recette-vide ou type inattendu.");
  }
  const bloc = (recette as Record<string, unknown>)["artifact_sha256"];
  if (typeof bloc !== "object" || bloc === null) {
    throw new Error("Recette secondaire illisible : recette-incomplete (artifact_sha256).");
  }
  const shas = bloc as Record<string, unknown>;
  const sortie: Record<string, string> = {};
  for (const [cle, fichier] of [["model_onnx", "model.onnx"], ["tokenizer_json", "tokenizer.json"]] as const) {
    const valeur = shas[cle];
    if (typeof valeur !== "string" || !/^[0-9a-f]{64}$/.test(valeur)) {
      throw new Error(`Recette secondaire illisible : empreinte-invalide (${cle}).`);
    }
    sortie[fichier] = valeur;
  }
  return sortie;
}

/** Encode un lot : troncature à `maxLongueur`, padding à droite, masques 0/1. */
export function encoderLotSecondaire(
  tokenizer: TokenizerSecondaire,
  textes: readonly string[],
  maxLongueur: number = TRONCATURE_SECONDAIRE,
): { readonly ids: number[][]; readonly attention_mask: number[][] } {
  if (!Number.isInteger(maxLongueur) || maxLongueur <= 2) {
    throw new Error("Encodage secondaire impossible : longueur max invalide.");
  }
  if (textes.length === 0) return { ids: [], attention_mask: [] };
  const idPad = tokenizer.token_to_id("<pad>") ?? 0;
  const tronques = textes.map((texte) => {
    const enc = tokenizer.encode(texte);
    let ids = [...enc.ids];
    let masque = [...enc.attention_mask];
    if (ids.length > maxLongueur) {
      ids = ids.slice(0, maxLongueur);
      masque = masque.slice(0, maxLongueur);
    }
    return { ids, masque };
  });
  let longueur = 0;
  for (const t of tronques) if (t.ids.length > longueur) longueur = t.ids.length;
  const ids: number[][] = [];
  const attention_mask: number[][] = [];
  for (const t of tronques) {
    const remplissage = longueur - t.ids.length;
    ids.push([...t.ids, ...Array<number>(remplissage).fill(idPad)]);
    attention_mask.push([...t.masque, ...Array<number>(remplissage).fill(0)]);
  }
  return { ids, attention_mask };
}

/**
 * Construit l'inférence (moyenne pondérée + L2) depuis une session injectée.
 * Vérifie le contrat du graphe AVANT tout run : entrées `input_ids` et
 * `attention_mask` présentes, sortie 3D (`last_hidden_state`). Une tête
 * `sentence_embedding` 2D est refusée : ce runtime est celui du secondaire.
 */
export function inferenceSecondaireDepuisSession(
  ort: OrtSecondaire,
  session: SessionSecondaire,
  tokenizer: TokenizerSecondaire,
  options: { readonly tailleLot?: number; readonly dimensions?: number } = {},
): (textes: readonly string[]) => Promise<readonly (readonly number[])[]> {
  const tailleLot = options.tailleLot ?? 8;
  const dimensions = options.dimensions ?? DIMENSION_VECTEUR_SECONDAIRE;
  if (!session.inputNames.includes("input_ids") || !session.inputNames.includes("attention_mask")) {
    throw new Error("Session secondaire inattendue : graphe-inattendu (entrées).");
  }
  const troisEntrees = session.inputNames.includes("token_type_ids");
  // Ce runtime est celui d'une tête 3D (`last_hidden_state`) : une tête
  // `sentence_embedding` appartient au contrat BGE-M3, pas à celui-ci.
  if (!session.outputNames.includes("last_hidden_state")) {
    throw new Error("Session secondaire inattendue : graphe-inattendu (last_hidden_state absent).");
  }
  const nomSortie = "last_hidden_state";
  return async (textes: readonly string[]) => {
    if (textes.length === 0) return [];
    const vecteurs: number[][] = [];
    for (let debut = 0; debut < textes.length; debut += tailleLot) {
      const lot = [...textes.slice(debut, debut + tailleLot)];
      const enc = encoderLotSecondaire(tokenizer, lot);
      const n = lot.length;
      const L = enc.ids[0]?.length ?? 0;
      const ids = new BigInt64Array(n * L);
      const masque = new BigInt64Array(n * L);
      const types = new BigInt64Array(n * L);
      for (let i = 0; i < n; i++) {
        const ligneIds = enc.ids[i] ?? [];
        const ligneMasque = enc.attention_mask[i] ?? [];
        for (let j = 0; j < L; j++) {
          ids[i * L + j] = BigInt(ligneIds[j] ?? 0);
          masque[i * L + j] = BigInt(ligneMasque[j] ?? 0);
        }
      }
      const entrees: Record<string, unknown> = {
        input_ids: new ort.Tensor("int64", ids, [n, L]),
        attention_mask: new ort.Tensor("int64", masque, [n, L]),
      };
      if (troisEntrees) entrees["token_type_ids"] = new ort.Tensor("int64", types, [n, L]);
      const sorties = await session.run(entrees);
      const tete = sorties[nomSortie];
      if (tete === undefined) throw new Error("Session secondaire inattendue : sortie manquante.");
      const dims = tete.dims ?? [];
      const derniere = dims[dims.length - 1] ?? 0;
      if (dims.length !== 3 || derniere !== dimensions) {
        throw new Error("Session secondaire inattendue : dimension-inattendue (tête).");
      }
      const data = tete.data;
      for (let i = 0; i < n; i++) {
        const somme = new Float64Array(dimensions);
        let total = 0;
        for (let j = 0; j < L; j++) {
          const poids = Number(masque[i * L + j]);
          if (poids === 0) continue;
          total += poids;
          for (let d = 0; d < dimensions; d++) somme[d] = (somme[d] ?? 0) + Number(data[(i * L + j) * dimensions + d]) * poids;
        }
        if (!(total > 0)) throw new Error("Session secondaire inattendue : masque vide.");
        vecteurs.push(normaliserL2(Array.from(somme, (v) => v / total)));
      }
    }
    return vecteurs;
  };
}

/** Adaptateur fournisseur : préfixe requête, premier vecteur, échec → `null`. */
export function vecteurRequeteSecondaire(
  config: ConfigFournisseurLocal,
  inference: (textes: readonly string[]) => Promise<readonly (readonly number[])[]>,
): (requete: string) => Promise<readonly number[] | null> {
  return async (requete: string) => {
    try {
      const vecteurs = await inference([`${config.instruction_requete}${requete}`]);
      const premier = vecteurs[0];
      if (premier === undefined || premier.length !== config.dimensions) return null;
      return premier;
    } catch {
      return null;
    }
  };
}

/** Résultat d'embedding (contrat partagé) — utile aux tests de non-régression. */
export type ResultatSecondaire = ResultatEmbedding;
