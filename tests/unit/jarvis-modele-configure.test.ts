/**
 * LE MODÈLE N'EST NOMMÉ QUE DANS LA PASSERELLE — SINGLE-MODEL.
 *
 * Décision humaine 2026-10-03 : `qwen/qwen3.7-flash` payant, primary-only.
 * `resolveModel()` ne lit plus AUCUNE surcharge (`OPENROUTER_MODEL`,
 * `LLM_MODEL`, `JARVIS_CHAT_MODEL`, `JARVIS_RESUME_MODEL`) : un seul candidat,
 * une seule tentative, via la clé OpenRouter serveur.
 *
 * Ces tests gardent les propriétés, pas la mise en forme :
 *   1. la résolution est UNE, et vit dans la passerelle ;
 *   2. les deux routes ne portent plus de nom de modèle en dur ;
 *   3. aucune variable d'environnement ne change le modèle résolu.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveModel } from "../../src/server/egress/external-call";
import { ALEXA_PRIMARY_MODEL } from "../../src/server/alexa/model-policy";
import { reinitialiserEnv } from "../../src/server/env";

const ROUTES = [
  "src/app/api/jarvis/jarvis-analyze-session/route.ts",
  "src/app/api/jarvis/jarvis-resume-cas/route.ts",
] as const;

/**
 * Les familles que le checkpoint surveille. On les cherche dans le CODE, pas
 * dans les commentaires : un nom de modèle cité dans une phrase documente une
 * mesure, il ne couple rien à un fournisseur.
 */
const NOMS_DE_MODELE = /nemotron|gemini-2\.5|gemini-3\.8|gpt-4|claude-3/;

function lignesDeCode(chemin: string): readonly string[] {
  return readFileSync(join(process.cwd(), chemin), "utf8")
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    });
}

/**
 * `env()` valide TOUTE la configuration serveur, pas seulement le modèle : sans
 * `MINDCARE_DATABASE_URL`, elle refuse de rendre quoi que ce soit. On pose donc
 * une URL SYNTAXIQUEMENT valide et manifestement fictive — c'est une exigence
 * de schéma, pas un contournement, et rien ici n'ouvre de connexion.
 */
const URL_FICTIVE = "postgresql://essai:essai@127.0.0.1:1/essai";
let urlPrecedente: string | undefined;

beforeEach(() => {
  urlPrecedente = process.env.MINDCARE_DATABASE_URL;
  process.env.MINDCARE_DATABASE_URL ??= URL_FICTIVE;
  reinitialiserEnv();
});

afterEach(() => {
  delete process.env.OPENROUTER_MODEL;
  delete process.env.LLM_MODEL;
  delete process.env.JARVIS_CHAT_MODEL;
  delete process.env.JARVIS_RESUME_MODEL;
  if (urlPrecedente === undefined) delete process.env.MINDCARE_DATABASE_URL;
  else process.env.MINDCARE_DATABASE_URL = urlPrecedente;
  reinitialiserEnv();
});

describe("aucun nom de modèle en dur hors de la passerelle", () => {
  for (const route of ROUTES) {
    it(`${route} ne nomme aucun modèle dans son code`, () => {
      const fautives = lignesDeCode(route).filter((l) => NOMS_DE_MODELE.test(l));
      expect(fautives).toEqual([]);
    });

    it(`${route} conserve une résolution unique ou le résumé local sans modèle externe`, () => {
      // ⚠️ On vérifie l'APPEL, pas seulement l'absence de littéral. Sans cette
      // assertion, supprimer purement et simplement `p_model` ferait passer le
      // test précédent tout en supprimant la trace d'audit.
      const source = readFileSync(join(process.cwd(), route), "utf8");
      if (route.endsWith("jarvis-resume-cas/route.ts")) {
        expect(source).toContain('from "@/app/api/alexa/summary/route"');
        const summary = readFileSync(join(process.cwd(), "src/app/api/alexa/summary/route.ts"), "utf8");
        expect(summary).toContain("buildCaseSummary(context");
        expect(summary).toContain('p_model: "local-structured"');
        expect(summary).not.toContain("inferAlexa(");
        return;
      }
      expect(source).toContain("resolveModel");
      expect(source).toContain('from "@/server/egress/external-call"');
    });
  }
});

describe("résolution single-model : aucune surcharge d'environnement", () => {
  it("le primary unique est qwen/qwen3.7-flash", () => {
    expect(ALEXA_PRIMARY_MODEL).toBe("qwen/qwen3.7-flash");
    expect(resolveModel()).toBe("qwen/qwen3.7-flash");
    expect(resolveModel("jarvis")).toBe("qwen/qwen3.7-flash");
    expect(resolveModel("resume-cas")).toBe("qwen/qwen3.7-flash");
  });

  it("OPENROUTER_MODEL / LLM_MODEL ne changent plus rien", () => {
    process.env.OPENROUTER_MODEL = "qwen/modele-a:free";
    process.env.LLM_MODEL = "qwen/modele-b:free";
    reinitialiserEnv();
    expect(resolveModel()).toBe(ALEXA_PRIMARY_MODEL);
    expect(resolveModel("jarvis")).toBe(ALEXA_PRIMARY_MODEL);
    expect(resolveModel("resume-cas")).toBe(ALEXA_PRIMARY_MODEL);
  });

  it("JARVIS_CHAT_MODEL / JARVIS_RESUME_MODEL ne changent plus rien", () => {
    process.env.OPENROUTER_MODEL = "qwen/global:free";
    process.env.JARVIS_CHAT_MODEL = "qwen/chat-libre:free";
    process.env.JARVIS_RESUME_MODEL = "qwen/resume-libre:free";
    reinitialiserEnv();
    expect(resolveModel()).toBe(ALEXA_PRIMARY_MODEL);
    expect(resolveModel("jarvis")).toBe(ALEXA_PRIMARY_MODEL);
    expect(resolveModel("resume-cas")).toBe(ALEXA_PRIMARY_MODEL);
  });

  it("sans configuration, le repli est celui de la passerelle — et il est unique", () => {
    delete process.env.OPENROUTER_MODEL;
    delete process.env.LLM_MODEL;
    reinitialiserEnv();
    const repli = resolveModel();
    expect(repli).not.toBe("");
    // Le repli est DÉFINI DANS LA PASSERELLE, et nulle part ailleurs : c'est la
    // propriété que le checkpoint contrôle, affirmée ici en test.
    const passerelle = readFileSync(
      join(process.cwd(), "src/server/egress/external-call.ts"),
      "utf8",
    );
    expect(passerelle).toContain("ALEXA_PRIMARY_MODEL");
    expect(readFileSync(join(process.cwd(), "src/server/alexa/model-policy.ts"), "utf8")).toContain(repli);
    for (const route of ROUTES) {
      expect(readFileSync(join(process.cwd(), route), "utf8")).not.toContain(repli);
    }
  });
});
