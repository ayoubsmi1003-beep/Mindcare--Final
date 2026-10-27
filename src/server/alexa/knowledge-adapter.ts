import { LIMITES, appliquerBudgetOctets, orchestrerRecherche } from "@/server/knowledge/recherche";
import { CALIBRATION_A3, type RerankerLocalAsync } from "@/server/knowledge/rerank";
import { SEUIL_FAIBLESSE, SEUIL_PERTINENCE } from "@/server/knowledge/preuve";
import { lignePorteRecuperable, porteLexicale, porteVectorielle, porteVectorielleV2, validerLignePorte } from "@/server/knowledge/stockage";
import type { Langue, RetrievedEvidence } from "@/server/knowledge/types";
import { editionDe, type EditionOuvrage } from "@/server/knowledge/editions";
import { carteDepuisJson, formaterLocalisation, localiserDepuisUnite, localiserExtrait, localisationDeLOuvrage, type CartePages } from "@/server/knowledge/pages";
import pagesUnites from "@/server/knowledge/pages-unites.json";
import { mapLimite } from "@/server/knowledge/parallele";
import { vecteurRequeteProduction } from "@/server/knowledge/vecteur-production";
import { vecteurRequeteSecondaireProduction } from "@/server/knowledge/vecteur-secondaire-production";
import { rerankerSecondaireProduction } from "@/server/knowledge/rerank-secondaire-production";
import { RECETTE_SECONDAIRE_GELEE } from "@/server/knowledge/embeddings-secondaires";
import type { ClientSql } from "@/server/jarvis/client-sql";
import { matchesLeafHint, matchesRequestedBook, planKnowledgeQuery,matchesSectionFocus } from "./knowledge-query";
import {headingOnlyEvidence,bibliographyEvidence,bibliographyTextEvidence,bibliographyRequested,indexEvidence,indexRequested,unboundTableEvidence} from './knowledge-evidence-content';

/** Une preuve structurée, telle que rendue par l'orchestration gouvernée. */
type Preuve = RetrievedEvidence;

/** Carte `unit_id → page` construite UNE fois au chargement du module. */
const CARTE_PAGES: CartePages = carteDepuisJson(pagesUnites);

/**
 * L'identité bibliographique VÉRIFIÉE d'une preuve. Absente quand le titre ou
 * la version ne correspondent pas au paquet canonique : on n'affiche alors que
 * la version de source, jamais une édition supposée.
 */
export interface EditionPreuve {
  readonly edition: string;
  readonly annee: number;
  readonly editionCle: string;
}

/**
 * La localisation VÉRIFIÉE d'une preuve, lue dans le marqueur de page du
 * chunk ET rattachée au `book_id` de l'ouvrage. `libelle` est la seule forme
 * affichable ; les champs numériques servent la provenance.
 */
export interface PagePreuve {
  readonly pageImprimee: number | null;
  readonly pagePdf: number | null;
  readonly libelle: string;
}

/** Une preuve prête pour la synthèse et l'affichage (provenance inséparable). */
export interface PreuveAlexa {
  readonly titre: string;
  readonly section: string | null;
  readonly version: string;
  readonly extrait: string;
  readonly langue: Langue;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly versionChunk: string;
  readonly unitId: string | null;
  readonly parentTexteHash: string | null;
  readonly enfantIndex: number | null;
  readonly enfantsTotal: number | null;
  readonly edition?: EditionPreuve;
  readonly page?: PagePreuve;
}

// Allow a complete UTF-8 passage slightly above the 8,000-character aggregate
// budget. `orchestrerRecherche` still enforces that unchanged aggregate cap.
const MAX_PASSAGE_UTF8_BYTES = 8_192;

// Le pool vaut 10 connexions : quatre portes simultanées laissent de la marge
// à une lecture clinique concurrente (voir `parallele.ts`).
const PORTES_PARALLELES = 4;

// L'index secondaire accepte jusqu'à 40 candidats ; on en demande 24 (fusion
// hybride) pour laisser de la marge au filtre d'autorité post-KNN.
const CANDIDATS_VECTORIELS = 24;

/** Résout l'identité bibliographique d'une preuve, sans jamais la deviner. */
export function identiteDePreuve(sourceTitre: string, sourceVersion: string): EditionOuvrage | null {
  return editionDe(sourceTitre, sourceVersion);
}

/**
 * Construit la preuve d'affichage : identité bibliographique résolue, puis
 * localisation lue DANS l'extrait et rattachée au `book_id` de l'ouvrage.
 * Un marqueur d'un autre livre, un folio `?` ou deux pages divergentes ne
 * produisent aucune page — jamais un nombre approximatif.
 *
 * Repli CONTRÔLÉ : si le marqueur a disparu lors d'un découpage, la page de
 * l'UNITÉ CANONIQUE (`unit_id`) est utilisée — même source, même livre,
 * vérifiée à l'ingestion. Jamais un voisin, jamais un offset.
 */
export function preuveAffichable(preuve: Preuve, carte: CartePages = CARTE_PAGES): PreuveAlexa {
  const ouvrage = identiteDePreuve(preuve.sourceTitre, preuve.sourceVersion);
  const localisation = localisationDeLOuvrage(localiserExtrait(preuve.texte), ouvrage?.bookId ?? null)
    ?? localiserDepuisUnite(preuve.unitId, ouvrage?.bookId ?? null, carte);
  const libelle = formaterLocalisation(localisation);
  return {
    titre: preuve.sourceTitre,
    section: preuve.section,
    version: preuve.sourceVersion,
    extrait: preuve.texte,
    langue: preuve.langue,
    sourceId: preuve.sourceId,
    chunkId: preuve.chunkId,
    versionChunk: preuve.versionChunk,
    unitId: preuve.unitId,
    parentTexteHash: preuve.parentTexteHash,
    enfantIndex: preuve.enfantIndex,
    enfantsTotal: preuve.enfantsTotal,
    ...(ouvrage === null
      ? {}
      : { edition: { edition: ouvrage.edition, annee: ouvrage.annee, editionCle: ouvrage.editionCle } }),
    ...(localisation === null || libelle === null
      ? {}
      : { page: { pageImprimee: localisation.pageImprimee, pagePdf: localisation.pagePdf, libelle } }),
  };
}

const issuedKnowledgeResults = new WeakSet<object>();
/** Only immutable evidence returned by the governed SQL retrieval can be summarized externally. */
export function isIssuedKnowledgeResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && issuedKnowledgeResults.has(value) && Object.isFrozen(value);
}

/**
 * Les dépendances du chemin de lecture Alexa. `vectorActif` est FAUX par
 * défaut : l'index vectoriel n'est activé qu'après provisionnement et
 * évaluation (voir `docs/RUNTIME-CONFIGURATION.md`). Une valeur différente de
 * `1` laisse exactement le comportement lexical mesuré aujourd'hui.
 */
export interface DependancesReadKnowledge {
  readonly vectorActif: boolean;
  readonly vecteurRequete?: (requete: string) => Promise<readonly number[] | null>;
  /** Cross-encoder optionnel ; absent = baseline heuristique (défaut). */
  readonly rerankerLocal?: RerankerLocalAsync;
  /**
   * Index SECONDAIRE (188) : quand il est renseigné, la branche vectorielle
   * interroge `search_knowledge_vector_v2` avec CE couple (modele, version) —
   * jamais l'index 1024d de production. Absent = ancienne porte (compatibilité).
   */
  readonly vectorielSecondaire?: { readonly modele: string; readonly version: string };
}

/** Options internes — jamais pilotées par le client. */
interface OptionsReadKnowledge {
  /**
   * Deuxième passe SANS la feuille de section : une feuille est une PRÉFÉRENCE
   * de classement, pas une condition d'existence. Mesuré : la section
   * « Trouble dépressif caractérisé › Caractéristiques diagnostiques » du
   * DSM-5 est un chunk de 11 065 caractères, refusé entier par le plafond
   * 8 192 ; la passe stricte rendait donc `sans-preuve` alors que les
   * « Critères diagnostiques » du MÊME trouble (7 775) sont sous le plafond.
   * Le focus de diagnostic, lui, n'est JAMAIS relâché.
   */
  readonly relaxerFeuille?: boolean;
}

/** Retire la feuille de section en conservant le focus et toutes les autres contraintes. */
function sansFeuille(plan: ReturnType<typeof planKnowledgeQuery>): ReturnType<typeof planKnowledgeQuery> {
  if (plan === null || plan.sectionLeaf === undefined) return plan;
  const { sectionLeaf: _feuille, ...reste } = plan;
  void _feuille;
  return reste;
}

/** Les dépendances réelles du poste : modèle local + variable d'environnement. */
export function dependancesReadKnowledge(): DependancesReadKnowledge {
  // Le drapeau suffit : l'identité du modèle vient de la RECETTE épinglée
  // (`embeddings-secondaires.ts`), jamais d'une variable d'environnement qui
  // pourrait diverger de l'index réellement construit.
  const actif = process.env["KNOWLEDGE_VECTOR"] === "1";
  // Reranker secondaire : opt-in explicite, jamais par défaut. Modèle absent
  // ou en panne → l'orchestrateur replie sur l'heuristique en le signalant.
  const avecRerank = process.env["KNOWLEDGE_RERANK"] === "mmarco";
  return {
    vectorActif: actif,
    vecteurRequete: (requete: string) => actif
      ? vecteurRequeteSecondaireProduction(requete)
      : vecteurRequeteProduction(requete),
    ...(actif
      ? { vectorielSecondaire: { modele: RECETTE_SECONDAIRE_GELEE.modele, version: RECETTE_SECONDAIRE_GELEE.version } }
      : {}),
    ...(avecRerank ? { rerankerLocal: rerankerSecondaireProduction() } : {}),
  };
}

/** Explicit lexical freeze. Assets being present must never activate vector retrieval. */
export async function readKnowledge(client: ClientSql, question: string, signal?: AbortSignal,
  deps: DependancesReadKnowledge = dependancesReadKnowledge(),
  options: OptionsReadKnowledge = {}) {
  signal?.throwIfAborted();
  try {
    const brut = planKnowledgeQuery(question);
    const plan = options.relaxerFeuille === true ? sansFeuille(brut) : brut;
    if (plan === null) return { etat: "sans-preuve" as const, preuves: [] };
    // L'embedding de la question (coûteux) démarre avec les portes lexicales,
    // pas après elles : l'inférence et les lectures SQL se recouvrent.
    const vecteurEnCours: Promise<readonly number[] | null> = deps.vectorActif === true && deps.vecteurRequete !== undefined
      ? deps.vecteurRequete(question).catch(() => null)
      : Promise.resolve(null);
    // Les reformulations planifiées sont indépendantes : quatre portes au plus
    // en parallèle, résultats remis DANS L'ORDRE du plan (voir `parallele.ts`).
    const resultats = await mapLimite(plan.queries, PORTES_PARALLELES, async (query) =>
      client.rpc<unknown[]>("search_knowledge_lexical", porteLexicale(query, plan.language, LIMITES.LEXICAL).args));
    signal?.throwIfAborted();
    const batches: unknown[][] = [];
    for (const result of resultats) {
      if (result.error || !Array.isArray(result.data)) return { etat: "panne" as const, preuves: [] };
      batches.push(result.data.filter(row => matchesRequestedBook(row, plan)));
    }
    // A prefix can remove a dose qualifier or negation. Keep whole bounded chunks,
    // and flag approved oversized passages without exposing rejected-source existence.
    let omittedLongPassages = false;
    const retenir = (candidate: unknown): unknown | null => {
      const row = validerLignePorte(candidate);
      if (row === null || !lignePorteRecuperable(row)) return null;
      if(headingOnlyEvidence(row.texte,row.section)||unboundTableEvidence(row.texte)||(indexEvidence(row.section)&&!indexRequested(question))||(bibliographyEvidence(row.section)||bibliographyTextEvidence(row.texte))&&!bibliographyRequested(question))return null;
      if (Buffer.byteLength(row.texte, "utf8") > MAX_PASSAGE_UTF8_BYTES) { omittedLongPassages = true; return null; }
      return row;
    };
    const lots: { reference: string; lignes: unknown[] }[] = [];
    for (const [index, batch] of batches.entries()) {
      const complete: unknown[] = [];
      for (const candidate of batch) {
        const row = retenir(candidate);
        if (row !== null) complete.push(row);
      }
      // Chaque lot est classé contre SA référence : c'est elle qui l'a fait
      // remonter. Un lot anglais issu de l'expansion bilingue ne doit pas être
      // mesuré contre une référence française (couverture ~0, preuve perdue).
      lots.push({ reference: plan.references[index] ?? plan.relevanceQuery, lignes: complete });
    }

    // ── Jambe vectorielle (hybride) ────────────────────────────────────────
    // Le vecteur est calculé EN PARALLÈLE des portes lexicales (démarré plus
    // haut). Une porte vectorielle en panne ne détruit pas une réponse
    // lexicale valide : on dégrade en le DISANT (`vectoriel: "indisponible"`),
    // jamais en prétendant que la recherche sémantique a réussi.
    const vecteur = await vecteurEnCours;
    let lignesVectorielles: unknown[] = [];
    let vectorielIndisponible = false;
    if (deps.vectorActif === true) {
      if (vecteur === null) vectorielIndisponible = true;
      else {
        const secondaire = deps.vectorielSecondaire;
        // Deux sites d'appel LITTÉRAUX : le générateur d'allowlist refuse les
        // noms calculés, et la porte doit rester vérifiable par pré-vol.
        const gate = secondaire !== undefined
          ? await client.rpc<unknown[]>("search_knowledge_vector_v2",
              porteVectorielleV2(JSON.stringify([...vecteur]), secondaire.modele, secondaire.version, CANDIDATS_VECTORIELS).args)
          : await client.rpc<unknown[]>("search_knowledge_vector",
              porteVectorielle(JSON.stringify([...vecteur]), LIMITES.VECTORIEL).args);
        signal?.throwIfAborted();
        if (gate.error || !Array.isArray(gate.data)) vectorielIndisponible = true;
        else {
          for (const candidate of gate.data.filter(row => matchesRequestedBook(row, plan))) {
            const row = retenir(candidate);
            if (row !== null) lignesVectorielles.push(row);
          }
        }
      }
    }
    // Fair bounded merge for the two type queries; the first query cannot evict the second.
    const candidates: unknown[] = [];
    for (let index = 0; index < LIMITES.LEXICAL && candidates.length < LIMITES.LEXICAL; index++) {
      for (const batch of batches) {
        if (batch[index] !== undefined && candidates.length < LIMITES.LEXICAL) candidates.push(batch[index]);
      }
    }
    void candidates;
    // Classement par lot : chaque lot produit ses preuves, classées contre SA
    // propre référence (celle qui l'a fait remonter). Les lots sont des
    // REFORMULATIONS de la MÊME question (requête d'origine + rubriques
    // candidates) : leurs scores de pertinence sont donc comparables, et la
    // fusion se fait au MEILLEUR SCORE — pas par tour de rôle, qui laisserait
    // un lot faible évincer la meilleure réponse d'un lot fort.
    //
    // Le lot 0 porte la question ORIGINALE : c'est la seule référence correcte
    // pour les candidats vectoriels (calculés sur cette question). Quand les
    // deux branches ont des candidats, elles sont fusionnées PAR RANG (RRF).
    const parLot: Preuve[][] = [];
    let repliReranker = false;
    if (deps.rerankerLocal !== undefined) {
      // Voie reranker : UNE passe globale sur les candidats fusionnés, notée
      // contre la QUESTION ORIGINALE (le cross-encoder est multilingue).
      // Reranker chaque lot séparément multiplierait les inférences sans
      // changer l'ordre final (les scores heuristiques sont préservés).
      const toutesLignes: unknown[] = [];
      const vusLignes = new Set<string>();
      for (const lot of lots) {
        for (const ligne of lot.lignes) {
          const id = (ligne as { chunk_id?: unknown }).chunk_id;
          if (typeof id === "string") {
            if (vusLignes.has(id)) continue;
            vusLignes.add(id);
          }
          toutesLignes.push(ligne);
        }
      }
      for (const ligne of lignesVectorielles) {
        const id = (ligne as { chunk_id?: unknown }).chunk_id;
        if (typeof id === "string") {
          if (vusLignes.has(id)) continue;
          vusLignes.add(id);
        }
        toutesLignes.push(ligne);
      }
      const search = await orchestrerRecherche(question, toutesLignes, [],
        deps.rerankerLocal, CALIBRATION_A3, "rang", LIMITES.FINAL);
      if (search.repliReranker) repliReranker = true;
      signal?.throwIfAborted();
      parLot.push([...search.evidences]);
    } else {
      for (const [index, lot] of lots.entries()) {
        const vectorielsDuLot = index === 0 ? lignesVectorielles : [];
        // Chaque lot rend jusqu'à FUSION : la refinalisation à FINAL a lieu UNE
        // fois, globalement, pour ne pas couper un bon candidat dans son lot.
        const search = await orchestrerRecherche(lot.reference, lot.lignes, vectorielsDuLot,
          deps.rerankerLocal, CALIBRATION_A3,
          vectorielsDuLot.length > 0 ? "rang" : "score", LIMITES.FUSION, false);
        if (search.repliReranker) repliReranker = true;
        signal?.throwIfAborted();
        parLot.push([...search.evidences]);
      }
    }
    // Les lots sont des REFORMULATIONS de la MÊME question (requête
    // d'origine, puis rubriques candidates). Leurs scores de pertinence sont
    // comparables : la fusion se fait au MEILLEUR SCORE. À égalité de score,
    // l'ordre des lots départage — la requête d'origine d'abord (c'est la
    // lecture la plus littérale de la question), puis les rubriques par ordre
    // de couverture décroissante du corpus.
    const tous: { preuve: Preuve; lot: number; rang: number }[] = [];
    parLot.forEach((evidences, lot) => {
      evidences.forEach((preuve, rang) => tous.push({ preuve, lot, rang }));
    });
    const vus = new Set<string>();
    const preuves: Preuve[] = [];
    // Départage (jamais filtre) : à pertinence ÉGALE, la preuve dont la
    // rubrique porte le diagnostic nommé passe devant. Sans cela, deux
    // sections à couverture identique étaient départagées par le hash du
    // chunkId — la question ne décidait plus rien.
    const indiceFocus = (preuve: Preuve): number =>
      plan.focusHints?.some(focus => matchesSectionFocus(preuve.section, focus)) ? 1 : 0;
    const indiceFeuille = (preuve: Preuve): number =>
      plan.leafHint !== undefined && matchesLeafHint(preuve.section, plan.leafHint) ? 1 : 0;
    const ordonnes = [...tous].sort((a, b) => b.preuve.evidence_relevance - a.preuve.evidence_relevance
      || indiceFeuille(b.preuve) - indiceFeuille(a.preuve)
      || indiceFocus(b.preuve) - indiceFocus(a.preuve)
      || a.lot - b.lot || a.rang - b.rang);
    for (const { preuve } of ordonnes) {
      if (preuves.length >= LIMITES.FINAL) break;
      if (vus.has(preuve.chunkId)) continue;
      vus.add(preuve.chunkId);
      preuves.push(preuve);
    }
    // Budget d'évidence appliqué UNE seule fois, après la sélection finale.
    // L'appliquer par lot tronquait chaque liste avant la fusion (mesuré : le
    // bon passage d'un lot ciblé tombait au 3e rang de son propre lot).
    const finales = appliquerBudgetOctets(preuves).retenues;
    const issue = finales.length === 0 ? "aucune" as const
      : finales.some(p => p.evidence_relevance >= SEUIL_PERTINENCE) ? "pertinent" as const
      : finales.some(p => p.evidence_relevance >= SEUIL_FAIBLESSE) ? "faible" as const
      : "aucune" as const;
    // Une feuille de section est une préférence, pas une condition : si la
    // passe stricte ne rend AUCUNE preuve exploitable (feuille absente ou
    // chunk trop long), on rejoue UNE fois sans la feuille. Le focus de
    // diagnostic reste, donc aucun autre trouble ne peut être substitué.
    if (finales.length === 0 && plan.sectionLeaf !== undefined && options.relaxerFeuille !== true) {
      return readKnowledge(client, question, signal, deps, { relaxerFeuille: true });
    }
    const result = { etat: finales.length === 0 ? "sans-preuve" as const : issue === "faible" ? "faible" as const : "ok" as const,
      ...(plan.sectionFocuses?.some(focus=>!finales.some(p=>matchesSectionFocus(p.section,focus)))?{missingRequestedSections:true as const}:{}),
      ...(omittedLongPassages ? { omittedLongPassages: true as const } : {}),
      ...(vectorielIndisponible ? { vectoriel: "indisponible" as const } : {}),
      ...(repliReranker ? { reranker: "repli" as const } : {}),
      ...(options.relaxerFeuille === true ? { sectionLeafRelaxed: true as const } : {}),
      preuves: finales.map(p => preuveAffichable(p)) };
    for (const proof of result.preuves) Object.freeze(proof);
    Object.freeze(result.preuves);
    Object.freeze(result);
    issuedKnowledgeResults.add(result);
    return result;
  } catch { signal?.throwIfAborted(); return { etat: "panne" as const, preuves: [] }; }
}
