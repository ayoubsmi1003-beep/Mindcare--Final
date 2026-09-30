import { describe, expect, it } from "vitest";
import { PoolModelesGratuits } from "../../src/server/egress/modeles-gratuits";
import { ErreurModele, classerErreurHttp } from "../../src/server/egress/erreurs-modele";
import { conduireInference } from "../../src/server/egress/tentatives-inference";

const modele = (id: string, extra: Record<string, unknown> = {}) => ({
  id, context_length: 32_768,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  pricing: { prompt: "0", completion: "0", request: "0" },
  supported_parameters: ["max_tokens", "response_format"], ...extra,
});
const besoin = { json: false, streaming: false, outils: false, tokens: 8000, tache: "conversation" as const };

function poolAvecHorloge() {
  let heure = 0;
  const pool = new PoolModelesGratuits(() => heure);
  pool.actualiser([modele("essai/a:free"), modele("essai/b:free"), modele("essai/c:free")]);
  for (const id of ["essai/a:free", "essai/b:free", "essai/c:free"]) {
    pool.qualifier(id, { json: true, streaming: true, qualite: 1, latenceMs: 100 });
  }
  return { pool, avancer: (ms: number) => { heure += ms; }, maintenant: () => heure };
}

describe("pool gratuit, capacités prouvées et santé", () => {
  it("rejette tarif non nul, non-free, contexte insuffisant et décision non-chat", () => {
    const pool = new PoolModelesGratuits();
    pool.actualiser([modele("essai/a:free"), modele("essai/payant"),
      modele("essai/faux:free", { pricing: { prompt: "0", completion: "0", request: "1" } }),
      modele("essai/court:free", { context_length: 1000 }),
      modele("essai/decision:free", { architecture: { input_modalities: ["text"], output_modalities: ["decision"] } })]);
    expect(pool.aQualifier(besoin).map((m) => m.modelId)).toEqual(["essai/a:free"]);
    expect(pool.candidats(besoin)).toEqual([]);
    pool.qualifier("essai/a:free", { json: false, streaming: true, qualite: 1, latenceMs: 100 });
    expect(pool.candidats({ ...besoin, json: true })).toEqual([]);
    expect(pool.candidats(besoin).map((m) => m.modelId)).toEqual(["essai/a:free"]);
  });
  it("un modèle payé configuré ne bloque pas les gratuits; au moins trois candidats", () => {
    const { pool } = poolAvecHorloge();
    expect(pool.candidats(besoin, "essai/payant")).toHaveLength(3);
    expect(pool.candidats(besoin, "essai/b:free")[0]?.modelId).toBe("essai/b:free");
  });
  it("cooldown, une seule tentative de récupération concurrente et réintégration", () => {
    const { pool, avancer } = poolAvecHorloge();
    pool.echouer("essai/a:free", new ErreurModele("MODEL_RATE_LIMIT", true, "model", 90_000));
    expect(pool.candidats(besoin).some((m) => m.modelId === "essai/a:free")).toBe(false);
    avancer(90_001);
    expect(pool.reserver("essai/a:free")).toBe(true);
    expect(pool.reserver("essai/a:free")).toBe(false);
    pool.reussir("essai/a:free", 50);
    expect(pool.candidats(besoin, "essai/a:free")[0]?.modelId).toBe("essai/a:free");
  });
  it("une limite de compte coupe tout le pool et respecte sa récupération", () => {
    const { pool, avancer } = poolAvecHorloge();
    pool.echouer("essai/a:free", new ErreurModele("MODEL_QUOTA_EXHAUSTED", false, "account", 300_000));
    expect(pool.candidats(besoin)).toEqual([]);
    avancer(300_001);
    expect(pool.candidats(besoin)).toHaveLength(3);
  });
  it("une hausse de prix ou disparition du catalogue retire le modèle", () => {
    const { pool } = poolAvecHorloge();
    pool.actualiser([modele("essai/a:free", { pricing: { prompt: "1", completion: "0" } }), modele("essai/b:free")]);
    expect(pool.candidats(besoin).map((m) => m.modelId)).toEqual(["essai/b:free"]);
  });
});

describe("erreurs fournisseur sans données brutes", () => {
  it("distingue rate-limit fournisseur et quota de plateforme", () => {
    expect(classerErreurHttp(429, { error: { metadata: { provider_name: "upstream" } } }, new Headers()).scope).toBe("model");
    const h = new Headers({ "X-RateLimit-Remaining": "0", "Retry-After": "120" });
    const e = classerErreurHttp(429, { error: { message: "secret à ne pas propager" } }, h);
    expect(e.scope).toBe("account");
    expect(e.retryAfterMs).toBe(120_000);
    expect(e.message).not.toContain("secret");
  });
  it.each([401, 403, 400, 402])("HTTP %s n'est pas rejoué sur un autre modèle", (status) => {
    expect(classerErreurHttp(status, null, new Headers()).recoverable).toBe(false);
  });
});

describe("trois tentatives distinctes dans une échéance unique", () => {
  it("A rate-limité, B timeout, C réussit; trace des modèles réellement utilisés", async () => {
    const appels: string[] = [];
    const result = await conduireInference(["a", "b", "c", "d"], async (id) => {
      appels.push(id);
      if (id === "a") throw new ErreurModele("MODEL_RATE_LIMIT", true);
      if (id === "b") throw new ErreurModele("MODEL_TIMEOUT", true);
      return "correct";
    }, { timeoutMs: 1000 });
    expect(appels).toEqual(["a", "b", "c"]);
    expect(result.model).toBe("c");
    expect(result.tentatives).toHaveLength(3);
  });
  it("annulation et erreur permanente stoppent sans épuiser la chaîne", async () => {
    const appels: string[] = [];
    await expect(conduireInference(["a", "b"], async (id) => {
      appels.push(id); throw new ErreurModele("AUTH_FAILURE", false, "account");
    }, { timeoutMs: 1000 })).rejects.toMatchObject({ code: "AUTH_FAILURE" });
    expect(appels).toEqual(["a"]);
    const c = new AbortController(); c.abort();
    await expect(conduireInference(["a", "b"], async () => "incorrect", { timeoutMs: 1000, signal: c.signal })).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("borne un transport qui ignore AbortSignal et réserve du temps au modèle suivant", async () => {
    const start = Date.now();
    const r = await conduireInference(["a", "b"], async (id) => id === "a" ? new Promise<string>(() => {}) : "ok", { timeoutMs: 120 });
    expect(r.model).toBe("b");
    expect(Date.now() - start).toBeLessThan(250);
  });
});
