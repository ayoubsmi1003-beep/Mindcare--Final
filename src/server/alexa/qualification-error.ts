import { ErreurModele, normaliserErreurModele } from "@/server/egress/erreurs-modele";

export type AlexaQualificationPhase = "catalog" | "quota" | "probes";

/** Closed diagnostics only: never retain the original network/provider error. */
export class AlexaQualificationError extends ErreurModele {
  constructor(readonly phase: AlexaQualificationPhase, cause: unknown, cancelled = false) {
    const safe = normaliserErreurModele(cause, cancelled);
    super(safe.code, safe.recoverable, safe.scope, safe.retryAfterMs, safe.detail);
    this.name = "AlexaQualificationError";
  }
}
