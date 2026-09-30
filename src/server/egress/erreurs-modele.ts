/** Provider diagnostics contain only closed codes, never provider bodies. */
export type CodeErreurModele =
  | "MODEL_RATE_LIMIT" | "MODEL_QUOTA_EXHAUSTED" | "MODEL_TIMEOUT"
  | "MODEL_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "MALFORMED_RESPONSE"
  | "AUTH_FAILURE" | "INVALID_REQUEST" | "POLICY_REJECTION"
  | "NETWORK_FAILURE" | "SECURITY_BLOCK" | "CONFIGURATION" | "CANCELLED";

export interface TentativeInference {
  readonly model: string;
  readonly ms: number;
  readonly code: CodeErreurModele | "OK";
}

export class ErreurModele extends Error {
  tentatives: readonly TentativeInference[] = [];
  constructor(
    readonly code: CodeErreurModele,
    readonly recoverable: boolean,
    readonly scope: "model" | "account" | "request" = "model",
    readonly retryAfterMs = 0,
  ) { super(code); this.name = "ErreurModele"; }
}

export function classerErreurHttp(status: number, body: unknown, headers: Headers, now = Date.now()): ErreurModele {
  const o = body as { error?: { message?: unknown; metadata?: { provider_name?: unknown; provider_code?: unknown } } } | null;
  const message = typeof o?.error?.message === "string" ? o.error.message : "";
  const retry = headers.get("retry-after");
  const reset = headers.get("x-ratelimit-reset");
  let retryMs = retry === null ? 0 : /^\d+(?:\.\d+)?$/.test(retry)
    ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now);
  if (reset !== null && Number.isFinite(Number(reset))) retryMs = Math.max(retryMs, Number(reset) * 1000 - now);
  if (!Number.isFinite(retryMs)) retryMs = 0;
  if (status === 401) return new ErreurModele("AUTH_FAILURE", false, "account");
  if (status === 403 || status === 451) return new ErreurModele("POLICY_REJECTION", false, "request");
  if (status === 402) return new ErreurModele("MODEL_QUOTA_EXHAUSTED", false, "account", retryMs || 60_000);
  if (status === 429) {
    const upstream = o?.error?.metadata?.provider_name !== undefined || o?.error?.metadata?.provider_code !== undefined;
    const plateforme = headers.has("x-ratelimit-remaining") || headers.has("x-ratelimit-limit") || !upstream;
    const quotidien = /daily|per.day|quota|quotidien/i.test(message);
    const attente = quotidien && retryMs === 0 ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1) - now : retryMs;
    return new ErreurModele(quotidien ? "MODEL_QUOTA_EXHAUSTED" : "MODEL_RATE_LIMIT", !plateforme, plateforme ? "account" : "model", attente || 60_000);
  }
  if (status === 404 || status === 410) return new ErreurModele("MODEL_UNAVAILABLE", true);
  if (status === 408 || status === 504) return new ErreurModele("MODEL_TIMEOUT", true);
  if (status >= 500) return new ErreurModele("PROVIDER_UNAVAILABLE", true, "model", retryMs);
  return new ErreurModele("INVALID_REQUEST", false, "request");
}

export function normaliserErreurModele(cause: unknown, cancelled = false): ErreurModele {
  if (cancelled) return new ErreurModele("CANCELLED", false, "request");
  if (cause instanceof ErreurModele) return cause;
  if (cause instanceof TypeError) return new ErreurModele("NETWORK_FAILURE", true);
  const message = cause instanceof Error ? cause.message : "";
  if (/configuration:/.test(message)) return new ErreurModele("CONFIGURATION", false, "account");
  if (/timeout|delai|AbortError/.test(message) || (cause instanceof Error && cause.name === "AbortError")) return new ErreurModele("MODEL_TIMEOUT", true);
  if (/transitoire:/.test(message)) return new ErreurModele(/429/.test(message) ? "MODEL_RATE_LIMIT" : "PROVIDER_UNAVAILABLE", true);
  return new ErreurModele("MALFORMED_RESPONSE", true);
}
