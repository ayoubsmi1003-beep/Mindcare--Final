/**
 * `expansion.ts` — M07 · l'ÉLARGISSEMENT CONTEXTUEL BORNÉ (H6, défaut OFF).
 *
 * ═══ CE QUE C'EST ═══
 * Le chaînon manquant entre « fragment de dose » et « exception adjacente » :
 * un chunk récupéré peut tirer, de façon DÉTERMINISTE et BORNÉE, le contexte
 * qui l'empêche d'être dangereux seul — typiquement l'avertissement ou la
 * contre-indication du paragraphe voisin, ou l'en-tête de sa section.
 *
 * Contraintes dures (H6), toutes testées :
 *   · même source, même version, même langue, même lignée structurelle ;
 *   · relation EXPLICITE et bornée (`avertissement-adjacent` | `entete-section`) ;
 *   · jamais de voisins aveugles : seuls les chunks dont la section porte un
 *     marqueur d'avertissement (`MARQUEURS_AVERTISSEMENT`, versionnés) ou
 *     l'en-tête de section sont éligibles ;
 *   · chaque item élargi garde sa provenance complète (jamais de blob
 *     fusionné sans provenance) ;
 *   · l'élargissement court AVANT le budget, et le plafond 8000 caractères
 *     est DUR — aucune expansion après application du budget.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas actif par défaut : le service ne l'appelle pas (porte `p_elargir`
 *     = variante Gate A). Ce module est le seam pur, testé, en attente.
 *   · Pas une seconde récupération : il ne cherche rien, il complète un
 *     chunk déjà autorisé avec ses voisins déjà autorisés.
 */

import type { ChunkDecoupe } from "./decoupage";
import { LIMITES } from "./recherche";

/**
 * Marqueurs de section éligibles à l'élargissement (FR/AR), versionnés avec
 * le découpeur : un voisin n'est tiré que si SA section les porte. Liste
 * fermée — l'ajout d'un marqueur est une décision de corpus, pas du code
 * qui devine ce qui est « important ».
 */
export const MARQUEURS_AVERTISSEMENT: ReadonlySet<string> = new Set([
  "avertissement",
  "contre-indication",
  "contre-indications",
  "mise en garde",
  "précaution",
  "précautions",
  "تحذير",
  "موانع",
  "احتياط",
]);

/** Relation explicite portée par chaque item élargi. */
export type RelationExpansion = "avertissement-adjacent" | "entete-section";

/** Un item élargi : le chunk voisin + pourquoi il voyage. */
export interface Expansion {
  readonly chunk: ChunkDecoupe;
  readonly relation: RelationExpansion;
}

function sectionMarquee(section: string | null): boolean {
  if (section === null) return false;
  const minuscule = section.toLowerCase();
  for (const marqueur of MARQUEURS_AVERTISSEMENT) {
    if (minuscule.includes(marqueur)) return true;
  }
  return false;
}

/**
 * Sélectionne l'expansion pour UN chunk récupéré, dans la liste ordonnée des
 * chunks de la MÊME source/version/langue (ordre `ordinal`). Au plus UN
 * voisin averti adjacent (précédent puis suivant, premier trouvé) + l'en-tête
 * de section si le chunk n'en est pas un lui-même. Déterministe, borné à 2.
 *
 * L'appelant (service, porte `p_elargir`) applique ensuite le budget DUR :
 * les expansions qui dépassent `BUDGET_OCTETS` sont abandonnées, jamais
 * tronquées (un avertissement coupé est pire que rien).
 */
export function selectionnerExpansion(
  cible: ChunkDecoupe,
  fratrie: readonly ChunkDecoupe[],
): Expansion[] {
  const memeLignee = fratrie.filter(
    (autre) =>
      autre.sourceId === cible.sourceId &&
      autre.versionSource === cible.versionSource &&
      autre.langue === cible.langue &&
      autre.chunkId !== cible.chunkId,
  );
  const sortie: Expansion[] = [];
  const parOrdinal = new Map<number, ChunkDecoupe>();
  for (const autre of memeLignee) parOrdinal.set(autre.ordinal, autre);

  const precedent = parOrdinal.get(cible.ordinal - 1);
  const suivant = parOrdinal.get(cible.ordinal + 1);
  const voisinAverti =
    precedent !== undefined && sectionMarquee(precedent.section)
      ? precedent
      : suivant !== undefined && sectionMarquee(suivant.section)
        ? suivant
        : undefined;
  if (voisinAverti !== undefined) {
    sortie.push({ chunk: voisinAverti, relation: "avertissement-adjacent" });
  }

  const entete = memeLignee.find(
    (autre) => autre.section === cible.section && autre.sousSection === null && autre.ordinal < cible.ordinal,
  );
  if (entete !== undefined && entete.chunkId !== voisinAverti?.chunkId) {
    sortie.push({ chunk: entete, relation: "entete-section" });
  }
  return sortie;
}

/**
 * Applique le plafond DUR : les items (preuves + expansions) qui dépassent
 * `BUDGET_OCTETS` (défaut `LIMITES.BUDGET_OCTETS`) sont abandonnés ENTIERS,
 * par la fin — les expansions d'abord, jamais la preuve d'origine. Rend les
 * retenus + si une coupe a eu lieu. Aucune expansion n'a lieu après cet
 * appel : l'ordre pipeline est sélection → budget → clôture, sans retour.
 */
export function appliquerPlafondDur<T extends { readonly texte: string }>(
  preuves: readonly T[],
  expansions: readonly T[],
  budget: number = LIMITES.BUDGET_OCTETS,
): { readonly retenus: readonly T[]; readonly tronque: boolean } {
  let total = 0;
  const retenus: T[] = [];
  for (const preuve of preuves) {
    if (total + preuve.texte.length > budget) return { retenus, tronque: true };
    total += preuve.texte.length;
    retenus.push(preuve);
  }
  let tronque = false;
  for (const expansion of expansions) {
    if (total + expansion.texte.length > budget) {
      tronque = true;
      continue;
    }
    total += expansion.texte.length;
    retenus.push(expansion);
  }
  return { retenus, tronque };
}
