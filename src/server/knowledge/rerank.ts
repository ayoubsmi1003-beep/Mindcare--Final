/**
 * `rerank.ts` — M07 · le SOCLE DE RERANK LOCAL (H2 : baseline heuristique).
 *
 * ═══ CE QUE C'EST ═══
 * L'interface `RerankerLocal` (future-compatible cross-encoder M13) + sa
 * première implémentation, `HeuristiqueBaseline` : fonction PURE qui ordonne
 * ≤20 candidats fusionnés et rend un score 0..1 par candidat. Signaux bornés
 * et locaux :
 *
 *   · couverture lexicale (requête couverte par le chunk) — 55 % ;
 *   · similarité vectorielle normalisée (rendue par la porte) — 45 % ;
 *   · bonus titre de section (+0.10) et titre de source (+0.05).
 *
 * ═══ CE QUE CE N'EST PAS (H2, honnêteté architecturale) ═══
 *   · PAS un cross-encoder : `HeuristiqueBaseline` est la baseline
 *     déterministe / le repli testable. Le pipeline visé (Master Plan §10)
 *     est hybride → Top-20 → cross-encoder local → Top-5 ; en attendant M13,
 *     la part sémantique vient de la similarité pgvector normalisée, pas d'un
 *     jugement local. LIMITATION documentée, pas équivalence.
 *   · Pas une confiance médicale : le score est une PERTINENCE DE
 *     RÉCUPÉRATION (H0.3). Le fencer `preuve.ts` ne rend que le RANG aux
 *     consommateurs — jamais le score brut comme un pourcentage de certitude.
 *   · Pas d'appel externe : aucun LLM, aucun réseau — la matrice n°18
 *     l'exige et les tests le prouvent par l'absence d'import.
 */

import type { CandidatFusionne } from "./recherche";

/** Version du reranker — persistée dans les traces d'évaluation. */
export const RERANK_VERSION = "local-v1" as const;

/** Un candidat reranké : score 0..1 + termes d'appariement (le « Pourquoi ? »). */
export interface CandidatRange {
  readonly candidat: CandidatFusionne;
  /** Rang de récupération 0..1 — JAMAIS une confiance clinique. */
  readonly score: number;
  /** Jetons de la requête retrouvés (diagnostic d'appariement, pas une preuve). */
  readonly apparies: readonly string[];
}

/**
 * Le contrat de rerank local (H2) : tout reranker — baseline heuristique
 * aujourd'hui, cross-encoder local en M13 — l'implémente. Le pipeline
 * (`connaissance-recherche.ts`) ne dépend que de ce contrat, jamais d'une
 * implémentation : le cross-encoder se substituera sans redesign.
 */
export interface RerankerLocal {
  readonly nom: string;
  readonly version: string;
  reranker(
    requete: string,
    candidats: readonly CandidatFusionne[],
    topN?: number,
  ): CandidatRange[];
}

/**
 * Extension ASYNCHRONE du contrat (R4) : le cross-encoder exige une inférence
 * (session ONNX injectée, `rerank-cross-encoder.ts`). La méthode synchrone
 * reste la baseline heuristique (repli fail-closed) ; `rerankerAsync` est la
 * voie cross-encoder. Même ordre déterministe, même borne `topN`.
 */
export interface RerankerLocalAsync extends RerankerLocal {
  rerankerAsync(
    requete: string,
    candidats: readonly CandidatFusionne[],
    topN?: number,
  ): Promise<CandidatRange[]>;
}

/**
 * Reranke via la baseline configurée (aujourd'hui `HeuristiqueBaseline`).
 * Déterministe : même requête + mêmes candidats → même ordre, égalités
 * départagées par `chunkId`. Rend au plus `topN` (défaut : FINAL=5).
 */
export function reranker(
  requete: string,
  candidats: readonly CandidatFusionne[],
  topN: number = 5,
): CandidatRange[] {
  return HeuristiqueBaseline.reranker(requete, candidats, topN);
}

/**
 * Calibration de fusion (M07 slice 3) : la FORME du score, en paramètres
 * explicites et versionnés — jamais en constantes dispersées.
 *
 *   score = α·couv^γ + β·simNorm·couv^δ + bonus(section +0.10, titre +0.05)
 *
 *   · `CALIBRATION_COURANTE` (α=0.55, β=0.45, γ=1, δ=0) reproduit l'historique
 *     à l'identique (`0^0 = 1` en JS : à couverture nulle, le terme vecteur
 *     vaut β·simNorm — exactement `noter` d'avant slice 3).
 *   · δ≥1 = sémantique de CONJONCTION : le vecteur ne parle que s'il couvre
 *     (« un voisin qui ne couvre rien de la question ne répond pas »).
 *     C'est le levier mesuré contre les 43 findings hybrides (step 2 : tous
 *     les cas `aucune` promus sont des voisins purs, couverture ≈ 0).
 *   · γ>1 = exigence super-linéaire de couverture (un demi-recouvrement ne
 *     vaut pas la moitié d'une réponse).
 *   · `porteMajorite` (défaut false = historique) : un voisin PUREMENT
 *     vectoriel (`scoreLexical === null`, jamais vu par le lexical qui exige
 *     l'unanimité des termes en AND) ne répond que s'il couvre la MAJORITÉ
 *     STRICTE de la question (`2·appariés > jetons`, comparaison entière, sans
 *     flottant) — en deçà : score 0 (silence), jamais une preuve faible. Les
 *     candidats corroborés lexicalement en sont exempts. Mesuré slice 3 :
 *     sépare TY-01 (2/3, pertinent conservé) des pièges à 1/2 (DS-01, WDOSE…).
 *     Point de fonctionnement documenté comme contingent au corpus : six cas
 *     golden à exactement 1/2 — revalidation à chaque incrément (ADR-037).
 *   · Les SEUILS (preuve.ts) ne bougent pas : seule la forme du score est
 *     calibrée. R0 (ADR-037) arbitre via `--reel`, jamais ce fichier.
 */
export interface CalibrationFusion {
  /** Poids du terme de couverture (courant : 0.55). */
  readonly poidsCouverture: number;
  /** Poids de la similarité vectorielle (courant : 0.45). */
  readonly poidsVecteur: number;
  /** Exposant de la couverture (courant : 1 = linéaire). */
  readonly exposantCouverture: number;
  /** Exposant de la couverture sur le terme vecteur (courant : 0 = inconditionnel). */
  readonly exposantVecteur: number;
  /** Porte de majorité pour voisins purs (courant : false = historique). */
  readonly porteMajorite?: boolean;
}

/** La calibration historique : `rerankerCalibre(…, CALIBRATION_COURANTE) ≡ reranker(…)`. */
export const CALIBRATION_COURANTE: CalibrationFusion = {
  poidsCouverture: 0.55,
  poidsVecteur: 0.45,
  exposantCouverture: 1,
  exposantVecteur: 0,
  porteMajorite: false,
};

/**
 * La calibration A3 (M07 slice 3) : conjonction linéaire + porte de majorité.
 * Candidate au câblage hybride : l'arbitre est `--reel` (voir
 * `artifacts/m07-fusion-caracterisation-A3.json`), jamais ce commentaire.
 * Ne devient le défaut qu'après gate R0 complet exécuté.
 */
export const CALIBRATION_A3: CalibrationFusion = {
  poidsCouverture: 0.55,
  poidsVecteur: 0.45,
  exposantCouverture: 1,
  exposantVecteur: 1,
  porteMajorite: true,
};

/**
 * Rerank paramétré par une calibration explicite. Même ordre déterministe,
 * même borne `topN`, mêmes bonus que la baseline. `CALIBRATION_COURANTE`
 * rend exactement `reranker` (pin testé).
 */
export function rerankerCalibre(
  requete: string,
  candidats: readonly CandidatFusionne[],
  topN: number = 5,
  calibration: CalibrationFusion = CALIBRATION_COURANTE,
): CandidatRange[] {
  const jetonsRequete = jetoniser(requete);
  return candidats
    .map((candidat) => noterCalibre(jetonsRequete, candidat, calibration))
    .sort((a, b) => b.score - a.score || (a.candidat.chunkId < b.candidat.chunkId ? -1 : 1))
    .slice(0, Math.max(0, topN));
}

/**
 * LA BASELINE HEURISTIQUE (H2) : déterministe, sans modèle, testable hors
 * ligne. Ne pas la confondre avec le cross-encoder final — les benchmarks
 * la nomment `heuristic-baseline` et mesurent son gain séparément.
 */
export const HeuristiqueBaseline: RerankerLocal = {
  nom: "heuristic-baseline",
  version: RERANK_VERSION,
  reranker(requete, candidats, topN = 5): CandidatRange[] {
    const jetonsRequete = jetoniser(requete);
    return candidats
      .map((candidat) => noterCalibre(jetonsRequete, candidat, CALIBRATION_COURANTE))
      .sort((a, b) => b.score - a.score || (a.candidat.chunkId < b.candidat.chunkId ? -1 : 1))
      .slice(0, Math.max(0, topN));
  },
};

function noterCalibre(
  jetonsRequete: readonly string[],
  candidat: CandidatFusionne,
  calibration: CalibrationFusion,
): CandidatRange {
  const jetonsChunk = new Set(jetoniser(candidat.texte));
  const apparies = jetonsRequete.filter((jeton) => jetonsChunk.has(jeton));
  // Porte de majorité (A3) : voisin purement vectoriel sous la majorité
  // stricte → silence (score 0). Comparaison entière (pas de flottant) :
  // 2·appariés > jetons ⟺ couverture > 1/2. Monotone (un apport de couverture
  // ne fait jamais baisser le score : 0 puis formule croissante).
  if (
    calibration.porteMajorite === true &&
    candidat.scoreLexical === null &&
    jetonsRequete.length > 0 &&
    apparies.length * 2 <= jetonsRequete.length
  ) {
    return { candidat, score: 0, apparies };
  }
  const couverture = jetonsRequete.length === 0 ? 0 : apparies.length / jetonsRequete.length;
  const simVectorielle = normaliserSimilarite(candidat.scoreVectoriel);
  // `0^0 = 1` : avec la calibration courante (δ=0), couverture nulle →
  // β·simNorm, soit exactement l'historique. Avec δ≥1, le terme vecteur
  // s'éteint sans couverture (conjonction).
  const couvertureGamma = Math.pow(couverture, calibration.exposantCouverture);
  const couvertureDelta = Math.pow(couverture, calibration.exposantVecteur);
  let score =
    calibration.poidsCouverture * couvertureGamma +
    calibration.poidsVecteur * simVectorielle * couvertureDelta;
  if (contientJeton(candidat.section, apparies)) score += 0.1;
  if (contientJeton(candidat.sourceTitre, apparies)) score += 0.05;
  return { candidat, score: Math.min(1, Math.max(0, score)), apparies };
}

function noter(jetonsRequete: readonly string[], candidat: CandidatFusionne): CandidatRange {
  return noterCalibre(jetonsRequete, candidat, CALIBRATION_COURANTE);
}

/**
 * La similarité cosine pgvector ∈ [-1, 1] devient ∈ [0, 1] par mise à
 * l'échelle linéaire. `null` (candidat purement lexical) vaut 0 : la branche
 * lexicale est déjà portée par la couverture, on ne la compte pas deux fois.
 */
function normaliserSimilarite(similarite: number | null): number {
  if (similarite === null || !Number.isFinite(similarite)) return 0;
  return Math.min(1, Math.max(0, (similarite + 1) / 2));
}

function contientJeton(texte: string | null, apparies: readonly string[]): boolean {
  if (texte === null || apparies.length === 0) return false;
  const jetons = new Set(jetoniser(texte));
  return apparies.some((jeton) => jetons.has(jeton));
}

/**
 * Mots vides FR + AR (pas de darija : sans lexique validé, on ne retire
 * rien — limitation documentée). Retirer « de/la/les » n'est pas du
 * raffinement : SANS eux, « recette de couscous » couvre « de » dans chaque
 * chunk français et devient une preuve PERTINENTE — exactement la bascule
 * faible→confiant que M07 interdit (mesuré en eval, cas NA-01).
 */
const MOTS_VIDES: ReadonlySet<string> = new Set([
  "au", "aux", "avec", "ce", "ces", "dans", "de", "des", "du", "elle", "elles",
  "en", "et", "eux", "il", "ils", "je", "la", "le", "les", "leur", "leurs",
  "lui", "ma", "mais", "me", "meme", "mes", "moi", "mon", "ne", "nos",
  "notre", "nous", "on", "ou", "par", "pas", "pour", "quand", "que", "quel",
  "quelle", "qui", "sa", "se", "ses", "son", "sur", "ta", "te", "tes", "toi",
  "ton", "tous", "tout", "toute", "toutes", "tu", "un", "une", "vos", "votre",
  "vous", "est", "sont", "etre", "avoir", "fait", "comme", "ou",
  "ما", "هي", "هو", "في", "من", "على", "الى", "إلى", "ان", "أن", "هل",
  "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "مع", "عن", "كل",
  "لم", "لن", "قد", "ثم", "او", "أو", "بين", "بعد", "قبل", "حتى", "كما",
  "لكن", "بل",
]);

/**
 * Jetonisation : minuscules, sans diacritiques, découpée sur tout ce qui
 * n'est ni lettre ni chiffre (Unicode — FR, AR et darija latine passent par
 * le même chemin, sans dictionnaire). Puis, pour l'arabe uniquement :
 * l'article défini « ال » préfixé est replié (« الهلع » → « هلع »), SANS
 * quoi le singulier nu ne retrouve jamais sa forme articulée — défaut réel
 * mesuré en eval (cas FW-03). Pas de racinisation : un repli d'article,
 * déterministe, documenté — pas un stemmer.
 *
 * Jetons d'une lettre et mots vides écartés (bruit).
 */
export function jetoniser(texte: string): string[] {
  const bruts = texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((jeton) => jeton.length >= 2);
  const sortie: string[] = [];
  for (const brut of bruts) {
    if (MOTS_VIDES.has(brut)) continue;
    const replie = brut.length >= 5 && brut.startsWith("ال") ? brut.slice(2) : brut;
    if (replie.length >= 2 && !MOTS_VIDES.has(replie)) sortie.push(replie);
  }
  return sortie;
}
