/**
 * `pages.ts` — la LOCALISATION VÉRIFIÉE d'un extrait de livre.
 *
 * ═══ CE QUE C'EST ═══
 * Une lecture PURE du marqueur de page que le chargeur a écrit dans le texte
 * du chunk : `[<book_id> p.<folio>|src:<page_pdf>]`. Le marqueur est la seule
 * autorité de page du dépôt (l'ingestion l'a produit depuis `printed_page_start`
 * / `physical_start` de l'unité canonique) ; il voyage donc avec le texte, dans
 * la même ligne que le passage cité.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · PAS un calculateur d'offset. Le décalage folio→PDF diffère par livre
 *     (mesuré : Taylor p.248/src:269, DSM p.37/src:96, Stahl p.1399/src:1399).
 *     Aucune soustraction, aucune constante, jamais.
 *   · PAS une déduction depuis un voisin. Sans marqueur dans CE chunk, la
 *     localisation est `null` — l'appelant n'affiche rien.
 *   · PAS une correction du texte source : le marqueur est reconnu, pas retiré.
 *
 * ═══ INTÉGRITÉ ═══
 * Un `book_id` de marqueur qui ne correspond pas à l'ouvrage de la source
 * (`bookId` de la recette d'édition) fait REJETER la localisation : un extrait
 * ne reçoit jamais la page d'un autre livre. Deux marqueurs divergents dans un
 * même chunk = chunk à cheval sur des pages : aucune page n'est citée.
 */

/** Ce que le marqueur nous apprend, ou pourquoi il ne dit rien. */
import { CITATION_SEPARATEUR, CITATION_SOURCE, CITATION_SOURCES, citationPage, citationPagePdf } from "@/i18n/connaissance";

export interface LocalisationPage {
  /** Identifiant d'ouvrage porté par le marqueur (`book_id` d'ingestion). */
  readonly bookId: string;
  /** Folio imprimé, seulement s'il est numérique et strictement positif. */
  readonly pageImprimee: number | null;
  /** Folio brut (`?`, chiffre romain…) — informatif, jamais affiché comme un nombre. */
  readonly pageImprimeeBrute: string | null;
  /** Index de page PDF/scan, seulement s'il est numérique et strictement positif. */
  readonly pagePdf: number | null;
  /** `ok` = marqueur exploitable ; sinon la raison stable du refus. */
  readonly motif: "ok" | "page-imprimee-inconnue" | "marqueurs-divergents";
}

/** Un marqueur complet : `[book p.<folio>|src:<page>]`. */
const MARQUEUR = /\[\s*([A-Za-z0-9._-]{1,120})\s+p\.\s*([^|\]{}<>\n]{0,24}?)\s*\|\s*src:\s*([^\]{}\n]{0,24}?)\s*\]/gu;

/** Folio numérique exploitable (1..99999). Toute autre forme reste brute. */
function folioNumerique(valeur: string): number | null {
  if (!/^\d{1,5}$/u.test(valeur)) return null;
  const nombre = Number.parseInt(valeur, 10);
  return Number.isInteger(nombre) && nombre > 0 ? nombre : null;
}

/**
 * Extrait la localisation du chunk. `null` = aucun marqueur (l'extrait n'est
 * pas localisable) ; un objet avec `motif !== "ok"` = marqueur présent mais
 * inexploitable (folio `?`, pages divergentes). Jamais d'exception.
 */
export function localiserExtrait(texte: string): LocalisationPage | null {
  if (typeof texte !== "string" || texte === "") return null;
  const marqueurs: { bookId: string; folio: string; page: string }[] = [];
  for (const m of texte.matchAll(MARQUEUR)) {
    const bookId = m[1] ?? "";
    if (bookId === "") continue;
    marqueurs.push({ bookId, folio: (m[2] ?? "").trim(), page: (m[3] ?? "").trim() });
  }
  if (marqueurs.length === 0) return null;
  const premier = marqueurs[0] as { bookId: string; folio: string; page: string };
  // Deux pages différentes dans un même chunk : le passage cité peut venir de
  // l'une ou de l'autre. On ne choisit pas.
  if (marqueurs.some((x) => x.folio !== premier.folio || x.page !== premier.page)) {
    return { bookId: premier.bookId, pageImprimee: null, pageImprimeeBrute: null, pagePdf: null, motif: "marqueurs-divergents" };
  }
  const pageImprimee = folioNumerique(premier.folio);
  const pagePdf = folioNumerique(premier.page);
  return {
    bookId: premier.bookId,
    pageImprimee,
    pageImprimeeBrute: pageImprimee === null ? premier.folio : null,
    pagePdf,
    motif: pageImprimee === null ? "page-imprimee-inconnue" : "ok",
  };
}

/**
 * Vérifie que la localisation appartient bien à l'ouvrage attendu. `bookId`
 * attendu absent (recette d'édition inconnue) → la localisation est refusée :
 * on ne cite pas une page qu'on ne peut pas rattacher à une source vérifiée.
 */
export function localisationDeLOuvrage(
  localisation: LocalisationPage | null,
  bookIdAttendu: string | null,
): LocalisationPage | null {
  if (localisation === null || bookIdAttendu === null) return null;
  if (localisation.bookId !== bookIdAttendu) return null;
  if (localisation.pageImprimee === null && localisation.pagePdf === null) return null;
  return localisation;
}

/**
 * Rend la localisation affichable. Le folio imprimé est préféré ; la page PDF
 * n'apparaît que lorsqu'elle est la seule connue, et toujours étiquetée
 * « PDF » — jamais présentée comme un folio imprimé.
 */
export function formaterLocalisation(localisation: LocalisationPage | null): string | null {
  if (localisation === null) return null;
  if (localisation.pageImprimee !== null) return citationPage(localisation.pageImprimee);
  if (localisation.pagePdf !== null) return citationPagePdf(localisation.pagePdf);
  return null;
}

/** Une source citée : titre vérifié + édition vérifiée + page vérifiée. */
export interface SourceCitation {
  readonly titre: string;
  readonly edition: string | null;
  readonly annee: number | null;
  readonly pageImprimee: number | null;
  readonly pagePdf: number | null;
}

function morceauEdition(source: SourceCitation): string {
  const edition = source.edition !== null && source.edition.trim() !== "" ? source.edition.trim() : null;
  const annee = source.annee !== null && Number.isInteger(source.annee) ? String(source.annee) : null;
  if (edition !== null && annee !== null) return `${edition}, ${annee}`;
  return edition ?? annee ?? "";
}

function morceauPage(source: SourceCitation): string | null {
  if (source.pageImprimee !== null && Number.isInteger(source.pageImprimee) && source.pageImprimee > 0) {
    return citationPage(source.pageImprimee);
  }
  if (source.pagePdf !== null && Number.isInteger(source.pagePdf) && source.pagePdf > 0) {
    return citationPagePdf(source.pagePdf);
  }
  return null;
}

function titreAffichable(titre: string): string {
  const propre = titre.normalize("NFC").replace(/\s+/gu, " ").trim();
  return propre.length > 140 ? `${propre.slice(0, 137).trimEnd()}…` : propre;
}

/**
 * La ligne de sources, ASSEMBLÉE PAR LE SERVEUR à partir des métadonnées
 * vérifiées — jamais rédigée par le modèle. Déduplique par
 * (titre, édition, année, page) et conserve l'ordre de première apparition.
 * Rend `null` si aucune source n'est citable : on n'écrit pas « Source : » à vide.
 */
export function ligneCitation(sources: readonly SourceCitation[]): string | null {
  const vues = new Set<string>();
  const lignes: string[] = [];
  for (const source of sources) {
    const titre = titreAffichable(source.titre);
    if (titre === "") continue;
    const page = morceauPage(source);
    const edition = morceauEdition(source);
    const cle = `${titre}|${edition}|${page ?? ""}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    lignes.push(`${titre}${edition === "" ? "" : ` (${edition})`}${page === null ? "" : `, ${page}`}`);
    if (lignes.length >= 4) break;
  }
  if (lignes.length === 0) return null;
  return `${lignes.length === 1 ? CITATION_SOURCE : CITATION_SOURCES} : ${lignes.join(CITATION_SEPARATEUR)}.`;
}

/**
 * Construit la citation d'une source à partir de son rang de preuve : la page
 * est lue DANS le texte de cet extrait, rattachée à l'ouvrage attendu. Toute
 * incohérence rend `{ pageImprimee: null, pagePdf: null }` — pas d'erreur.
 */
export function citationDepuisExtrait(
  extrait: string,
  source: { readonly titre: string; readonly edition: string | null; readonly annee: number | null; readonly bookId: string | null },
): SourceCitation {
  const localisation = localisationDeLOuvrage(localiserExtrait(extrait), source.bookId);
  return {
    titre: source.titre,
    edition: source.edition,
    annee: source.annee,
    pageImprimee: localisation?.pageImprimee ?? null,
    pagePdf: localisation?.pagePdf ?? null,
  };
}
