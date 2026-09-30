/**
 * Câblage JEV Slice 2 — LE CONTRAT SOURCE DE `classifierIntentSiUtile`.
 *
 * La logique (seuil, gardes, repli) est éprouvée en unit pur
 * (`jarvis-jev-pre-routage.test.ts`). Ce fichier fige l'INTÉGRATION, à la
 * manière de `jarvis-modele-configure.test.ts` : le pré-routage JEV est
 * derrière le flag, après l'exclusion du commit, avant M01 — et M01 nominal
 * reste le chemin de repli. Si un réordonnancement casse ces propriétés
 * (JEV avant le commit, JEV sans flag, M01 supprimé), ce test casse avec.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROUTE = readFileSync(
  join(process.cwd(), "src/app/api/jarvis/jarvis-chat/route.ts"),
  "utf8",
);

describe("pré-routage JEV — bornes d'intégration", () => {
  it("le flag OFF par défaut existe et la route le consulte", () => {
    expect(ROUTE).toContain("jevActif()");
    const env = readFileSync(join(process.cwd(), "src/server/env.ts"), "utf8");
    expect(env).toContain("JARVIS_JEV_ENABLED");
    // Convention stricte conservée : seule la chaîne "true" active.
    expect(env).toMatch(/jevActif\(\): boolean \{\s*\n?\s*return env\(\)\.JARVIS_JEV_ENABLED === "true";/);
  });

  it("le commit est exclu AVANT tout appel JEV (ordre = propriété)", () => {
    const idxCommit = ROUTE.indexOf('chemin === "commit"');
    const idxJev = ROUTE.indexOf("routerRapideJev(");
    expect(idxCommit).toBeGreaterThanOrEqual(0);
    expect(idxJev).toBeGreaterThanOrEqual(0);
    expect(idxCommit).toBeLessThan(idxJev);
  });

  it("JEV ne court que sur le chemin connaissance, derrière le flag", () => {
    expect(ROUTE).toContain('chemin === "connaissance" && jevActif()');
  });

  it("M01 nominal suit toujours (le repli n'est jamais supprimé)", () => {
    const idxJev = ROUTE.indexOf("routerRapideJev(");
    const idxM01 = ROUTE.indexOf("await classifierIntent(", idxJev);
    expect(idxM01).toBeGreaterThan(idxJev);
  });

  it("le saut passe par devraitSauterM01, jamais par une condition inline", () => {
    expect(ROUTE).toContain("devraitSauterM01(rapide, chemin)");
  });

  it("l'adaptateur envoie state + questions canoniques sur purpose jarvis", () => {
    expect(ROUTE).toContain('purpose: "jarvis"');
    expect(ROUTE).toContain("QUESTIONS_JEV");
    expect(ROUTE).toContain("JEV_PROMPT_VERSION");
    expect(ROUTE).toContain("TIMEOUT_MS_JEV");
  });

  it("aucun nom de modèle JEV en dur dans la route (résolution passerelle)", () => {
    const lignes = ROUTE.split(/\r?\n/).filter((l) => {
      const t = l.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*");
    });
    const fautives = lignes.filter((l) => /typesafe\/jev|jev-1\.13/.test(l));
    expect(fautives).toEqual([]);
  });
});
