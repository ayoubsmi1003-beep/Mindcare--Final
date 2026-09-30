/**
 * `jarvis-mesures.ts` — L'OBSERVABILITÉ §10/§36, SANS DONNÉE.
 *
 * ═══ CE QU'IL MESURE, ET CE QU'IL NE VOIT JAMAIS ═══
 * Un anneau borné (200) de records PII-safe par tour : durée totale, nombre
 * d'appels de capacité, chemin, code d'erreur canonique. Jamais un message,
 * jamais un nom, jamais un argument, jamais un résultat — les quantiles ne
 * portent que des nombres et des codes fermés. C'est ce qui autorise
 * `exporterMesures()` dans les diagnostics développeur (§33) sans revue
 * de fuite : il n'y a rien à fuir.
 *
 * Mémoire module, jamais persisté, jamais réseau. Les p50/p95/p99 du CHEMIN
 * DÉTERMINISTE (extraction, routage, pare-feu) se mesurent hors ligne par
 * `scripts/mesure-alexa-p95.mjs` ; ceux du modèle et de la base exigent un
 * environnement vivant et restent NOT RUN sur cette machine.
 */

import type { CodeErreurAlexa } from "./jarvis-erreurs";

export interface MesureTour {
  /** Durée totale du tour, ms (horloge locale, `Date.now`). */
  readonly msTotal: number;
  /** Appels de capacité cumulés (sonde comprise). */
  readonly nbAppels: number;
  /** Chemin annoncé : connaissance | patient | refus. */
  readonly chemin: string;
  /** Tiroir §34, `OK` quand le tour a abouti. */
  readonly code: CodeErreurAlexa;
  // ── ÉTAPES §15/§36 — audit Slice 1 ──
  // Décalages en ms depuis le début du tour (nombres seuls, PII-safe comme
  // le reste de l'anneau). Absents = étape non atteinte (ex. échec avant le
  // premier événement) — l'absence est elle-même le diagnostic.
  /** Conversation assurée (`assurerConversation` rendue). */
  readonly msSession?: number;
  /** Premier événement passerelle (`onChemin`) — la passerelle a répondu. */
  readonly msPremierEvenement?: number;
  /** Premier fragment de texte (`onDelta`) — TTFT réel côté écran. */
  readonly msPremierDelta?: number;
}

/** Fenêtre bornée : au-delà, les plus anciennes tombent (pas de fuite mémoire). */
export const MAX_MESURES = 200;

const anneau: MesureTour[] = [];

export function consignerMesure(m: MesureTour): void {
  anneau.push(m);
  while (anneau.length > MAX_MESURES) anneau.shift();
}

export function nombreMesures(): number {
  return anneau.length;
}

/** Remise à zéro (tests uniquement — jamais en production). */
export function reinitialiserMesures(): void {
  anneau.length = 0;
}

export interface Quantiles {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Quantiles type « nearest-rank » sur les durées, ms arrondies. */
export function quantilesDuree(): Quantiles {
  const n = anneau.length;
  if (n === 0) return { n: 0, p50: 0, p95: 0, p99: 0 };
  const triees = anneau.map((m) => m.msTotal).sort((a, b) => a - b);
  const rang = (p: number): number => {
    const i = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
    return Math.round(triees[i] ?? 0);
  };
  return { n, p50: rang(50), p95: rang(95), p99: rang(99) };
}

/** Compte les tours par code — le dénominateur des taux d'échec. */
export function compteurParCode(): Readonly<Record<string, number>> {
  const comptes: Record<string, number> = {};
  for (const m of anneau) comptes[m.code] = (comptes[m.code] ?? 0) + 1;
  return comptes;
}

export interface DiagnosticMesures {
  /** Quantiles des durées de tour (ms). */
  readonly durees: Quantiles;
  /** Tours par tiroir §34. */
  readonly parCode: Readonly<Record<string, number>>;
  /** Durée moyenne par chemin (ms arrondie) — jamais de contenu, que des axes. */
  readonly moyenneParChemin: Readonly<Record<string, number>>;
}

/**
 * Dernier tour + lecture §36 — « Pourquoi Alexa n'a-t-elle pas répondu ? »
 * sans ouvrir un fichier. Nombres et codes fermés uniquement : aucun message,
 * aucun nom, aucun identifiant ne peut en sortir puisqu'aucun n'y entre.
 * `ttftMs: null` = aucun fragment reçu (panne avant le modèle ou modèle muet).
 */
export interface DernierDiagnostic {
  readonly chemin: string;
  readonly code: CodeErreurAlexa;
  readonly msTotal: number;
  readonly msSession: number | null;
  readonly msPremierEvenement: number | null;
  readonly ttftMs: number | null;
  readonly nbAppels: number;
}

export function dernierDiagnostic(): DernierDiagnostic | null {
  const m = anneau[anneau.length - 1];
  if (m === undefined) return null;
  return {
    chemin: m.chemin,
    code: m.code,
    msTotal: m.msTotal,
    msSession: m.msSession ?? null,
    msPremierEvenement: m.msPremierEvenement ?? null,
    ttftMs: m.msPremierDelta ?? m.msPremierEvenement ?? null,
    nbAppels: m.nbAppels,
  };
}

/**
 * Diagnostic développeur §33 — la seule sortie de cet anneau vers un écran.
 * PII-safe par construction : durées, comptes, codes fermés. Aucun message,
 * aucun nom, aucun argument ne peut en sortir puisqu'aucun n'y entre.
 */
export function exporterMesures(): DiagnosticMesures {
  const sommes: Record<string, { total: number; n: number }> = {};
  for (const m of anneau) {
    const e = sommes[m.chemin] ?? { total: 0, n: 0 };
    e.total += m.msTotal;
    e.n += 1;
    sommes[m.chemin] = e;
  }
  const moyenneParChemin: Record<string, number> = {};
  for (const [chemin, e] of Object.entries(sommes)) {
    moyenneParChemin[chemin] = e.n === 0 ? 0 : Math.round(e.total / e.n);
  }
  return { durees: quantilesDuree(), parCode: compteurParCode(), moyenneParChemin };
}
