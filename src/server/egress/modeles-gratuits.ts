import type { ErreurModele } from "./erreurs-modele";

export interface BesoinModele {
  readonly json: boolean;
  readonly streaming: boolean;
  readonly outils: boolean;
  readonly tokens: number;
  readonly tache: "conversation" | "intentions" | "connaissance" | "resume" | "analyse";
}
export interface QualificationModele {
  readonly json: boolean;
  readonly streaming: boolean;
  readonly qualite: number;
  readonly latenceMs: number;
}
export interface ModeleGratuit {
  readonly modelId: string;
  readonly provider: "openrouter";
  readonly isFree: true;
  readonly contextLength: number;
  readonly supportsTools: boolean;
  readonly structuredOutput: boolean;
  qualification: QualificationModele | null;
  failureCount: number;
  cooldownUntil: number;
  recoveryInFlight: boolean;
  lastHealthCheck: number | null;
  latencyMs: number | null;
  lastFailureCode: ErreurModele["code"] | null;
}

function prixZero(v: unknown): boolean { return v === 0 || (typeof v === "string" && /^0(?:\.0+)?$/.test(v)); }
export function normaliserModeleGratuit(brut: unknown): ModeleGratuit | null {
  if (typeof brut !== "object" || brut === null) return null;
  const m = brut as Record<string, unknown>;
  const p = m.pricing as Record<string, unknown> | undefined;
  const architecture = m.architecture as { input_modalities?: unknown; output_modalities?: unknown } | undefined;
  if (typeof m.id !== "string" || !m.id.endsWith(":free") || m.id.length > 160
    || typeof m.context_length !== "number" || !Number.isInteger(m.context_length) || m.context_length <= 0
    || p === undefined || !prixZero(p.prompt) || !prixZero(p.completion)
    || Object.values(p).some((value) => value !== null && value !== undefined && !prixZero(value))
    || !Array.isArray(m.supported_parameters)
    || (Array.isArray(architecture?.output_modalities) && !architecture.output_modalities.includes("text"))
    || (Array.isArray(architecture?.input_modalities) && !architecture.input_modalities.includes("text"))) return null;
  return {
    modelId: m.id, provider: "openrouter", isFree: true, contextLength: m.context_length,
    supportsTools: m.supported_parameters.includes("tools"),
    structuredOutput: m.supported_parameters.includes("response_format"),
    qualification: null, failureCount: 0, cooldownUntil: 0, recoveryInFlight: false,
    lastHealthCheck: null, latencyMs: null, lastFailureCode: null,
  };
}

/** Process-local health only. New catalogue entries are quarantined until real probes succeed. */
export class PoolModelesGratuits {
  private modeles = new Map<string, ModeleGratuit>();
  private accountUntil = 0;
  private accountCode: ErreurModele["code"] | null = null;
  constructor(private readonly maintenant: () => number = Date.now) {}
  actualiser(catalogue: readonly unknown[]): void {
    const prochains = new Map<string, ModeleGratuit>();
    for (const brut of catalogue) {
      const m = normaliserModeleGratuit(brut);
      if (m === null) continue;
      const ancien = this.modeles.get(m.modelId);
      prochains.set(m.modelId, ancien === undefined ? m : { ...ancien,
        contextLength: m.contextLength, supportsTools: m.supportsTools, structuredOutput: m.structuredOutput });
    }
    this.modeles = prochains;
  }
  qualifier(id: string, qualification: QualificationModele): void {
    const m = this.modeles.get(id);
    if (m === undefined || !Number.isFinite(qualification.qualite) || qualification.qualite < 1) return;
    m.qualification = qualification;
    this.reussir(id, qualification.latenceMs);
  }
  restaurerSante(id: string, sante: Partial<ModeleGratuit>): void {
    const m = this.modeles.get(id);
    if (!m) return;
    if (Number.isInteger(sante.failureCount) && sante.failureCount! >= 0 && sante.failureCount! <= 100) m.failureCount = sante.failureCount!;
    if (Number.isFinite(sante.cooldownUntil) && sante.cooldownUntil! > this.maintenant()) m.cooldownUntil = Math.min(sante.cooldownUntil!, this.maintenant() + 86_400_000);
    if (typeof sante.latencyMs === "number" && Number.isFinite(sante.latencyMs) && sante.latencyMs >= 0) m.latencyMs = sante.latencyMs;
    if (typeof sante.lastFailureCode === "string") m.lastFailureCode = sante.lastFailureCode;
  }
  private compatibles(b: BesoinModele): ModeleGratuit[] {
    if (this.accountUntil > this.maintenant()) return [];
    return [...this.modeles.values()].filter((m) => m.contextLength >= b.tokens
      && (!b.outils || m.supportsTools) && m.cooldownUntil <= this.maintenant() && !m.recoveryInFlight);
  }
  aQualifier(b: BesoinModele): readonly ModeleGratuit[] {
    return this.compatibles(b).filter((m) => m.qualification === null).sort((a, z) => a.modelId.localeCompare(z.modelId));
  }
  candidats(b: BesoinModele, prefere?: string): readonly ModeleGratuit[] {
    return this.compatibles(b).filter((m) => m.qualification !== null
      && (!b.json || m.qualification.json) && (!b.streaming || m.qualification.streaming))
      .sort((a, z) => (z.qualification?.qualite ?? 0) - (a.qualification?.qualite ?? 0)
        || a.failureCount - z.failureCount
        || (a.modelId === prefere ? -1 : z.modelId === prefere ? 1 : 0)
        || (a.latencyMs ?? Infinity) - (z.latencyMs ?? Infinity) || a.modelId.localeCompare(z.modelId));
  }
  reserver(id: string): boolean {
    const m = this.modeles.get(id);
    if (m === undefined || this.accountUntil > this.maintenant() || m.cooldownUntil > this.maintenant() || m.recoveryInFlight) return false;
    if (m.failureCount > 0) m.recoveryInFlight = true;
    return true;
  }
  reussir(id: string, latenceMs: number): void {
    const m = this.modeles.get(id);
    if (!m) return;
    m.failureCount = 0; m.cooldownUntil = 0; m.recoveryInFlight = false; m.lastFailureCode = null;
    m.lastHealthCheck = this.maintenant();
    m.latencyMs = m.latencyMs === null ? latenceMs : m.latencyMs * 0.7 + latenceMs * 0.3;
  }
  echouer(id: string, erreur: ErreurModele): void {
    const m = this.modeles.get(id);
    if (m) { m.recoveryInFlight = false; m.lastFailureCode = erreur.code; }
    if (erreur.code === "CANCELLED" || erreur.scope === "request") return;
    if (erreur.scope === "account") {
      this.accountUntil = this.maintenant() + Math.max(60_000, erreur.retryAfterMs);
      this.accountCode = erreur.code; return;
    }
    if (!m) return;
    m.failureCount++;
    m.cooldownUntil = this.maintenant() + Math.max(erreur.retryAfterMs, Math.min(900_000, 60_000 * 2 ** Math.min(4, m.failureCount - 1)));
    m.lastHealthCheck = this.maintenant();
  }
  statutCompte(): { readonly until: number; readonly code: ErreurModele["code"] | null } {
    return { until: this.accountUntil, code: this.accountUntil > this.maintenant() ? this.accountCode : null };
  }
  instantane(): readonly ModeleGratuit[] { return [...this.modeles.values()].map((m) => ({ ...m })); }
}
