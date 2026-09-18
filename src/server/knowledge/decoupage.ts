/**
 * `decoupage.ts` — M07 · le DÉCOUPEUR STRUCTUREL DÉTERMINISTE.
 *
 * ═══ CE QUE C'EST ═══
 * Une fonction PURE (pas de base, pas de réseau, pas de LLM) qui découpe un
 * document structuré selon sa hiérarchie :
 *
 *     document → section → sous-section → paragraphe
 *
 * Chaque chunk porte son contexte (titre, section, ordre, langue) et un
 * identifiant STABLE dérivé du contenu : ré-ingérer le même document rend
 * les mêmes `chunkId` (zéro doublon), modifier un paragraphe change son
 * identité (ré-embedding ciblé), changer de version change tout.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas un `text.slice(0, 1000)` : les frontières suivent la structure.
 *     Seule exception bornée : un paragraphe monstrueux (> `LIMITE_PARAGRAPHE`)
 *     est coupé sur des frontières de phrases, dans l'ordre, sans jamais
 *     mélanger deux paragraphes.
 *   · Pas un segmenteur sémantique : aucun modèle, aucune heuristique de
 *     « sens ». Le déterminisme est le livrable, pas la finesse.
 */

import type { ChunkId, Langue, SourceId } from "./types";

/** Version du découpeur — persistée par chunk, détecte toute dérive (matrice n°26). */
export const CHUNKER_VERSION = "struct-v1" as const;

/** Normalisation appliquée au texte — versionnée pour la recette d'embedding. */
export const NORMALISATION_CHUNK = "nfkc-espace-v1" as const;

/**
 * Au-delà, un paragraphe est coupé sur des frontières de phrases.
 * Assez grand pour ne jamais toucher un corpus normal ; assez petit pour
 * borner un chunk pathologique avant l'embedding.
 */
export const LIMITE_PARAGRAPHE = 2000;

/** Une sous-section : titre + paragraphes dans l'ordre du document. */
export interface SousSectionSource {
  readonly titre: string;
  readonly paragraphes: readonly string[];
}

/** Une section : titre + paragraphes propres + sous-sections éventuelles. */
export interface SectionSource {
  readonly titre: string;
  readonly paragraphes?: readonly string[];
  readonly sousSections?: readonly SousSectionSource[];
}

/** Le document à découper : structure + identité + langue d'origine. */
export interface DocumentSource {
  readonly sourceId: SourceId;
  readonly titre: string;
  readonly version: string;
  readonly langue: Langue;
  readonly sections: readonly SectionSource[];
}

/** Un chunk découpé, prêt pour `embeddings.ts` puis `stockage.ts`. */
export interface ChunkDecoupe {
  readonly chunkId: ChunkId;
  readonly sourceId: SourceId;
  readonly titreSource: string;
  readonly versionSource: string;
  /** `null` = paragraphe hors section (document sans hiérarchie) — jamais inventée. */
  readonly section: string | null;
  readonly sousSection: string | null;
  /** Position dans le document, 0-based, stable pour une structure donnée. */
  readonly ordinal: number;
  readonly langue: Langue;
  /** Paragraphe normalisé (`NORMALISATION_CHUNK`). */
  readonly texte: string;
  /** `hacherTexte(texte)` — l'identité de contenu pour la déduplication. */
  readonly texteHash: string;
  readonly versionChunk: typeof CHUNKER_VERSION;
}

/**
 * Découpe. Même entrée → mêmes chunks, même ordre, mêmes identifiants.
 * Paragraphes vides (après normalisation) ignorés : aucun chunk vide.
 *
 * STABILITÉ D'IDENTITÉ : `chunkId` ne dépend PAS de l'ordinal — insérer un
 * paragraphe au milieu du document ne renumérote pas l'identité des autres
 * chunks. Seule l'occurrence (n-ième identique dans la même section) distingue
 * deux paragraphes jumeaux, et l'ordinal reste l'ordre d'affichage.
 */
export function decouperDocument(document: DocumentSource): ChunkDecoupe[] {
  const occurrences = new Map<string, number>();
  const chunks: ChunkDecoupe[] = [];
  let ordinal = 0;
  const emettre = (section: string | null, sousSection: string | null, texte: string): void => {
    const texteHash = hacherTexte(texte);
    const cle = [section ?? "", sousSection ?? "", texteHash].join("|");
    const occurrence = occurrences.get(cle) ?? 0;
    occurrences.set(cle, occurrence + 1);
    chunks.push(fabriquer(document, section, sousSection, ordinal++, texte, texteHash, occurrence));
  };
  for (const section of document.sections) {
    for (const texte of normaliserListe(section.paragraphes ?? [])) {
      for (const morceau of couperLong(texte)) emettre(section.titre, null, morceau);
    }
    for (const sous of section.sousSections ?? []) {
      for (const texte of normaliserListe(sous.paragraphes)) {
        for (const morceau of couperLong(texte)) emettre(section.titre, sous.titre, morceau);
      }
    }
  }
  return chunks;
}

/**
 * Le texte indexable : l'en-tête hiérarchique + le paragraphe. C'est CETTE
 * forme qui part à l'embedding — un chunk « augmente la dose » sans son
 * titre de section (« Schizophrénie — Traitement ») est une devinette, pas
 * une preuve. Déterministe, dérivée, jamais persistée à la place de `texte`.
 */
export function texteIndexable(chunk: Pick<ChunkDecoupe, "titreSource" | "section" | "sousSection" | "texte">): string {
  const fil = [chunk.titreSource, chunk.section, chunk.sousSection].filter(
    (part): part is string => typeof part === "string" && part.trim() !== "",
  );
  return fil.length === 0 ? chunk.texte : `${fil.join(" — ")} — ${chunk.texte}`;
}

/** NFKC + espaces repliés + bords taillés. Une passe, pas de récursion. */
export function normaliserTexte(texte: string): string {
  return texte.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** FNV-1a 32 bits, hexadécimal — cheville d'identité, pas un mécanisme de privacy. */
export function hacherTexte(canonique: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonique.length; i++) {
    h ^= canonique.charCodeAt(i) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function normaliserListe(paragraphes: readonly string[]): string[] {
  const sortie: string[] = [];
  for (const brut of paragraphes) {
    const texte = normaliserTexte(brut);
    if (texte !== "") sortie.push(texte);
  }
  return sortie;
}

/**
 * Coupe un paragraphe trop long sur des frontières de phrases (`.`, `!`,
 * `?`, `;`, `:` suivis d'espace, ou saut de ligne), en accumulant des
 * morceaux ≤ limite. L'ordre est préservé ; aucun contenu n'est perdu ni
 * réordonné. Un « mot » unique plus long que la limite voyage entier
 * (pathologique, porté + signalé en amont, jamais tronqué en silence).
 */
function couperLong(texte: string): string[] {
  if (texte.length <= LIMITE_PARAGRAPHE) return [texte];
  const phrases = texte.split(/(?<=[.!?;:\n])\s+/);
  const morceaux: string[] = [];
  let courant = "";
  for (const phrase of phrases) {
    const candidat = courant === "" ? phrase : `${courant} ${phrase}`;
    if (candidat.length <= LIMITE_PARAGRAPHE) {
      courant = candidat;
    } else {
      if (courant !== "") morceaux.push(courant);
      courant = phrase;
    }
  }
  if (courant !== "") morceaux.push(courant);
  return morceaux.length === 0 ? [texte] : morceaux;
}

function fabriquer(
  document: DocumentSource,
  section: string | null,
  sousSection: string | null,
  ordinal: number,
  texte: string,
  texteHash: string,
  occurrence: number,
): ChunkDecoupe {
  const chunkId = hacherTexte(
    [document.sourceId, document.version, section ?? "", sousSection ?? "", texteHash, String(occurrence)].join("|"),
  );
  return {
    chunkId,
    sourceId: document.sourceId,
    titreSource: document.titre,
    versionSource: document.version,
    section,
    sousSection,
    ordinal,
    langue: document.langue,
    texte,
    texteHash,
    versionChunk: CHUNKER_VERSION,
  };
}
