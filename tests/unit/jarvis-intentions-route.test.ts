/**
 * `route.ts` — LE CABLAGE M01 RESTE SOUS LA FRONTIERE.
 *
 * ═══ CE QUE CE FICHIER ÉPROUVE (lecture de source, comme ses voisins) ═══
 * Le classifieur n'est jamais appelé sur la frontière (amendement 2026-09-24 :
 * commit, ex-refus) ; la proposition hors famille est bloquée serveur ; le
 * payload ne porte que le NOM de l'intention et le run_id (jamais la
 * mention) ; aucun second `fetch` ; passerelle unique.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/app/api/jarvis/jarvis-chat/route.ts"),
  "utf8",
);

describe("le classifieur vit derrière la frontière", () => {
  it("rendu tôt sur la frontière, sans classifier", () => {
    expect(source).toContain('if (chemin === "commit" || !classifieurActif())');
  });

  it("l'appel modèle du classifieur est défini après les branches de frontière", () => {
    // Même propriété que `jarvis-routage-multilingue.test.ts`, pour le second
    // appel modèle du fichier : la frontière ne déclenche aucun `llm(`.
    const frontiere = source.indexOf('routage.chemin === "commit"');
    const appelClassifieur = source.indexOf("async function appelerModeleClassifieur(");
    expect(frontiere).toBeGreaterThan(-1);
    expect(appelClassifieur).toBeGreaterThan(frontiere);
  });

  it("coupe-circuit d'exploitation présent", () => {
    expect(source).toContain('process.env.INTENT_CLASSIFIER_ENABLED !== "false"');
  });
});

describe("compatibilité vérifiée serveur", () => {
  it("proposition hors famille = texte, zéro exécution", () => {
    expect(source).toContain("estPropositionCompatible(intention.intent.name, proposition.nom)");
  });

  it("le payload ne porte que le nom et le run_id, jamais la mention", () => {
    expect(source).toContain("intent: classification.intent.name");
    expect(source).toContain("intent: intention.intent.name");
    expect(source).not.toMatch(/intent:\s*intention\.intent\b[^.]/);
  });
});

describe("passerelle unique conservée", () => {
  it("aucun fetch hors external-call, sessionToken = run_id", () => {
    expect(source).not.toMatch(/(?<!external-call\.\w*\s|["'`.\w])fetch\s*\(/);
    expect(source).toContain("sessionToken: runId");
    expect(source).toContain('promptVersion: INTENT_PROMPT_VERSION');
  });
});
