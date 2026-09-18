/**
 * `resolution-references.ts` — LE VERDICT DE RÉSOLUTION M02 (pur, déterministe).
 *
 * ═══ CE QUE CE FICHIER FAIT ═══
 * Répondre à « de qui parle ce tour ? » SANS modèle, SANS base, SANS état :
 * une mention explicite + un comptage de sonde + un fil existant donnent un
 * verdict fermé (`unique` | `ambigu` | `nonResolu` | `aucun`). Qui ÉCRIT
 * l'identité (`definirCible`, `jarvis-contexte.ts`) et qui EXÉCUTE
 * (`executerTour`, `jarvis-boucle.ts`) restent les seuls maîtres — ce module
 * ne touche ni cible, ni carte, ni réseau. C'est ce qui le rend éprouvable
 * exhaustivement, hors ligne.
 *
 * ═══ L'INVARIANT M02-I1 ═══
 * Une mention explicite non résolue (0 candidat) ou ambiguë (>1) ne retombe
 * JAMAIS sur l'écran, le fil ou l'ancre : `nonResolu` et `ambigu` sont des
 * états BLOQUANTS, pas des absences. « Montre-moi Sarah » (0 résultat) avec
 * Karim à l'écran rend `nonResolu` — jamais Karim.
 *
 * ═══ PUR ET SANS IMPORT MÉTIER ═══
 * Seuls `./intentions` (contrat M01) et `zod` via lui. Pas d'import de
 * `services` ni de `server` (les couches ESLint l'interdisent), pas de log,
 * pas de `Date.now` — l'horloge est injectée par l'appelant quand il en faut
 * une. Compilable offline (`tsc` + node) pour la passe d'évaluation.
 */

import {
  COMPATIBLE,
  INTENTS_ECRITURE,
  INTENTS_META,
  NOMS_INTENTIONS,
  validerIntent,
  type IntentValide,
  type NomIntention,
} from "./intentions";

// ═══════════════════════════════════════════════════════════════════════════
// 0 · INTERRUPTEUR D'EXPLOITATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Coupe-circuit M02, pendant client de `INTENT_CLASSIFIER_ENABLED` (M01).
 * `false` = comportement historique (ancre + `besoinDeClarification` seuls) :
 * ni sonde, ni adoption explicite, ni porte, ni chaînage. Le serveur applique
 * en plus son propre interrupteur (`JARVIS_RESOLUTION_ENABLED`) sur l'inlet
 * chaîné — même un client actif ne peut pas chaîner seul.
 */
let resolutionActive = true;

export function fixerActivationResolutionM02(actif: boolean): void {
  resolutionActive = actif;
}

export function resolutionM02Active(): boolean {
  return resolutionActive;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LE VERDICT — qui ce tour désigne, avec sa provenance
// ═══════════════════════════════════════════════════════════════════════════

/** D'où vient un fil pré-existant : jamais une devinette, toujours un état. */
export type SourceFil = "ecran" | "conversation" | "ancre";

export interface FilPatient {
  readonly id: string;
  readonly libelle: string;
  readonly source: SourceFil;
}

/** Un candidat visible rendu par la sonde — identifiant RÉEL, jamais un nom seul. */
export interface CandidatSonde {
  readonly id: string;
  readonly libelle: string;
}

/**
 * Le comptage de la sonde `search_patients`.
 *
 * ⚠️ L'AUTORITÉ EST `total` (`total_count` CROSS JOIN, RLS-scopé, migration
 * 066), JAMAIS `candidats.length` : la porte borne les lignes (5 par défaut
 * en capacité, 100 max), pas le comptage. `depassé` dit que la liste visible
 * est tronquée — la clarification liste alors les libellés visibles + le
 * reliquat, sans jamais en inventer.
 */
export interface ResultatSonde {
  readonly total: number;
  readonly candidats: readonly CandidatSonde[];
  readonly depasse: boolean;
}

export type EtatVerdict = "unique" | "ambigu" | "nonResolu" | "aucun";

export interface VerdictResolution {
  readonly etat: EtatVerdict;
  /** `explicite` ou la source du fil — absente sur `ambigu`/`nonResolu`/`aucun`. */
  readonly source?: SourceFil | "explicite";
  /** Posé si et seulement si `etat === "unique"`. */
  readonly patient?: { readonly id: string; readonly libelle: string };
  /** Cardinalité prouvée par la sonde (mention explicite seulement). */
  readonly total?: number;
  /** Libellés VISIBLES pour la clarification (ambigu seulement). */
  readonly libelles?: readonly string[];
  /** La liste visible est tronquée (`total > libellés`). */
  readonly depasse?: boolean;
  /** Le texte désigné, pour une clarification qui le nomme. */
  readonly mention?: string;
}

export interface EntreeVerdict {
  /** Mention explicite extraite du tour (`null` = aucune désignation). */
  readonly mention: string | null;
  /** Comptage de la sonde (`null` = non sondé — une mention l'exige). */
  readonly sonde: ResultatSonde | null;
  /** Le fil pré-existant, déjà ordonné par l'appelant (écran > fil). */
  readonly fil: FilPatient | null;
}

/**
 * M02-I1, écrit en code : une mention explicite SORT du rang des fils.
 * `nonResolu`/`ambigu` ne portent aucun patient et bloquent tout rang
 * inférieur — l'appelant (`resoudreCible`, `jarvis-contexte.ts`) ne doit
 * jamais les convertir en écran/conversation/ancre.
 */
export function evaluerVerdictTour(entree: EntreeVerdict): VerdictResolution {
  if (entree.mention !== null) {
    const mention = entree.mention;
    // Mention sans preuve de comptage : on ne devine pas, on ne retombe pas.
    if (entree.sonde === null) return { etat: "nonResolu", mention };
    const { total, candidats, depasse } = entree.sonde;
    if (total === 1 && candidats.length === 1) {
      const seul = candidats[0];
      if (seul !== undefined && seul.id.trim() !== "") {
        return {
          etat: "unique",
          source: "explicite",
          patient: { id: seul.id, libelle: seul.libelle },
          total: 1,
          mention,
        };
      }
      // Sonde incohérente (total 1, candidat inutilisable) : fail-closed.
      return { etat: "nonResolu", mention, total };
    }
    if (total > 1) {
      return {
        etat: "ambigu",
        mention,
        total,
        libelles: candidats.map((c) => c.libelle),
        depasse,
      };
    }
    return { etat: "nonResolu", mention, total };
  }
  if (entree.fil !== null) {
    return {
      etat: "unique",
      source: entree.fil.source,
      patient: { id: entree.fil.id, libelle: entree.fil.libelle },
    };
  }
  return { etat: "aucun" };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · CHAÎNAGE — réutiliser l'intent précédent, jamais en inventer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Confiance d'une intention chaînée : juste au-dessus du seuil de rejet
 * (0.55), jamais confiante. Une intention reconstruite n'a pas été LUE par
 * le classifieur ; elle reste utilisable mais suspecte — la compatibilité
 * intent→outil et tous les gates décident du reste.
 */
export const CONFIANCE_CHAINEE = 0.6;

export interface EntreeChainage {
  /** L'intent retenu du tour précédent (`null` = aucun). */
  readonly intentionPrecedente: NomIntention | null;
  /** Une mention explicite OUVRE un nouveau fil : le classifieur décide. */
  readonly mention: string | null;
  /** Le verdict du tour courant — le fil doit être le même, prouvé. */
  readonly verdict: VerdictResolution;
  /** L'identifiant miroir du contexte de travail (fil du tour précédent). */
  readonly filPrecedentId: string | null;
}

/**
 * Construit l'intention chaînée ou rend `null` (classifier frais ou
 * clarifier). Re-validée par `validerIntent` AVANT de sortir : une intention
 * chaînée qui ne passe pas le contrat M01 n'existe pas.
 *
 * INTERDIT : chaîner une méta (rien à continuer), une écriture (un suivi
 * vague ne doit jamais porter une intention d'écriture — le tour suivant
 * classifie frais ou clarifie), sur mention explicite, sans fil unique, ou
 * vers un fil différent (le miroir a divergé → on jette, on ne devine pas).
 */
export function construireIntentionChainee(entree: EntreeChainage): IntentValide | null {
  const { intentionPrecedente, mention, verdict, filPrecedentId } = entree;
  if (mention !== null) return null;
  if (intentionPrecedente === null) return null;
  if (INTENTS_META.has(intentionPrecedente)) return null;
  if (INTENTS_ECRITURE.has(intentionPrecedente)) return null;
  if (verdict.etat !== "unique" || verdict.patient === undefined) return null;
  if (filPrecedentId === null || verdict.patient.id !== filPrecedentId) return null;
  return validerIntent({
    name: intentionPrecedente,
    entities: {},
    references: { pronomSansAntecedent: false, homonymePossible: false },
    confidence: CONFIANCE_CHAINEE,
    // Le fil prouvé satisfait la mention manquante ; rien d'autre n'est
    // déclaré — un chaînage n'invente aucune entité.
    missingInformation: [],
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · INTENT RETENU — du dernier outil exécuté vers l'intent chaînable
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inverse de `COMPATIBLE`, calculée une fois : capacité → intent SSI UN SEUL
 * intent la liste. `search_patients` (premier pas de presque tout) n'inverse
 * vers rien — un tour qui n'a fait que chercher ne lègue aucune intention.
 * Une capacité listée par plusieurs intents (`get_agenda_range`, …)
 * n'inverse vers rien non plus : ambiguïté = pas de chaînage.
 */
const CAP_VERS_INTENT: ReadonlyMap<string, NomIntention> = (() => {
  const unique = new Map<string, NomIntention>();
  const ambigus = new Set<string>();
  for (const nom of NOMS_INTENTIONS) {
    const famille = COMPATIBLE[nom] ?? [];
    for (const cap of famille) {
      if (unique.has(cap)) ambigus.add(cap);
      else unique.set(cap, nom);
    }
  }
  for (const cap of ambigus) unique.delete(cap);
  return unique;
})();

export function intentDeCapacite(nomCapacite: string): NomIntention | null {
  return CAP_VERS_INTENT.get(nomCapacite) ?? null;
}

/**
 * L'intent à retenir d'un tour, depuis les noms de capacités EXÉCUTÉES AVEC
 * SUCCÈS, du plus récent au plus ancien. Saute les méta (impossibles ici —
 * zéro outil) et les écritures (jamais chaînées, §2). Rend `null` quand rien
 * n'est chaînable : le tour suivant classifie frais.
 */
export function intentRetenuDesAppels(nomsExecutes: readonly string[]): NomIntention | null {
  for (let i = nomsExecutes.length - 1; i >= 0; i--) {
    const nom = nomsExecutes[i];
    if (nom === undefined) continue;
    const intent = intentDeCapacite(nom);
    if (intent === null || INTENTS_META.has(intent) || INTENTS_ECRITURE.has(intent)) continue;
    return intent;
  }
  return null;
}
