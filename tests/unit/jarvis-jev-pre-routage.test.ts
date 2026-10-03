/**
 * Spike JEV Slice 1 — le pré-routage rapide, éprouvé SANS réseau, SANS clé,
 * SANS base (transports faux + `fetch` simulé).
 *
 * Deux sujets :
 * 1. `routerRapideJev` : le verdict typé, le seuil, les gardes (vide, motif
 *    identifiant), le fail-closed (panne → `ecarte`, jamais deviné).
 * 2. `decisions()` : endpoint payant retiré ; zéro sortie réseau même avec
 *    clé, ancien réglage actif ou modèle Qwen gratuit fourni en alternative.
 *
 * NON couvert ici (exigera la Slice 2) : le câblage dans `route.ts`
 * (primauté du commit déterministe, accord/désaccord avec M01) et tout appel
 * réel facturé.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decisions,
  type ReponseDecision,
} from "@/server/egress/external-call";
import { reinitialiserEnv } from "@/server/env";
import {
  devraitSauterM01,
  routerRapideJev,
  type TransportJev,
} from "@/server/jarvis/classifieur-jev";

const URL_FICTIVE = "postgresql://essai:essai@127.0.0.1:1/essai";
let urlPrecedente: string | undefined;
let clePrecedente: string | undefined;

beforeEach(() => {
  urlPrecedente = process.env.MINDCARE_DATABASE_URL;
  process.env.MINDCARE_DATABASE_URL ??= URL_FICTIVE;
  clePrecedente = process.env.OPENROUTER_API_KEY;
  reinitialiserEnv();
});

afterEach(() => {
  if (urlPrecedente === undefined) delete process.env.MINDCARE_DATABASE_URL;
  else process.env.MINDCARE_DATABASE_URL = urlPrecedente;
  if (clePrecedente === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = clePrecedente;
  delete process.env.JEV_MODEL;
  vi.unstubAllEnvs();
  reinitialiserEnv();
  vi.unstubAllGlobals();
});

/** Faux transport JEV pinné — aucun réseau. */
function fauxTransport(
  reponses: Record<string, ReponseDecision> | null,
  modele = "essai/jev-faux",
): TransportJev & { appels: number } {
  const faux = {
    appels: 0,
    async questionner() {
      faux.appels++;
      return { reponses, modele };
    },
  };
  return faux;
}

const BASE = {
  promptVersion: "jev-route-v1",
  promptHash: "essai",
  sessionToken: "00000000-0000-0000-0000-000000000000",
  state: "Quel est son traitement actuel ?",
  questions: {
    route: { type: "choice" as const, instructions: "route" },
    signalPatient: { type: "noul" as const, instructions: "signal" },
  },
};

describe("routerRapideJev — verdict typé et fail-closed", () => {
  it("patient désigné → valide, signal vrai", async () => {
    const t = fauxTransport({
      route: { type: "choice", choice: "patient", confidence: 0.9, probabilities: { patient: 0.9 } },
      signalPatient: { type: "noul", noul: 0.95 },
    });
    const r = await routerRapideJev("Quel est son traitement actuel ?", t);
    expect(r.statut).toBe("valide");
    if (r.statut === "valide") {
      expect(r.route).toBe("patient");
      expect(r.signalPatient).toBe(true);
      expect(r.confiance).toBe(0.9);
    }
  });

  it("connaissance → valide, signal faux", async () => {
    const t = fauxTransport({
      route: { type: "choice", choice: "connaissance", confidence: 0.8 },
      signalPatient: { type: "noul", noul: 0.1 },
    });
    const r = await routerRapideJev("Que dit le référentiel sur la dépression ?", t);
    expect(r.statut).toBe("valide");
    if (r.statut === "valide") {
      expect(r.route).toBe("connaissance");
      expect(r.signalPatient).toBe(false);
    }
  });

  it("confiance sous le seuil → confiance-basse, jamais deviné", async () => {
    const t = fauxTransport({
      route: { type: "choice", choice: "patient", confidence: 0.4 },
      signalPatient: { type: "noul", noul: 0.5 },
    });
    const r = await routerRapideJev("Heu… le truc d'hier ?", t);
    expect(r).toMatchObject({ statut: "ecarte", raison: "confiance-basse" });
  });

  it("route inconnue → invalide", async () => {
    const t = fauxTransport({
      // Forme volontairement hors contrat : le routeur ne connaît pas cette route.
      route: { type: "choice", choice: "teleportation", confidence: 0.99 },
      signalPatient: { type: "noul", noul: 0.5 },
    });
    const r = await routerRapideJev("n'importe quoi", t);
    expect(r).toMatchObject({ statut: "ecarte", raison: "invalide" });
  });

  it("réponse incomplète (signal manquant) → invalide", async () => {
    const t = fauxTransport({
      route: { type: "choice", choice: "patient", confidence: 0.9 },
    });
    const r = await routerRapideJev("Et avant ?", t);
    expect(r).toMatchObject({ statut: "ecarte", raison: "invalide" });
  });

  it("transport muet → indisponible", async () => {
    const r = await routerRapideJev("Quel est son traitement ?", fauxTransport(null));
    expect(r).toMatchObject({ statut: "ecarte", raison: "indisponible" });
  });

  it("transport qui lève → indisponible, jamais d'exception", async () => {
    const t: TransportJev = {
      async questionner() {
        throw new Error("réseau coupé");
      },
    };
    const r = await routerRapideJev("Quel est son traitement ?", t);
    expect(r).toMatchObject({ statut: "ecarte", raison: "indisponible" });
  });

  it("motif identifiant → AUCUN appel réseau", async () => {
    const t = fauxTransport({
      route: { type: "choice", choice: "patient", confidence: 0.99 },
      signalPatient: { type: "noul", noul: 0.99 },
    });
    const r = await routerRapideJev("Appelle le 0554123456 s'il te plaît", t);
    expect(r).toMatchObject({ statut: "ecarte", raison: "motif-interdit" });
    expect(t.appels).toBe(0);
  });

  it("message vide → invalide, sans réseau", async () => {
    const t = fauxTransport(null);
    const r = await routerRapideJev("   ", t);
    expect(r).toMatchObject({ statut: "ecarte", raison: "invalide" });
    expect(t.appels).toBe(0);
  });
});

describe("devraitSauterM01 — le seul cas qui saute M01", () => {
  const valide = (route: "patient" | "connaissance" | "commit", signalPatient: boolean) =>
    ({
      statut: "valide",
      route,
      signalPatient,
      confiance: 0.9,
      latenceMs: 120,
      modele: "essai/jev-faux",
    }) as const;

  it("double connaissance sans signal → on saute (cas B historique, moins un appel)", () => {
    expect(devraitSauterM01(valide("connaissance", false), "connaissance")).toBe(true);
  });

  it("signal patient → M01 nominal (JEV ne monte jamais un dossier)", () => {
    expect(devraitSauterM01(valide("connaissance", true), "connaissance")).toBe(false);
  });

  it("JEV dit patient → M01 nominal (pas de montée sur ordre du modèle)", () => {
    expect(devraitSauterM01(valide("patient", false), "connaissance")).toBe(false);
    expect(devraitSauterM01(valide("patient", true), "patient")).toBe(false);
  });

  it("JEV dit commit → M01 nominal (le commit est tranché avant, jamais ici)", () => {
    expect(devraitSauterM01(valide("commit", false), "connaissance")).toBe(false);
  });

  it("écarté JEV → M01 nominal (panne = repli, jamais vide)", () => {
    expect(
      devraitSauterM01({ statut: "ecarte", raison: "indisponible", latenceMs: 5, modele: "x" }, "connaissance"),
    ).toBe(false);
  });
});

describe("decisions() — Jev reste retiré de tous les parcours Alexa gratuits", () => {
  it.each(["jarvis", "resume-cas"] as const)("refuse le défaut, le modèle payant et l'alternative gratuite pour %s", async purpose => {
    process.env.OPENROUTER_API_KEY = "essai-clef";
    vi.stubEnv("JARVIS_JEV_ENABLED", "true");
    const network = vi.fn(async () => { throw new Error("Endpoint Jev interdit"); });
    vi.stubGlobal("fetch", network);
    for (const modele of [undefined, "typesafe/jev-1.13", "qwen/qwen3.8-27b:free"]) {
      if (modele) vi.stubEnv("JEV_MODEL", modele);
      reinitialiserEnv();
      const result = await decisions({ purpose, ...BASE, ...(modele ? { modele } : {}) });
      expect(result).toMatchObject({ ok: false, error: { code: "configuration" } });
    }
    expect(network).not.toHaveBeenCalled();
  });

  it("clé absente → configuration, sans réseau", async () => {
    delete process.env.OPENROUTER_API_KEY;
    reinitialiserEnv();
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await decisions({ purpose: "jarvis", ...BASE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("configuration");
    expect(f).not.toHaveBeenCalled();
  });

});
