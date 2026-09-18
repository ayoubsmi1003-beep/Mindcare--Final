/**
 * `embeddings.ts` — M07 · l'ABSTRACTION DE FOURNISSEUR D'EMBEDDINGS.
 *
 * ═══ CE QUE C'EST ═══
 * Le contrat `EmbeddingProvider` (futur local remplaçable sans redesign) +
 * la porte C4 `passerelleEmbedding`, défense en profondeur AVANT l'egress :
 *
 *     embeddings.ts (pré-contrôle, réutilise `classerCharge`)
 *         ↓
 *     external-call.ts (autorité finale, `classerCharge` avant tout `fetch`)
 *         ↓
 *     réseau
 *
 * Zéro `fetch` ici (règle lint `no-fetch-hors-passerelle`), zéro `pg`, zéro
 * LLM : le transport réel est INJECTÉ (`TransportEmbedding`). Le premier
 * contrôle ne remplace jamais le second (§7) — il évite seulement d'appeler
 * la passerelle avec une charge déjà condamnée.
 *
 * ═══ INVARIANT ZÉRO-OCTET (matrice n°5) ═══
 * C1, C2, UNKNOWN, C3-sans-reçu approuvé → 0 appel transport, 0 vecteur,
 * échec explicite `frontiere`. Une réponse transport malformée → `invalide`,
 * aucun vecteur partiel persisté (il n'y a d'ailleurs aucune persistance ici).
 */

import {
  classerCharge,
  TRANSFORMATIONS_APPROUVEES,
  type ClasseDonnees,
  type RecuTransformation,
} from "@/server/egress/classification";

/** Le contrat : tout fournisseur, externe comme futur local, l'implémente. */
export interface EmbeddingProvider {
  readonly nom: string;
  readonly modele: string;
  /** Version du modèle — verrou humain (porte B), détecte la dérive. */
  readonly version: string;
  readonly dimensions: number;
  /** Normalisation d'entrée — versionnée, partie de la recette. */
  readonly normalisation: string;
  /**
   * Consignes modèle-spécifiques (H0.5) : certains modèles exigent une
   * instruction requête vs document distincte (ex. E5 `query:`/`passage:`).
   * `""` = aucune. Comparées à l'octet près par `recetteCompatible`.
   */
  readonly instruction_requete: string;
  readonly instruction_document: string;
  /** Métrique de distance (H0.5) : `"cosine"` — la porte SQL utilise `<=>`. */
  readonly distance: string;
  embed(input: string[]): Promise<ResultatEmbedding>;
}

/**
 * La recette IMMUABLE (H0.5) : ce qui a produit un vecteur, persistée par
 * chunk. AUCUNE écriture de production sans correspondance EXACTE avec la
 * recette approuvée (porte B) — tout écart (modèle, révision, dimensions,
 * normalisation, consignes, distance, découpeur) impose rejet/ré-embedding,
 * jamais coexistence silencieuse.
 */
export interface RecetteEmbedding {
  readonly fournisseur: string;
  readonly modele: string;
  readonly versionModele: string;
  readonly dimensions: number;
  readonly normalisation: string;
  readonly instruction_requete: string;
  readonly instruction_document: string;
  readonly distance: string;
  readonly versionChunk: string;
}

export type CodeEchecEmbedding = "frontiere" | "invalide" | "indisponible";

export type ResultatEmbedding =
  | { readonly ok: true; readonly vecteurs: readonly (readonly number[])[]; readonly recette: RecetteEmbedding }
  | { readonly ok: false; readonly error: { readonly code: CodeEchecEmbedding; readonly message: string } };

/**
 * Transport injecté — la seule voie vers `external-call.ts` (câblée après la
 * porte B). Rend la charge brute du fournisseur (`unknown`) : la validation
 * a lieu ICI, jamais chez l'appelant.
 */
export interface TransportEmbedding {
  (textes: readonly string[]): Promise<unknown>;
}

/** Fournisseur externe C4 : pré-contrôle, transport, validation, recette. */
export class FournisseurC4Externe implements EmbeddingProvider {
  readonly nom: string;
  readonly modele: string;
  readonly version: string;
  readonly dimensions: number;
  readonly normalisation: string;
  readonly instruction_requete: string;
  readonly instruction_document: string;
  readonly distance: string;
  private readonly transport: TransportEmbedding;
  private readonly versionChunk: string;

  constructor(
    config: {
      readonly nom: string;
      readonly modele: string;
      readonly version: string;
      readonly dimensions: number;
      readonly normalisation: string;
      readonly instruction_requete: string;
      readonly instruction_document: string;
      readonly distance: string;
      readonly versionChunk: string;
    },
    transport: TransportEmbedding,
  ) {
    this.nom = config.nom;
    this.modele = config.modele;
    this.version = config.version;
    this.dimensions = config.dimensions;
    this.normalisation = config.normalisation;
    this.instruction_requete = config.instruction_requete;
    this.instruction_document = config.instruction_document;
    this.distance = config.distance;
    this.versionChunk = config.versionChunk;
    this.transport = transport;
  }

  async embed(input: string[]): Promise<ResultatEmbedding> {
    if (input.length === 0) {
      return { ok: true, vecteurs: [], recette: this.recette() };
    }
    const brut = await this.transport(input);
    const vecteurs = validerReponse(brut, this.dimensions);
    if (vecteurs === null) {
      // Réponse malformée → échec fermé, aucun vecteur partiel rendu.
      return {
        ok: false,
        error: { code: "invalide", message: "Réponse du fournisseur d'embeddings inexploitable." },
      };
    }
    return { ok: true, vecteurs, recette: this.recette() };
  }

  private recette(): RecetteEmbedding {
    return {
      fournisseur: this.nom,
      modele: this.modele,
      versionModele: this.version,
      dimensions: this.dimensions,
      normalisation: this.normalisation,
      instruction_requete: this.instruction_requete,
      instruction_document: this.instruction_document,
      distance: this.distance,
      versionChunk: this.versionChunk,
    };
  }
}

/**
 * Dimension vecteur de production — verrou R2 (M07) : le schéma 092 impose
 * `vector(1024)`. Tout fournisseur local DOIT sortir 1024, sinon refus
 * explicite (`indisponible` à la construction, `invalide` à l'exécution).
 * Changer de dimension = migration + décision humaine, jamais ici.
 */
export const DIMENSION_VECTEUR_PROD = 1024 as const;

/** Configuration d'un fournisseur local — révision épinglée EXIGÉE (R2). */
export interface ConfigFournisseurLocal {
  readonly modele: string;
  /** Révision exacte (SHA HF) — vide ou "À PINGER" = refus de construction. */
  readonly version: string;
  readonly dimensions: number;
  readonly normalisation: string;
  readonly instruction_requete: string;
  readonly instruction_document: string;
  readonly distance: string;
  readonly versionChunk: string;
}

/** Inférence locale injectée (session ONNX, jamais un `fetch`). */
export interface InferenceLocale {
  (textes: readonly string[]): Promise<unknown>;
}

/** Valide la recette locale AVANT toute inférence — échec fermé explicite. */
export function validerConfigLocale(config: ConfigFournisseurLocal): { readonly ok: true } | { readonly ok: false; readonly motif: string } {
  if (config.version.trim() === "" || config.version.includes("PINGER")) {
    return { ok: false, motif: "révision du modèle non épinglée" };
  }
  if (config.dimensions !== DIMENSION_VECTEUR_PROD) {
    return { ok: false, motif: `dimension ${config.dimensions} ≠ ${DIMENSION_VECTEUR_PROD} (schéma 092)` };
  }
  if (config.normalisation.trim() === "") {
    return { ok: false, motif: "normalisation manquante" };
  }
  if (config.distance !== "cosine") {
    return { ok: false, motif: "distance autre que cosine (porte SQL `<=>`)" };
  }
  return { ok: true };
}

/**
 * Fournisseur local R2 (M07) — borne explicite, exécution 100 % locale.
 * L'inférence est INJECTÉE (`InferenceLocale`) : aucun `fetch`, aucun `pg`,
 * aucun appel réseau ne peut partir d'ici (règle lint `no-fetch-hors-passerelle`).
 * Le câblage de la session ONNX réelle appartient à R3 ; ici le contrat seul.
 */
export class FournisseurLocalOnnx implements EmbeddingProvider {
  readonly nom = "local-onnx";
  readonly modele: string;
  readonly version: string;
  readonly dimensions: number;
  readonly normalisation: string;
  readonly instruction_requete: string;
  readonly instruction_document: string;
  readonly distance: string;
  private readonly inference: InferenceLocale;
  private readonly versionChunk: string;

  constructor(config: ConfigFournisseurLocal, inference: InferenceLocale) {
    const verdict = validerConfigLocale(config);
    if (!verdict.ok) {
      throw new Error(`Recette locale invalide : ${verdict.motif}.`);
    }
    this.modele = config.modele;
    this.version = config.version;
    this.dimensions = config.dimensions;
    this.normalisation = config.normalisation;
    this.instruction_requete = config.instruction_requete;
    this.instruction_document = config.instruction_document;
    this.distance = config.distance;
    this.versionChunk = config.versionChunk;
    this.inference = inference;
  }

  /** Préfixe requête/document natif du modèle — la recette du bench = la prod. */
  texteRequete(texte: string): string {
    return `${this.instruction_requete}${texte}`;
  }

  texteDocument(texte: string): string {
    return `${this.instruction_document}${texte}`;
  }

  async embed(input: string[]): Promise<ResultatEmbedding> {
    if (input.length === 0) {
      return { ok: true, vecteurs: [], recette: this.recette() };
    }
    const brut = await this.inference(input);
    const vecteurs = validerReponse(brut, this.dimensions);
    if (vecteurs === null) {
      return {
        ok: false,
        error: { code: "invalide", message: "Réponse de l'inférence locale inexploitable." },
      };
    }
    return { ok: true, vecteurs, recette: this.recette() };
  }

  private recette(): RecetteEmbedding {
    return {
      fournisseur: this.nom,
      modele: this.modele,
      versionModele: this.version,
      dimensions: this.dimensions,
      normalisation: this.normalisation,
      instruction_requete: this.instruction_requete,
      instruction_document: this.instruction_document,
      distance: this.distance,
      versionChunk: this.versionChunk,
    };
  }
}

/**
 * Futur fournisseur local (M13) — borne explicite, pas un leurre : sans
 * runtime local, il échoue fermé `indisponible`, jamais en repli cloud
 * silencieux (même discipline que `garderVoix`).
 */
export class FournisseurLocalIndisponible implements EmbeddingProvider {
  readonly nom = "local-indisponible";
  readonly modele = "aucun";
  readonly version = "aucune";
  readonly dimensions = 0;
  readonly normalisation = "aucune";
  readonly instruction_requete = "";
  readonly instruction_document = "";
  readonly distance = "cosine";

  async embed(_input: string[]): Promise<ResultatEmbedding> {
    return {
      ok: false,
      error: { code: "indisponible", message: "Je ne peux pas traiter cette demande localement pour le moment." },
    };
  }
}

/**
 * LA PORTE C4 (matrice n°1-5). Deux contrôles, les octets gagnent toujours :
 *   1. la classification DÉCLARÉE de la source (C4, ou C3 avec reçu approuvé) ;
 *   2. `classerCharge` sur les TEXTES réels (un faux C4 patient-identifiable bloque).
 * Tout blocage rend 0 appel transport — l'invariant est prouvé par les tests
 * en comptant les appels du transport injecté.
 */
export async function passerelleEmbedding(
  fournisseur: EmbeddingProvider,
  demande: { readonly textes: readonly string[]; readonly classification: ClasseDonnees; readonly recu?: RecuTransformation },
): Promise<ResultatEmbedding> {
  if (!declareeAutorisee(demande.classification, demande.recu ?? null)) {
    return {
      ok: false,
      error: {
        code: "frontiere",
        message: "Je ne peux pas traiter cette demande : elle contient des données du cabinet qui ne quittent pas la machine.",
      },
    };
  }
  const verdict = classerCharge(
    { textes: demande.textes },
    demande.recu ?? null,
  );
  if (verdict.decision === "BLOQUER") {
    return {
      ok: false,
      error: {
        code: "frontiere",
        message: "Je ne peux pas traiter cette demande : elle contient des données du cabinet qui ne quittent pas la machine.",
      },
    };
  }
  return fournisseur.embed([...demande.textes]);
}

function declareeAutorisee(classification: ClasseDonnees, recu: RecuTransformation | null): boolean {
  if (classification === "C4") return true;
  if (classification === "C3") {
    return recu !== null && TRANSFORMATIONS_APPROUVEES.includes(recu.transformId);
  }
  return false;
}

/**
 * Valide la charge brute : tableau de vecteurs, chacun `dimensions` nombres
 * finis. `null` = malformée — l'appelant échoue fermé, sans rien persister.
 */
function validerReponse(brut: unknown, dimensions: number): readonly (readonly number[])[] | null {
  const enveloppe = brut as { vecteurs?: unknown };
  if (typeof brut !== "object" || brut === null || !Array.isArray(enveloppe.vecteurs)) return null;
  const sortie: (readonly number[])[] = [];
  for (const vecteur of enveloppe.vecteurs) {
    if (!Array.isArray(vecteur) || vecteur.length !== dimensions) return null;
    const nombres: number[] = [];
    for (const composante of vecteur) {
      if (typeof composante !== "number" || !Number.isFinite(composante)) return null;
      nombres.push(composante);
    }
    sortie.push(nombres);
  }
  return sortie;
}

/**
 * Détecte la dérive de recette (matrice n°26, H0.5) : un chunk n'est
 * réutilisable tel quel que si le fournisseur courant reproduit EXACTEMENT
 * sa recette — modèle, révision, dimensions, normalisation, consignes
 * requête/document, distance, découpeur. Tout écart → rejet / ré-embedding,
 * jamais coexistence silencieuse.
 */
export function recetteCompatible(
  recetteChunk: Pick<
    RecetteEmbedding,
    | "fournisseur"
    | "modele"
    | "versionModele"
    | "dimensions"
    | "normalisation"
    | "instruction_requete"
    | "instruction_document"
    | "distance"
    | "versionChunk"
  >,
  fournisseur: Pick<
    EmbeddingProvider,
    | "nom"
    | "modele"
    | "version"
    | "dimensions"
    | "normalisation"
    | "instruction_requete"
    | "instruction_document"
    | "distance"
  >,
  versionChunkCourante: string,
): boolean {
  return (
    recetteChunk.fournisseur === fournisseur.nom &&
    recetteChunk.modele === fournisseur.modele &&
    recetteChunk.versionModele === fournisseur.version &&
    recetteChunk.dimensions === fournisseur.dimensions &&
    recetteChunk.normalisation === fournisseur.normalisation &&
    recetteChunk.instruction_requete === fournisseur.instruction_requete &&
    recetteChunk.instruction_document === fournisseur.instruction_document &&
    recetteChunk.distance === fournisseur.distance &&
    recetteChunk.versionChunk === versionChunkCourante
  );
}
