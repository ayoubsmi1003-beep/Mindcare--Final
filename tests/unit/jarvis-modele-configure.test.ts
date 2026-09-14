/**
 * LE MODÈLE N'EST NOMMÉ QUE DANS LA PASSERELLE.
 *
 * ═══ LE DÉFAUT MESURÉ, ET POURQUOI IL COMPTAIT ═══
 * `jarvis-analyze-session` et `jarvis-resume-cas` recopiaient à la main la
 * chaîne de résolution du modèle pour renseigner `p_model` — la valeur écrite
 * dans la trace d'AUDIT. Le modèle réellement appelé était pourtant déjà le bon :
 * `llm()` résout dans la passerelle, et lui seul. C'est donc la valeur
 * ENREGISTRÉE qui divergeait.
 *
 * ⚠️ ET ELLE DIVERGEAIT VRAIMENT, pas seulement en théorie. `resume-cas`
 * écrivait `env().OPENROUTER_MODEL ?? "<repli>"` — sans `LLM_MODEL`. Avec
 * `LLM_MODEL` seul posé, l'appel partait sur ce modèle-là pendant que l'audit
 * inscrivait le repli. Une trace d'audit qui nomme un modèle qui n'a pas servi
 * est pire qu'une trace absente : elle est crue.
 *
 * Ces tests gardent les trois propriétés, pas la mise en forme :
 *   1. la résolution est UNE, et vit dans la passerelle ;
 *   2. les deux routes ne portent plus de nom de modèle en dur ;
 *   3. la précédence `OPENROUTER_MODEL > LLM_MODEL > repli` est respectée.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveModel } from "../../src/server/egress/external-call";
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
const NOMS_DE_MODELE = /nemotron|gemini-2\.5|gpt-4|claude-3/;

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

    it(`${route} passe par la résolution de la passerelle`, () => {
      // ⚠️ On vérifie l'APPEL, pas seulement l'absence de littéral. Sans cette
      // assertion, supprimer purement et simplement `p_model` ferait passer le
      // test précédent tout en supprimant la trace d'audit.
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source).toContain("resolveModel");
      expect(source).toContain('from "@/server/egress/external-call"');
    });
  }
});

describe("la précédence de configuration est celle de la passerelle", () => {
  it("OPENROUTER_MODEL prime sur tout", () => {
    process.env.OPENROUTER_MODEL = "essai/modele-a";
    process.env.LLM_MODEL = "essai/modele-b";
    reinitialiserEnv();
    expect(resolveModel()).toBe("essai/modele-a");
  });

  it("LLM_MODEL sert quand OPENROUTER_MODEL est absent", () => {
    // ⚠️ C'EST EXACTEMENT LE CAS QUE `resume-cas` RATAIT. Il ignorait
    // `LLM_MODEL` et inscrivait le repli dans l'audit pendant que l'appel
    // partait sur `LLM_MODEL`.
    delete process.env.OPENROUTER_MODEL;
    process.env.LLM_MODEL = "essai/modele-b";
    reinitialiserEnv();
    expect(resolveModel()).toBe("essai/modele-b");
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
    expect(passerelle).toContain(repli);
    for (const route of ROUTES) {
      expect(readFileSync(join(process.cwd(), route), "utf8")).not.toContain(repli);
    }
  });
});
