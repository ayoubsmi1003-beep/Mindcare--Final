import { normaliserModeleGratuit, type ModeleGratuit } from "@/server/egress/modeles-gratuits";

/**
 * Alexa single-model policy (décision humaine : Qwen 3.7 Flash payant, primary-only).
 *
 * Remplace la politique « all-openrouter :free » autorisée le 2 octobre
 * (pool multi-familles à prix nul, `max_price: {0,0}`, failover ×2).
 * Le tour ordinaire n'a plus qu'UN candidat, sans surcharge d'env, sans
 * qualification catalogue et sans bascule Gemini : `resolveModel()` renvoie
 * toujours `ALEXA_PRIMARY_MODEL`, `candidatsInference()` ne propose que lui.
 *
 * `isFreeAlexaModelId` / `normaliseAlexaModel` restent exportés pour les tests
 * du pool de maintenance, mais ne gardent plus le chemin nominal.
 */
export const ALEXA_PRIMARY_MODEL = "qwen/qwen3.7-flash";
export const ALEXA_PROVIDER_POLICY = Object.freeze({
  data_collection: "deny" as const, zdr: true, require_parameters: true,
  // Tarif OpenRouter relevé le 2026-10-03 : 0,03 $ / 0,13 $ par M tokens
  // (input / output). Marge : 0,05 / 0,20 — borne anti-dérapage, pas un blanc-seing.
  max_price: Object.freeze({ prompt: 0.05, completion: 0.2 }),
});

/** Le seul modèle autorisé sur le chemin nominal : le primary payant. */
export function isAlexaPrimaryModelId(id: unknown): id is string {
  return id === ALEXA_PRIMARY_MODEL;
}

export function isFreeAlexaModelId(id: unknown): id is string {
  return typeof id === "string" && id.length <= 160
    && /^[a-z0-9][a-z0-9._-]{0,79}\/[a-z0-9][a-z0-9._-]{1,140}:free$/.test(id);
}

/** Metadata is necessary, never sufficient: a real privacy-compatible probe must also pass. */
export function normaliseAlexaModel(value: unknown): ModeleGratuit | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { id?: unknown; pricing?: unknown };
  if (!isFreeAlexaModelId(raw.id) || typeof raw.pricing !== "object" || raw.pricing === null) return null;
  const prices = Object.values(raw.pricing);
  if (prices.some((price) => price !== 0 && !(typeof price === "string" && /^0(?:\.0+)?$/.test(price)))) return null;
  return normaliserModeleGratuit(value);
}
