/**
 * `editions.ts` — l'IDENTITÉ BIBLIOGRAPHIQUE des ouvrages qualifiés.
 *
 * ═══ CE QUE C'EST ═══
 * Une table FERMÉE, vérifiée contre les paquets canoniques
 * (`knowledge/canonical-v2/<livre>/book.json`), qui associe le titre EXACT
 * stocké dans `knowledge_sources.titre` à :
 *   · l'identifiant d'ouvrage d'ingestion (`book_id`) — celui du marqueur de
 *     page, seul moyen de rattacher une page au bon livre ;
 *   · l'édition canonique (`book.json.edition`, garde de dérive) ;
 *   · l'édition courte affichable et l'année ;
 *   · la version de source (`sha256:…`) réellement stockée en base.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · PAS un catalogue de retrieval : l'admission à la réponse Alexa reste
 *     décidée par `knowledge-query.ts` (DSM-5 + Maudsley uniquement, dérision
 *     d'édition refusée). Cette table ne fait qu'habiller une source DÉJÀ
 *     autorisée par les portes SQL.
 *   · PAS une correspondance approximative : titre normalisé ET version
 *     exacte. Un titre qui ressemble ou une version qui a bougé → `null`.
 *     On préfère ne rien afficher plutôt que d'attribuer une édition fausse.
 *   · PAS une source de contenu clinique : aucun texte, aucune page, aucune
 *     assertion médicale ici.
 *
 * Un test lit les `book.json` du dépôt et refuse toute dérive entre cette
 * table et les paquets canoniques.
 */

export interface EditionOuvrage {
  /** Titre exact de `knowledge_sources.titre`. */
  readonly titre: string;
  /** `book_id` d'ingestion, porté par le marqueur de page. */
  readonly bookId: string;
  /** Édition canonique, telle qu'écrite dans `book.json` (garde de dérive). */
  readonly editionCle: string;
  /** Édition courte affichable en français. */
  readonly edition: string;
  /** Millésime de l'édition. */
  readonly annee: number;
  /** Version de source stockée (`sha256:…`) ; `null` = non ingérée. */
  readonly version: string | null;
  readonly langue: "fr" | "en";
}

/** Les deux seuls ouvrages admis à répondre (décision D2). */
export const EDITIONS: readonly EditionOuvrage[] = [
  {
    titre: "DSM-5 — Manuel diagnostique et statistique des troubles mentaux",
    bookId: "dsm5-fr-2015-elsevier",
    editionCle: "5e édition, traduction française (DSM-5, Fifth Edition 1-1276)",
    edition: "5e éd.",
    annee: 2015,
    version: "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53",
    langue: "fr",
  },
  {
    titre: "The Maudsley Prescribing Guidelines in Psychiatry",
    bookId: "maudsley-prescribing-guidelines-2021-taylor-14e",
    editionCle: "14th Edition / 2021",
    edition: "14e éd.",
    annee: 2021,
    version: "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0",
    langue: "en",
  },
] as const;

/** Normalisation de FORME seule : casse, accents, espaces. Jamais de fusion. */
export function normaliserTitre(titre: string): string {
  return titre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Résout l'identité bibliographique d'une source de porte. `null` si le titre
 * n'est pas qualifié, ou si la version stockée ne correspond pas à celle du
 * paquet canonique (dérive → aucune édition revendiquée).
 */
export function editionDe(titre: string, version: string): EditionOuvrage | null {
  const cherche = normaliserTitre(titre);
  for (const ouvrage of EDITIONS) {
    if (normaliserTitre(ouvrage.titre) !== cherche) continue;
    if (ouvrage.version !== null && ouvrage.version !== version) return null;
    return ouvrage;
  }
  return null;
}
