/**
 * `citations.ts` — la VÉRIFICATION DÉTERMINISTE des citations de connaissance.
 *
 * ═══ CE QUE C'EST ═══
 * Une fonction PURE qui confronte le TEXTE produit par le modèle à l'ensemble
 * de preuves GOUVERNÉES déjà attaché au tour (`PreuveConnnaissance[]`) : toute
 * attribution explicite de source doit désigner un item de CET ensemble, avec
 * une édition/version compatible quand elle est revendiquée. Aucune base,
 * aucun réseau, aucun second retrieval — l'ensemble du tour est l'autorité,
 * il n'est jamais élargi ni réinterrogé ici.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas une autorisation : les portes SQL + `lignePorteRecuperable` ont déjà
 *     décidé CE qui est récupérable. Ceci vérifie CE QUE LE MODÈLE PRÉTEND,
 *     jamais davantage.
 *   · Pas un re-retrieval : une source qui existe dans le corpus mais pas dans
 *     le tour reste INVALIDE ici (c'est exactement le défaut à fermer).
 *   · Pas un correcteur : en cas d'attribution invalide, le verdict est
 *     `rejete` — l'appelant échoue fermé (jamais de substitution silencieuse
 *     d'une autre source, jamais de réécriture de la prose du modèle).
 *   · Pas un juge de la prose ordinaire : une mention vague sans attribution
 *     explicite n'est pas une citation (le vague ne se vérifie pas, il
 *     s'ignore — avec tests).
 *
 * ═══ IDENTITÉ BIBLIOGRAPHIQUE ═══
 * La normalisation ne traite que la FORME (casse, accents, ponctuation,
 * espaces) : elle ne fusionne jamais deux ouvrages ni deux éditions.
 * `DSM-5` ≠ `DSM-5-TR` (garde de continuation), `5e édition` ≠ `4e édition`,
 * `2026` ≠ `2026-09-15` sauf inclusion stricte documentée (année seule ⊂
 * version datée complète — le millésime identifie sans ambiguïté).
 */

import type { PreuveConnnaissance } from "@/shared/jarvis/preuves";

/** Une attribution explicite reconnue dans la réponse. */
export interface CitationReconnue {
  /** Index dans l'ensemble de preuves du tour (autorité). */
  readonly preuve: number;
  /** Titre tel que revendiqué (forme normalisée). */
  readonly titreRevendique: string;
  /** Édition/version revendiquée, ou `null` si aucune. */
  readonly editionRevendiquee: string | null;
}

/** Verdict déterministe : accepté, ou rejeté avec motif stable. */
export type VerdictCitation =
  | { readonly verdict: "accepte"; readonly citations: readonly CitationReconnue[] }
  | { readonly verdict: "rejete"; readonly motif: MotifRejet; readonly detail: string };

export type MotifRejet =
  | "source-inconnue"
  | "edition-absente"
  | "reference-hors-portee"
  | "citation-ambigue";

/**
 * Normalisation de FORME uniquement : minuscules, sans accents, apostrophes
 * et traits d'union unifiés, ponctuation décorative retirée, espaces
 * resserrés. Ne touche jamais au contenu bibliographique (chiffres, sigles
 * et mots conservés tels quels).
 */
export function normaliserForme(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ʼ'‘’`]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[«»"“”„‟]/g, " ")
    .replace(/[^a-z0-9&+\s.'\/()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nom court d'un titre : segment avant le premier séparateur éditorial.
 * Reçoit une forme NORMALISÉE (tirets cadratins déjà repliés en `-`) :
 * on coupe sur `-`, `:` entourés d'espaces, `(` et `,`.
 * `dsm-5 - manuel…` → `dsm-5`. Le trait d'union SANS espaces ne sépare
 * jamais (`dsm-5` reste entier).
 */
export function nomCourt(titreNormalise: string): string {
  const coupe = titreNormalise.split(/\s+[-:]\s+|\s*\(\s*|,\s*/);
  return (coupe[0] ?? titreNormalise).trim();
}

/** Indices d'attribution explicite (cue + span revendiqué). */
const CUES_ATTRIBUTION =
  /(selon|d['’]apres|d apres|conformement a|citee? par|rapportee? par|indiquee? par|recommandee? par|preconisee? par|mentionnee? par|rappellee? par|soulignee? par|precisee? par|prescrit par|decrit dans|dans (?:le|la|les) (?:ouvrage|guide|referentiel|manuel|livre))\s+/gi;

/** Marqueurs d'édition/version dans une forme normalisée. */
const MARQUEUR_EDITION =
  /(\d+\s*e\s*(?:edition)?|\d+\s*eme\s*edition|edition|version|revision|tr\b|rev\b|v\s*\d|sha256\s*:|\(?(?:19|20)\d{2}\)?)/i;

/** Référence indexée `source N` (écho du format `[Source N — …]`). */
const REFERENCE_SOURCE = /\bsources?\s+(\d{1,2})\b/gi;

/** Longueur minimale d'un nom court pour la détection sans cue. */
const LONGUEUR_MIN_SANS_CUE = 10;

/** Fenêtre de recherche d'une édition revendiquée autour d'un titre (caractères). */
const FENETRE_EDITION = 60;

/**
 * Vrai si `revendiquee` désigne la version `autorisee` : égalité normalisée,
 * ou inclusion stricte dans un sens (année seule ⊂ version datée, `5e` ⊂
 * `5e édition…`). L'inclusion exige ≥ 2 caractères du côté inclus pour ne
 * jamais valider sur un chiffre isolé ambigu… sauf `tr` (voir ci-dessous).
 */
function editionCompatible(revendiquee: string, autorisee: string): boolean {
  if (revendiquee === "" || autorisee === "") return false;
  if (revendiquee === autorisee) return true;
  const [petite, grande] =
    revendiquee.length <= autorisee.length ? [revendiquee, autorisee] : [autorisee, revendiquee];
  if (petite.length < 2) return false;
  // Garde anti-conflation : un suffixe d'édition (`tr`) ne se déduit jamais
  // d'une inclusion — `dsm-5` ⊂ `dsm-5-tr` est une FAUSSE compatibilité.
  // (Traitée au niveau titre par la garde de continuation ; ici on refuse
  // qu'une édition revendiquée courte valide une édition composée différente.)
  return grande.includes(petite);
}

/** Articles élidés avant l'œuvre revendiquée (`selon LE dsm-5`). */
const ARTICLES_INITIAUX = /^(?:le|la|les|l['’]|un|une|des|du|de|d['’]|au|aux)\s+/i;

/** Un token « œuvre » : capitalisé ou chiffré, ≥ 3 caractères (filtre le vague). */
function estOeuvrePotentielle(spanBrut: string): boolean {
  const span = spanBrut.replace(ARTICLES_INITIAUX, "");
  return /[A-ZÀ-Þ0-9]/.test(span.slice(0, 1)) && span.trim().length >= 3;
}

/**
 * Balayage aligné : accents retirés et apostrophes unifiées, SANS toucher à
 * la casse, à la ponctuation ni aux longueurs — chaque index reste celui du
 * texte brut (remplacements strictement 1:1). Les cues s'y détectent en
 * ASCII (`d'apres`, `precisee`) quelle que soit la frappe (`d’après`,
 * `précisée`).
 */
export function normaliserBalayage(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ʼ'‘’`]/g, "'");
}

/** Nettoie un token d'édition extrait (parens/espaces de bord). */
function nettoyerEdition(token: string): string {
  return normaliserForme(token.replace(/^[(\s]+|[)\s]+$/g, ""));
}

export interface PreuveMinimale {
  readonly titre: string;
  readonly version: string;
}

/**
 * Vérifie les citations d'une réponse contre l'ensemble de preuves DU TOUR.
 * Déterministe : même entrée, même verdict, toujours. Ne lève jamais.
 */
export function verifierCitations(
  reponse: string,
  preuves: readonly PreuveMinimale[],
): VerdictCitation {
  try {
    const citees: CitationReconnue[] = [];
    const table = preuves.map((p) => {
      const titreN = normaliserForme(p.titre);
      return { titreN, courtN: nomCourt(titreN), versionN: normaliserForme(p.version) };
    });
    const texteN = normaliserForme(reponse);

    const rejeter = (motif: MotifRejet, detail: string): VerdictCitation => ({
      verdict: "rejete",
      motif,
      detail: detail.slice(0, 120),
    });

    // Passe 1 — références indexées `source N` : N doit désigner un item du tour.
    // Passe 2 — attributions explicites : balayage aligné (apostrophes/accents
    // unifiés 1:1, casse conservée pour le signal œuvre/vague).
    const balayage = normaliserBalayage(reponse);
    for (const m of balayage.matchAll(REFERENCE_SOURCE)) {
      const n = Number.parseInt(m[1] ?? "0", 10);
      if (!Number.isInteger(n) || n < 1 || n > preuves.length) {
        return rejeter("reference-hors-portee", `source ${m[1]} hors des ${preuves.length} preuves du tour`);
      }
    }

    // Passe 2 — attributions explicites (`selon X`, `d'après X`, …).
    // Détection sur le balayage aligné (mêmes index que le brut) : la casse
    // porte le signal œuvre/vague, les accents/apostrophes sont unifiés.
    const CUES_BRUT = new RegExp(CUES_ATTRIBUTION.source, "gi");
    for (;;) {
      const m = CUES_BRUT.exec(balayage);
      if (m === null) break;
      const debut = (m.index ?? 0) + m[0].length;
      const brut = balayage.slice(debut, debut + 100).split(/[.;:!?…\n]/)[0] ?? "";
      const denude = brut.replace(ARTICLES_INITIAUX, "").trim();
      if (denude === "") return rejeter("citation-ambigue", "attribution sans objet identifiable");
      if (!estOeuvrePotentielle(denude)) continue; // vague (« selon les recommandations ») : pas une citation.
      const issue = rattacherOeuvre(denude, table);
      if (issue === null) {
        return rejeter("source-inconnue", `attribution sans preuve du tour : ${denude.slice(0, 60)}`);
      }
      if (issue === "EDITION_INCOMPATIBLE") {
        return rejeter("edition-absente", `édition revendiquée non représentée : ${denude.slice(0, 60)}`);
      }
      if (issue === "OEUVRE_AMBIGUE") {
        return rejeter("citation-ambigue", `œuvre revendiquée ambiguë : ${denude.slice(0, 60)}`);
      }
      citees.push(issue);
    }

    // Passe 3 — titres du tour mentionnés sans cue : citation ssi édition revendiquée à proximité.
    for (let i = 0; i < table.length; i++) {
      if (citees.some((c) => c.preuve === i)) continue; // déjà rattaché en passe 2 : pas de double compte.
      const court = table[i]?.courtN ?? "";
      if (court.length < LONGUEUR_MIN_SANS_CUE) continue;
      let pos = -1;
      for (;;) {
        pos = texteN.indexOf(court, pos + 1);
        if (pos < 0) break;
        // Garde de continuation : `dsm-5` dans `dsm-5-tr` n'est PAS une mention.
        const apres = texteN[pos + court.length] ?? " ";
        if (/[a-z0-9-]/.test(apres)) {
          // Prolongement (`-tr`, `5`, `a`) : autre ouvrage/édition — on laisse
          // la passe 4 (édition orpheline) ou l'absence de rattachement parler.
          continue;
        }
        const fenetre = texteN.slice(pos + court.length, pos + court.length + FENETRE_EDITION);
        const me = fenetre.match(MARQUEUR_EDITION);
        if (me === null) continue; // mention nue sans édition : prose ordinaire, pas une citation.
        const revendiquee = nettoyerEdition(me[0]);
        if (revendiquee === "") continue;
        const versionN = table[i]?.versionN ?? "";
        if (!editionCompatible(revendiquee, versionN)) {
          return rejeter("edition-absente", `édition revendiquée non représentée pour ${court.slice(0, 40)}`);
        }
        citees.push({ preuve: i, titreRevendique: court, editionRevendiquee: revendiquee });
      }
    }

    // Passe 4 — éditions orphelines : `(5e édition)` sans titre rattaché à proximité.
    for (const m of texteN.matchAll(/\(([^)]{2,80})\)/g)) {
      const interieur = (m[1] ?? "").trim();
      if (!MARQUEUR_EDITION.test(interieur)) continue;
      const debut = Math.max(0, (m.index ?? 0) - 100);
      const avant = texteN.slice(debut, m.index ?? 0);
      const rattache = table.some((t) => avant.includes(t.courtN) || avant.includes(t.titreN));
      if (!rattache) {
        return rejeter("edition-absente", `édition sans source du tour : ${interieur.slice(0, 60)}`);
      }
    }

    return { verdict: "accepte", citations: citees };
  } catch {
    // Échec fermé : un vérificateur qui ne peut pas conclure ne laisse rien passer.
    return { verdict: "rejete", motif: "citation-ambigue", detail: "vérification impossible" };
  }
}

/**
 * Rattache un span revendiqué à un item du tour : égalité au titre complet ou
 * au nom court, avec garde de continuation (le span ne doit pas prolonger le
 * titre : `dsm-5-tr` ≠ `dsm-5`). Rend l'index + l'édition éventuelle, le
 * signal `EDITION_INCOMPATIBLE` si le titre est connu mais aucune édition du
 * tour ne convient (le balayage continue sur les autres items avant), ou null.
 */
function rattacherOeuvre(
  span: string,
  table: ReadonlyArray<{ readonly titreN: string; readonly courtN: string; readonly versionN: string }>,
): CitationReconnue | "EDITION_INCOMPATIBLE" | "OEUVRE_AMBIGUE" | null {
  const spanN = normaliserForme(span);
  // Isole l'œuvre (avant la première virgule/parenthèse) et l'édition éventuelle (après).
  const oeuvreN = spanN.split(/[,(\[]/)[0]?.trim() ?? "";
  const resteN = spanN.slice(oeuvreN.length);
  let titreConnu = false;
  for (let i = 0; i < table.length; i++) {
    const t = table[i];
    if (t === undefined) continue;
    for (const candidat of [t.titreN, t.courtN]) {
      if (candidat === "" || oeuvreN.length < candidat.length) continue;
      if (!oeuvreN.startsWith(candidat)) continue;
      const prolonge = oeuvreN[candidat.length] ?? " ";
      // Garde de continuation : `dsm-5-tr`, `catalogue2`… ne valident jamais.
      if (/[a-z0-9-]/.test(prolonge) && oeuvreN !== candidat) continue;
      if (oeuvreN !== candidat && prolonge.trim() !== "") {
        // L'œuvre revendiquée dépasse le titre connu par autre chose qu'une
        // fin de mot : autre ouvrage — on continue la recherche.
        continue;
      }
      titreConnu = true;
      const me = resteN.match(MARQUEUR_EDITION);
      const editionN = me === null ? null : nettoyerEdition(me[0]);
      if (editionN !== null && editionN !== "" && !editionCompatible(editionN, t.versionN)) continue;
      return { preuve: i, titreRevendique: candidat, editionRevendiquee: editionN };
    }
  }
  if (titreConnu) return "EDITION_INCOMPATIBLE";
  // Forme courte légitime (`Référentiel` pour `Référentiel de Psychiatrie…`) :
  // préfixe de mots initiaux, ≥ 6 caractères, NON AMBIGU dans le tour.
  // Deux items partageant le préfixe = ambiguïté réelle → rejet fermé.
  if (oeuvreN.length >= 6) {
    const candidatsPrefixe: number[] = [];
    for (let i = 0; i < table.length; i++) {
      const t = table[i];
      if (t === undefined) continue;
      if (t.courtN.startsWith(`${oeuvreN} `) || t.titreN.startsWith(`${oeuvreN} `)) {
        candidatsPrefixe.push(i);
      }
    }
    if (candidatsPrefixe.length > 1) return "OEUVRE_AMBIGUE";
    if (candidatsPrefixe.length === 1) {
      const i = candidatsPrefixe[0] as number;
      const t = table[i];
      if (t !== undefined) {
        const me = resteN.match(MARQUEUR_EDITION);
        const editionN = me === null ? null : nettoyerEdition(me[0]);
        if (editionN !== null && editionN !== "" && !editionCompatible(editionN, t.versionN)) {
          return "EDITION_INCOMPATIBLE";
        }
        return { preuve: i, titreRevendique: oeuvreN, editionRevendiquee: editionN };
      }
    }
  }
  return null;
}
