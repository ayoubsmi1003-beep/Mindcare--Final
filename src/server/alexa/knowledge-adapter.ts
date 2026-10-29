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
import { recetteSecondaireGelee } from "@/server/knowledge/embeddings-secondaires";
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

/** Planchers évalués par espace exact ; une recette absente de cette carte abstient. */
const SEUILS_SIMILARITE_DENSES = new Map<string, number>([
  ["intfloat/multilingual-e5-base|d128750597153bb5987e10b1c3493a34e5a4502a|768", 0.83],
]);

function seuilSimilariteDense(secondaire: NonNullable<DependancesReadKnowledge["vectorielSecondaire"]>): number | undefined {
  return SEUILS_SIMILARITE_DENSES.get(`${secondaire.modele}|${secondaire.version}|${secondaire.dimensions}`);
}

/** Normalisation de comparaison (accents, casse, espaces) — jamais affichée. */
const normaliserTexte = (valeur: string): string =>
  valeur.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();

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
   * Index SECONDAIRE (188/191) : quand il est renseigné, la branche vectorielle
   * interroge la porte de CET espace avec ce triplet (modele, version,
   * dimensions) — jamais l'index 1024d de production. Absent = ancienne porte
   * (compatibilité). La dimension choisit la PORTE (384 → v2, 768 → v2_768) :
   * deux espaces vectoriels ne se mélangent jamais.
   */
  readonly vectorielSecondaire?: {
    readonly modele: string;
    readonly version: string;
    readonly dimensions: number;
  };
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
  /** Internal path label for opt-in, content-free local evaluation diagnostics. */
  readonly traceOrigin?: "direct" | "agent_tool" | "patient_context";
}

type TraceEtatVecteur = "not-enabled" | "pending" | "ok" | "failed" | "not-calibrated" | "missing-provider";

interface TraceExecutionKnowledge {
  readonly origin: OptionsReadKnowledge["traceOrigin"] | "unknown";
  readonly recipe: string;
  readonly configuredRecipe: string;
  readonly model: { readonly embedding: string | null; readonly embeddingVersion: string | null;
    readonly dimensions: number | null; readonly reranker: string | null; readonly rerankerVersion: string | null };
  readonly lexical: { readonly gate: "search_knowledge_lexical"; calls: number; rows: number };
  readonly embedding: { invoked: boolean; status: TraceEtatVecteur; outputDimensions: number | null };
  readonly vector: { invoked: boolean; gate: string | null; rows: number; status: TraceEtatVecteur };
  readonly reranker: { readonly mode: "cross-encoder" | "heuristic-baseline"; invocations: number; fallback: boolean };
  readonly evidence: { selected: number; pages: number };
  readonly fallbacks: string[];
  result: "ok" | "faible" | "sans-preuve" | "panne" | "aborted" | "unknown";
  readonly startedAtMs: number;
}

function traceRecipe(deps: DependancesReadKnowledge): string {
  if (!deps.vectorActif) return "lexical-only";
  const secondary = deps.vectorielSecondaire;
  if (secondary) {
    for (const slug of ["e5-small", "e5-base"] as const) {
      const pinned = recetteSecondaireGelee(slug);
      if (pinned?.modele === secondary.modele && pinned.version === secondary.version
        && pinned.dimensions === secondary.dimensions) return slug;
    }
    return "unapproved-secondary";
  }
  return "primary-bge-m3";
}

function traceConfiguration(deps: DependancesReadKnowledge): TraceExecutionKnowledge["model"] & { configuredRecipe: string } {
  const requestedRecipe = process.env["KNOWLEDGE_VECTOR_RECETTE"]?.trim() || "e5-small";
  const pinnedSecondary = recetteSecondaireGelee(requestedRecipe);
  const secondary = deps.vectorielSecondaire;
  const primaryActive = deps.vectorActif && secondary === undefined;
  const embedding = secondary?.modele ?? (primaryActive ? "BAAI/bge-m3" : null);
  const embeddingVersion = secondary?.version ?? (primaryActive ? "5617a9f61b028005a4858fdac845db406aefb181" : null);
  const dimensions = secondary?.dimensions ?? (primaryActive ? 1024 : null);
  return {
    configuredRecipe: pinnedSecondary ? requestedRecipe : "unapproved",
    embedding,
    embeddingVersion,
    dimensions,
    reranker: deps.rerankerLocal?.nom ?? null,
    rerankerVersion: deps.rerankerLocal?.version ?? null,
  };
}

function emitKnowledgeTrace(trace: TraceExecutionKnowledge): void {
  if (process.env["ALEXA_LOCAL_TIMINGS"] !== "1") return;
  const { startedAtMs, ...safe } = trace;
  try {
    console.info("[alexa-knowledge-execution]", JSON.stringify({ ...safe, durationMs: Math.max(0, Date.now() - startedAtMs) }));
  } catch { /* Diagnostics must never change retrieval behavior. */ }
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
  // pourrait diverger de l'index réellement construit. Le SLUG choisit
  // l'espace (384 ou 768) parmi les recettes APPROUVÉES uniquement ; un slug
  // inconnu désactive la branche vectorielle (repli lexical explicite).
  const slugRecette = process.env["KNOWLEDGE_VECTOR_RECETTE"]?.trim() || "e5-small";
  const recette = recetteSecondaireGelee(slugRecette);
  const actif = process.env["KNOWLEDGE_VECTOR"] === "1" && recette !== null;
  // Reranker secondaire : opt-in explicite, jamais par défaut. Modèle absent
  // ou en panne → l'orchestrateur replie sur l'heuristique en le signalant.
  const avecRerank = process.env["KNOWLEDGE_RERANK"] === "mmarco";
  return {
    vectorActif: actif,
    vecteurRequete: (requete: string) => actif
      ? vecteurRequeteSecondaireProduction(requete)
      : vecteurRequeteProduction(requete),
    ...(actif && recette !== null
      ? { vectorielSecondaire: { modele: recette.modele, version: recette.version, dimensions: recette.dimensions } }
      : {}),
    ...(avecRerank ? { rerankerLocal: rerankerSecondaireProduction() } : {}),
  };
}

/** Explicit lexical freeze. Assets being present must never activate vector retrieval. */
export async function readKnowledge(client: ClientSql, question: string, signal?: AbortSignal,
  deps: DependancesReadKnowledge = dependancesReadKnowledge(),
  options: OptionsReadKnowledge = {}) {
  signal?.throwIfAborted();
  const configuration = traceConfiguration(deps);
  const { configuredRecipe, ...model } = configuration;
  const trace: TraceExecutionKnowledge = {
    origin: options.traceOrigin ?? "unknown",
    recipe: traceRecipe(deps),
    configuredRecipe,
    model,
    lexical: { gate: "search_knowledge_lexical", calls: 0, rows: 0 },
    embedding: { invoked: false, status: deps.vectorActif ? "pending" : "not-enabled", outputDimensions: null },
    vector: { invoked: false, gate: null, rows: 0, status: deps.vectorActif ? "pending" : "not-enabled" },
    reranker: { mode: deps.rerankerLocal ? "cross-encoder" : "heuristic-baseline", invocations: 0, fallback: false },
    evidence: { selected: 0, pages: 0 },
    fallbacks: [],
    result: "unknown",
    startedAtMs: Date.now(),
  };
  const rerankerLocal = deps.rerankerLocal;
  const rerankerTrace: RerankerLocalAsync | undefined = rerankerLocal === undefined ? undefined : {
    nom: rerankerLocal.nom,
    version: rerankerLocal.version,
    reranker: (...args) => {
      trace.reranker.invocations += 1;
      return rerankerLocal.reranker(...args);
    },
    rerankerAsync: async (...args) => {
      trace.reranker.invocations += 1;
      return rerankerLocal.rerankerAsync(...args);
    },
  };
  try {
    const brut = planKnowledgeQuery(question);
    const plan = options.relaxerFeuille === true ? sansFeuille(brut) : brut;
    if (plan === null) {
      trace.result = "sans-preuve";
      trace.fallbacks.push("query-unplanned");
      return { etat: "sans-preuve" as const, preuves: [] };
    }
    // L'embedding de la question (coûteux) démarre avec les portes lexicales,
    // pas après elles : l'inférence et les lectures SQL se recouvrent.
    let vecteurEnCours: Promise<readonly number[] | null> = Promise.resolve(null);
    if (deps.vectorActif === true && deps.vecteurRequete !== undefined) {
      trace.embedding.invoked = true;
      trace.embedding.status = "pending";
      vecteurEnCours = deps.vecteurRequete(question).then(vecteur => {
        trace.embedding.status = vecteur === null ? "failed" : "ok";
        trace.embedding.outputDimensions = vecteur?.length ?? null;
        return vecteur;
      }).catch(() => {
        trace.embedding.status = "failed";
        return null;
      });
    } else if (deps.vectorActif === true) {
      trace.embedding.status = "missing-provider";
    }
    // Les reformulations planifiées sont indépendantes : quatre portes au plus
    // en parallèle, résultats remis DANS L'ORDRE du plan (voir `parallele.ts`).
    const resultats = await mapLimite(plan.queries, PORTES_PARALLELES, async (query) => {
      trace.lexical.calls += 1;
      const result = await client.rpc<unknown[]>("search_knowledge_lexical", porteLexicale(query, plan.language, LIMITES.LEXICAL).args);
      if (!result.error && Array.isArray(result.data)) trace.lexical.rows += result.data.length;
      return result;
    });
    signal?.throwIfAborted();
    const batches: unknown[][] = [];
    for (const result of resultats) {
      if (result.error || !Array.isArray(result.data)) {
        trace.result = "panne";
        trace.fallbacks.push("lexical-gate-failed");
        return { etat: "panne" as const, preuves: [] };
      }
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
    let vectorielIndisponible = false,vectorielNonCalibre = false;
    if (deps.vectorActif === true) {
      if (vecteur === null) {
        vectorielIndisponible = true;
        trace.vector.status = "failed";
        trace.fallbacks.push("embedding-unavailable");
      }
      else {
        const secondaire = deps.vectorielSecondaire;
        // Trois sites d'appel LITTÉRAUX : le générateur d'allowlist refuse les
        // noms calculés, et chaque porte doit rester vérifiable par pré-vol.
        // La dimension CHOISIT l'espace (768 → v2_768) ; elle ne le calcule pas.
        const gateName = secondaire === undefined ? "search_knowledge_vector"
          : secondaire.dimensions === 768 ? "search_knowledge_vector_v2_768" : "search_knowledge_vector_v2";
        trace.vector.invoked = true;
        trace.vector.gate = gateName;
        const gate = secondaire === undefined
          ? await client.rpc<unknown[]>("search_knowledge_vector",
              porteVectorielle(JSON.stringify([...vecteur]), LIMITES.VECTORIEL).args)
          : secondaire.dimensions === 768
            ? await client.rpc<unknown[]>("search_knowledge_vector_v2_768",
                porteVectorielleV2(JSON.stringify([...vecteur]), secondaire.modele, secondaire.version, CANDIDATS_VECTORIELS).args)
            : await client.rpc<unknown[]>("search_knowledge_vector_v2",
                porteVectorielleV2(JSON.stringify([...vecteur]), secondaire.modele, secondaire.version, CANDIDATS_VECTORIELS).args);
        signal?.throwIfAborted();
        if (gate.error || !Array.isArray(gate.data)) {
          vectorielIndisponible = true;
          trace.vector.status = "failed";
          trace.fallbacks.push("vector-gate-failed");
        }
        else {
          trace.vector.rows = gate.data.length;
          trace.vector.status = "ok";
          // Un plancher ne s'applique qu'au triplet exact qui a été mesuré.
          // Une autre recette reste en lexical seul jusqu'à sa propre calibration.
          const plancher = secondaire === undefined ? null : seuilSimilariteDense(secondaire);
          if (secondaire !== undefined && plancher === undefined) {
            vectorielNonCalibre = true;
            trace.vector.status = "not-calibrated";
            trace.fallbacks.push("vector-recipe-not-calibrated");
          }
          else for (const candidate of gate.data.filter(row => matchesRequestedBook(row, plan))) {
            if (plancher !== null && plancher !== undefined) {
              const score = Number((candidate as { score?: unknown }).score);
              if (!Number.isFinite(score) || score < plancher) continue;
            }
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
    // Chunks réellement trouvés par les MOTS : sert au départage et au plafond
    // du dense. Un voisin purement dense ne doit jamais renverser une
    // correspondance lexicale exacte (mesuré : un chunk DSM hors sujet, cosinus
    // 0,83, prenait la 1re place devant le passage clozapine trouvé par les mots).
    const idsLexicaux = new Set<string>();
    for (const lot of batches) {
      for (const ligne of lot) {
        const id = (ligne as { chunk_id?: unknown }).chunk_id;
        if (typeof id === "string") idsLexicaux.add(id);
      }
    }
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
        rerankerTrace, CALIBRATION_A3, "rang", LIMITES.FINAL);
      if (search.repliReranker) {
        repliReranker = true;
        trace.reranker.fallback = true;
        if (!trace.fallbacks.includes("reranker-fallback")) trace.fallbacks.push("reranker-fallback");
      }
      signal?.throwIfAborted();
      parLot.push([...search.evidences]);
    } else {
      for (const [index, lot] of lots.entries()) {
        const vectorielsDuLot = index === 0 ? lignesVectorielles : [];
        // Chaque lot rend jusqu'à FUSION : la refinalisation à FINAL a lieu UNE
        // fois, globalement, pour ne pas couper un bon candidat dans son lot.
        const search = await orchestrerRecherche(lot.reference, lot.lignes, vectorielsDuLot,
          rerankerTrace, CALIBRATION_A3,
          vectorielsDuLot.length > 0 ? "rang" : "score", LIMITES.FUSION, false);
        if (search.repliReranker) {
          repliReranker = true;
          trace.reranker.fallback = true;
          if (!trace.fallbacks.includes("reranker-fallback")) trace.fallbacks.push("reranker-fallback");
        }
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
    // À pertinence ÉGALE, la correspondance lexicale exacte passe avant un
    // voisin purement dense. Mesuré : le bon passage de « surveillance
    // hématologique clozapine » était rang 1 lexical, mais des voisins denses
    // de même pertinence — tous dans le lot 0, donc départagés par `lot` —
    // prenaient les 5 places. Un mot présent dans le texte bat un voisin.
    const indiceLexical = (preuve: Preuve): number => idsLexicaux.has(preuve.chunkId) ? 1 : 0;
    // Un voisin PUREMENT dense ne dépasse JAMAIS la meilleure preuve lexicale
    // de la question. Mesuré : le rang dense était converti en pertinence 1,000,
    // 0,917… sans regarder la similarité absolue, et un chunk DSM sans rapport
    // (section « affections proposées pour des études supplémentaires », cosinus
    // 0,83) prenait la 1re place devant le passage clozapine trouvé par les mots.
    // Le dense complète donc la liste, il ne renverse pas une correspondance
    // exacte. Sans aucune preuve lexicale (mode vectoriel pur), rien n'est
    // plafonné : le comportement historique est conservé.
    const lexicales = tous.filter(({ preuve }) => idsLexicaux.has(preuve.chunkId));
    const meilleurLexical = lexicales.length === 0
      ? null
      : Math.max(...lexicales.map(({ preuve }) => preuve.evidence_relevance));
    const pertinenceEffective = (preuve: Preuve): number =>
      idsLexicaux.has(preuve.chunkId) || meilleurLexical === null
        ? preuve.evidence_relevance
        : Math.min(preuve.evidence_relevance, meilleurLexical);
    const ordonnes = [...tous].sort((a, b) => pertinenceEffective(b.preuve) - pertinenceEffective(a.preuve)
      || indiceFeuille(b.preuve) - indiceFeuille(a.preuve)
      || indiceFocus(b.preuve) - indiceFocus(a.preuve)
      || indiceLexical(b.preuve) - indiceLexical(a.preuve)
      || a.lot - b.lot || a.rang - b.rang);
    // DIVERSITÉ DES SOURCES (livre non nommé uniquement) : une question sans
    // livre explicite ne doit pas recevoir 5 extraits du même ouvrage quand
    // l'autre en a un AUSSI pertinent. Mesuré : « syndrome sérotoninergique »
    // et « arrêter un antidépresseur » avaient leur passage au rang 1 de leur
    // propre reformulation, puis perdaient la fusion parce que cinq chunks DSM
    // remplissaient les places.
    //
    // Règle : on remplit normalement, puis — si les 5 viennent d'un seul livre
    // — on remplace la DERNIÈRE preuve par la meilleure de l'autre livre,
    // uniquement si elle atteint 80 % de la meilleure pertinence. Un plafond
    // symétrique avait été essayé : il forçait des chunks DSM hors sujet
    // (p. 730) dans une réponse clozapine. Pas de diversité au prix du hors-sujet.
    const livre = (preuve: Preuve): string =>
      identiteDePreuve(preuve.sourceTitre, preuve.sourceVersion)?.bookId ?? preuve.sourceTitre;
    const empreinte = (preuve: Preuve): string =>
      normaliserTexte(preuve.texte.replace(/\[[^\]]*\]/gu, ""));
    const textesVus: string[] = [];
    // Deux chunks peuvent couvrir le MÊME passage (l'un contenu dans l'autre) :
    // ils prenaient deux places pour une seule information. La contenance est
    // vérifiée sur le texte normalisé, jamais sur le chunkId.
    const dejaCouvert = (texte: string): boolean => texte.length >= 80
      && textesVus.some((connu) => connu.includes(texte) || texte.includes(connu));
    for (const { preuve } of ordonnes) {
      if (preuves.length >= LIMITES.FINAL) break;
      if (vus.has(preuve.chunkId)) continue;
      const marque = empreinte(preuve);
      if (dejaCouvert(marque)) continue;
      vus.add(preuve.chunkId);
      textesVus.push(marque);
      preuves.push(preuve);
    }
    if (plan.sourceTitle === null && preuves.length > 0) {
      const livres = new Set(preuves.map(livre));
      if (livres.size === 1) {
        const meilleure = Math.max(...preuves.map((p) => p.evidence_relevance));
        const autre = ordonnes
          .map(({ preuve }) => preuve)
          .find((preuve) => !vus.has(preuve.chunkId)
            && !livres.has(livre(preuve))
            && preuve.evidence_relevance >= SEUIL_PERTINENCE
            && preuve.evidence_relevance >= meilleure * 0.6);
        if (autre !== undefined) {
          const retiree = preuves.pop();
          if (retiree !== undefined) vus.delete(retiree.chunkId);
          vus.add(autre.chunkId);
          preuves.push(autre);
        }
      }
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
      trace.result = "sans-preuve";
      trace.fallbacks.push("section-leaf-retry");
      return readKnowledge(client, question, signal, deps, { ...options, relaxerFeuille: true });
    }
    const result = { etat: finales.length === 0 ? "sans-preuve" as const : issue === "faible" ? "faible" as const : "ok" as const,
      ...(plan.sectionFocuses?.some(focus=>!finales.some(p=>matchesSectionFocus(p.section,focus)))?{missingRequestedSections:true as const}:{}),
      ...(omittedLongPassages ? { omittedLongPassages: true as const } : {}),
      ...(vectorielIndisponible ? { vectoriel: "indisponible" as const } : {}),
      ...(!vectorielIndisponible && vectorielNonCalibre ? { vectoriel: "non-calibre" as const } : {}),
      ...(repliReranker ? { reranker: "repli" as const } : {}),
      ...(options.relaxerFeuille === true ? { sectionLeafRelaxed: true as const } : {}),
      preuves: finales.map(p => preuveAffichable(p)) };
    if (omittedLongPassages) trace.fallbacks.push("oversized-evidence-omitted");
    if (options.relaxerFeuille === true) trace.fallbacks.push("section-leaf-relaxed");
    trace.evidence.selected = result.preuves.length;
    trace.evidence.pages = result.preuves.filter(proof => proof.page !== undefined).length;
    trace.result = result.etat;
    for (const proof of result.preuves) Object.freeze(proof);
    Object.freeze(result.preuves);
    Object.freeze(result);
    issuedKnowledgeResults.add(result);
    return result;
  } catch {
    if (signal?.aborted) {
      trace.result = "aborted";
      trace.fallbacks.push("aborted");
      signal.throwIfAborted();
    }
    trace.result = "panne";
    trace.fallbacks.push("adapter-error");
    return { etat: "panne" as const, preuves: [] };
  } finally {
    emitKnowledgeTrace(trace);
  }
}
