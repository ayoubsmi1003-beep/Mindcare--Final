/**
 * `observabilite-lecture.ts` — M09 reliquat LOT4 · lecture des historiques.
 *
 * ═══ CE QUE C'EST ═══
 * Trois lecteurs fins vers les portes (`get_live_history`,
 * `get_replay_history`, `get_observability_stats`) par `DbPort.rpc` — la
 * seule voie qui rend la surface énumérable (`gen-db-allowlist.mjs`).
 * Jamais de `select` direct : les tables 094/097 ne s'atteignent que par
 * leurs portes, et c'est la RLS qui décide (règle 4).
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas d'autorisation ici : la porte rend NULL hors périmètre
 *     (assistante, autre cabinet, run inconnu — indiscernables, anti-oracle
 *     ADR-003), et ce module traduit ce NULL en erreur honnête CONSTANTE.
 *   · Pas d'arithmétique : les agrégats sont calculés en base
 *     (`get_observability_stats`), le service formate (précédent M04).
 *   · Pas d'écriture : aucun chemin de ce fichier ne mène à 094/097.
 */

import { z } from "zod";

import { m09 } from "@/i18n/m09";
import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

const UUID = z.string().uuid();

const AppelHist = z.strictObject({
  capacite: z.string(),
  ms: z.number().int().min(0),
  ok: z.boolean(),
  code: z.string().nullable(),
  deduplique: z.boolean(),
  toolCallFp: z.string().nullable(),
});

const PreuveHist = z.strictObject({
  titre: z.string(),
  section: z.string().nullable(),
  version: z.string(),
  retrievalFp: z.string(),
});

const RunHist = z.strictObject({
  contrat: z.literal("m09-live-v2"),
  runId: z.string().uuid(),
  gateVersion: z.string(),
  empreinteRun: z.string(),
  empreinte: z.string(),
  chemin: z.enum(["connaissance", "patient", "refus", "inconnu"]),
  interrompu: z.boolean(),
  persiste: z.boolean(),
  dureeMs: z.number().int().min(0),
  nbAppels: z.number().int().min(0),
  nbPreuves: z.number().int().min(0),
  nbSnapshots: z.number().int().min(0),
  propositionInconnue: z.string().nullable(),
  resolutionEtat: z.string().nullable(),
  intentionChainee: z.string().nullable(),
  intentionRetenue: z.string().nullable(),
  retrievalFp: z.array(z.string()).nullable(),
  approvalFp: z.string().nullable(),
  executionFp: z.string().nullable(),
  issue: z.enum(["ok", "echec", "inconnue", "bloquee", "duplicata", "inconnu"]).nullable(),
  createdAt: z.string(),
});

const HistoriqueLive = z.strictObject({
  contrat: z.literal("m09-live-v2"),
  run: RunHist,
  appels: z.array(AppelHist),
  preuves: z.array(PreuveHist),
});

const CasReplay = z.strictObject({
  famille: z.string(),
  id: z.string(),
  empreinte: z.string(),
  verdict: z.string(),
});

const RunReplay = z.strictObject({
  contrat: z.literal("m09-replay-v1"),
  runId: z.string().uuid(),
  kind: z.string(),
  verdict: z.string(),
  passCount: z.number().int().min(0),
  failCount: z.number().int().min(0),
  notRunCount: z.number().int().min(0),
  casCount: z.number().int().min(0),
  goldensHash: z.string(),
  createdAt: z.string(),
});

const HistoriqueReplay = z.strictObject({
  contrat: z.literal("m09-replay-v1"),
  run: RunReplay,
  cas: z.array(CasReplay),
});

const StatsObservabilite = z.strictObject({
  contrat: z.literal("m09-stats-v1"),
  fenetreJours: z.number().int().min(1),
  live: z.strictObject({
    runs: z.number().int().min(0),
    p50Ms: z.number().int().min(0),
    p95Ms: z.number().int().min(0),
    parChemin: z.record(z.string(), z.number().int().min(0)),
  }),
  replay: z.strictObject({
    runs: z.number().int().min(0),
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    notRun: z.number().int().min(0),
  }),
});

export type HistoriqueLive = z.infer<typeof HistoriqueLive>;
export type HistoriqueReplay = z.infer<typeof HistoriqueReplay>;
export type StatsObservabilite = z.infer<typeof StatsObservabilite>;

const EnteteLive = z.strictObject({
  runId: z.string().uuid(),
  gateVersion: z.string(),
  chemin: z.enum(["connaissance", "patient", "refus", "inconnu"]),
  interrompu: z.boolean(),
  persiste: z.boolean(),
  dureeMs: z.number().int().min(0),
  nbAppels: z.number().int().min(0),
  nbPreuves: z.number().int().min(0),
  nbSnapshots: z.number().int().min(0),
  issue: z.enum(["ok", "echec", "inconnue", "bloquee", "duplicata", "inconnu"]).nullable(),
  createdAt: z.string(),
});

const EnteteReplay = z.strictObject({
  runId: z.string().uuid(),
  kind: z.string(),
  verdict: z.string(),
  passCount: z.number().int().min(0),
  failCount: z.number().int().min(0),
  notRunCount: z.number().int().min(0),
  casCount: z.number().int().min(0),
  createdAt: z.string(),
});

export type EnteteLive = z.infer<typeof EnteteLive>;
export type EnteteReplay = z.infer<typeof EnteteReplay>;

function bornerLimite(limite: number | undefined, defaut: number, min: number, max: number): number {
  if (limite === undefined || !Number.isInteger(limite)) return defaut;
  return Math.min(Math.max(limite, min), max);
}

function indisponible(contexte: string): Result<never> {
  return err({ code: "indisponible", message: m09.observabilite.indisponible, context: contexte });
}

/**
 * Lit un run live. NULL (assistante, hors périmètre, run inconnu) et
 * runId malformé rendent la même erreur constante — jamais d'oracle.
 */
export async function lireHistoriqueLive(
  runId: string,
  limite?: number,
): Promise<Result<HistoriqueLive>> {
  if (!UUID.safeParse(runId).success) return indisponible("rpc:get_live_history");
  const resultat = await db().rpc<unknown>("get_live_history", {
    p_run_id: runId,
    p_limit: bornerLimite(limite, 200, 1, 500),
  });
  if (!resultat.ok) {
    log.error("observabilite.lecture.live", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  const ligne = resultat.data[0];
  if (ligne === undefined || ligne === null) return indisponible("rpc:get_live_history");
  const valide = HistoriqueLive.safeParse(ligne);
  if (!valide.success) {
    log.error("observabilite.lecture.live", { code: "contrat", context: "rpc:get_live_history" });
    return indisponible("rpc:get_live_history");
  }
  return ok(valide.data);
}

/** Lit un run replay (094). Même honnêteté constante que le live. */
export async function lireHistoriqueReplay(
  runId: string,
  limite?: number,
): Promise<Result<HistoriqueReplay>> {
  if (!UUID.safeParse(runId).success) return indisponible("rpc:get_replay_history");
  const resultat = await db().rpc<unknown>("get_replay_history", {
    p_run_id: runId,
    p_limit: bornerLimite(limite, 200, 1, 500),
  });
  if (!resultat.ok) {
    log.error("observabilite.lecture.replay", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  const ligne = resultat.data[0];
  if (ligne === undefined || ligne === null) return indisponible("rpc:get_replay_history");
  const valide = HistoriqueReplay.safeParse(ligne);
  if (!valide.success) {
    log.error("observabilite.lecture.replay", { code: "contrat", context: "rpc:get_replay_history" });
    return indisponible("rpc:get_replay_history");
  }
  return ok(valide.data);
}

/** Lit les agrégats durées/verdicts (calculés en base, jamais ici). */export async function lireStatsObservabilite(
  jours?: number,
): Promise<Result<StatsObservabilite>> {
  const resultat = await db().rpc<unknown>("get_observability_stats", {
    p_jours: bornerLimite(jours, 30, 1, 365),
  });
  if (!resultat.ok) {
    log.error("observabilite.lecture.stats", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  const ligne = resultat.data[0];
  if (ligne === undefined || ligne === null) return indisponible("rpc:get_observability_stats");
  const valide = StatsObservabilite.safeParse(ligne);
  if (!valide.success) {
    log.error("observabilite.lecture.stats", { code: "contrat", context: "rpc:get_observability_stats" });
    return indisponible("rpc:get_observability_stats");
  }
  return ok(valide.data);
}

/**
 * Liste les runs live récents (en-têtes seuls). Porte NULL (assistante,
 * hors périmètre) → liste vide honnête : un vide ne distingue rien et ne
 * dit rien (anti-oracle), et c'est l'état vide naturel de l'écran.
 */
export async function listerRunsLive(limite?: number): Promise<Result<readonly EnteteLive[]>> {
  const resultat = await db().rpc<unknown>("list_live_runs", {
    p_limit: bornerLimite(limite, 20, 1, 100),
  });
  if (!resultat.ok) {
    log.error("observabilite.lecture.liste-live", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  const ligne = resultat.data[0];
  if (ligne === undefined || ligne === null) return ok([]);
  const valide = z.array(EnteteLive).safeParse(ligne);
  if (!valide.success) {
    log.error("observabilite.lecture.liste-live", { code: "contrat", context: "rpc:list_live_runs" });
    return indisponible("rpc:list_live_runs");
  }
  return ok(valide.data);
}

/** Liste les runs replay récents (en-têtes seuls). Même honnêteté vide. */
export async function listerRunsReplay(limite?: number): Promise<Result<readonly EnteteReplay[]>> {
  const resultat = await db().rpc<unknown>("list_replay_runs", {
    p_limit: bornerLimite(limite, 20, 1, 100),
  });
  if (!resultat.ok) {
    log.error("observabilite.lecture.liste-replay", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  const ligne = resultat.data[0];
  if (ligne === undefined || ligne === null) return ok([]);
  const valide = z.array(EnteteReplay).safeParse(ligne);
  if (!valide.success) {
    log.error("observabilite.lecture.liste-replay", { code: "contrat", context: "rpc:list_replay_runs" });
    return indisponible("rpc:list_replay_runs");
  }
  return ok(valide.data);
}
