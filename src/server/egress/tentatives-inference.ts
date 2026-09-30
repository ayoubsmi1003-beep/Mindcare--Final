import { ErreurModele, normaliserErreurModele, type TentativeInference } from "./erreurs-modele";

export interface PolitiqueInference {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly maintenant?: () => number;
  readonly maxAttempts?: number;
  readonly reserver?: (modele: string) => boolean;
  readonly surEchec?: (modele: string, erreur: ErreurModele) => void;
  readonly surTentative?: (tentative: TentativeInference) => Promise<void> | void;
}

/** One total deadline; each attempt leaves time for the next distinct candidate. */
export async function conduireInference<T>(
  modeles: readonly string[],
  appel: (model: string, timeoutMs: number, signal: AbortSignal) => Promise<T>,
  p: PolitiqueInference,
): Promise<{ readonly data: T; readonly model: string; readonly tentatives: readonly TentativeInference[] }> {
  const horloge = p.maintenant ?? Date.now;
  const echeance = horloge() + Math.max(0, Math.min(p.timeoutMs, 60_000));
  const candidats = [...new Set(modeles)].slice(0, Math.min(3, p.maxAttempts ?? 3));
  const tentatives: TentativeInference[] = [];
  let derniere = new ErreurModele("MODEL_UNAVAILABLE", false);
  for (let n = 0; n < candidats.length; n++) {
    if (p.signal?.aborted) throw new ErreurModele("CANCELLED", false, "request");
    const restant = echeance - horloge();
    if (restant <= 0) { derniere = new ErreurModele("MODEL_TIMEOUT", true); break; }
    const model = candidats[n]!;
    if (p.reserver && !p.reserver(model)) continue;
    const budget = Math.max(1, Math.floor(restant / (n === candidats.length - 1 ? 1 : 2)));
    const c = new AbortController();
    const annuler = () => c.abort();
    p.signal?.addEventListener("abort", annuler, { once: true });
    const depart = horloge();
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let abandon: (() => void) | undefined;
    try {
      const borne = new Promise<never>((_, rejeter) => {
        minuteur = setTimeout(() => { c.abort(); rejeter(new ErreurModele("MODEL_TIMEOUT", true)); }, budget);
        abandon = () => rejeter(new ErreurModele("CANCELLED", false, "request"));
        p.signal?.addEventListener("abort", abandon, { once: true });
      });
      const data = await Promise.race([appel(model, budget, c.signal), borne]);
      const t = { model, ms: horloge() - depart, code: "OK" as const };
      tentatives.push(t); await p.surTentative?.(t);
      return { data, model, tentatives };
    } catch (cause) {
      c.abort();
      derniere = normaliserErreurModele(cause, p.signal?.aborted);
      const t = { model, ms: horloge() - depart, code: derniere.code };
      tentatives.push(t); p.surEchec?.(model, derniere); await p.surTentative?.(t);
      if (!derniere.recoverable || derniere.scope !== "model") break;
    } finally {
      clearTimeout(minuteur); p.signal?.removeEventListener("abort", annuler);
      if (abandon) p.signal?.removeEventListener("abort", abandon);
    }
  }
  derniere.tentatives = tentatives;
  throw derniere;
}
