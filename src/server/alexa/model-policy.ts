import { normaliserModeleGratuit, type ModeleGratuit } from "@/server/egress/modeles-gratuits";

/**
 * Free-only policy requested on 2026-10-04. Catalogue prices, real synthetic
 * qualification and the immutable zero-price transport ceiling all apply.
 * Gemini is restricted to a confirmed unpaid project and synthetic deployment.
 */
/** Current delivery pins. All active Alexa transports import these values. */
export const ALEXA_CONVERSATION_MODEL = "Qwen_Qwen3.5-2B-Q4_K_M.gguf";
// Retained provider pin for dormant cloud qualification; conversation uses local Qwen3.5.
export const ALEXA_DIRECT_MODEL = "gemini-3.5-flash";
export const ALEXA_STT_MODEL = "gemini-3.5-transcribe";
export const ALEXA_TTS_MODEL = "gemini-3.8-flash-tts";
export const ALEXA_TTS_VOICE = "Kore";
export const ALEXA_LIVE_MODEL = "gemini-3.8-live";

// Legacy free-pool qualification policy; not Alexa's delivery transport.
export const ALEXA_PRIMARY_MODEL = "qwen/qwen3.8-27b:free";
export const ALEXA_GEMINI_FREE_MODEL = "gemini-3.5-flash-lite";
// Smallest general text model listed in Groq's Free Plan limits (2026-10-04).
export const ALEXA_GROQ_FREE_MODEL = "openai/gpt-oss-20b";
export const ALEXA_PROVIDER_POLICY = Object.freeze({
  data_collection: "deny" as const, zdr: true, require_parameters: true,
  max_price: Object.freeze({ prompt: 0, completion: 0 }), sort: "latency" as const,
});

/** Preference only; selection must still pass catalogue and qualification. */
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
