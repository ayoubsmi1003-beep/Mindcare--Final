/**
 * `jarvis-egress-frontiere-source.test.ts` - M05, gardes de source.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * Precedent etabli par `jarvis-intentions-route.test.ts` : certaines proprietes
 * de frontiere s'eprouvent par lecture de source. Ici : point de sortie
 * unique, aucune cle cote client, aucun MCP actif, journal ferme, aucun
 * `console.*` avec charge dans la zone d'egress ni les routes Jarvis.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RACINE = process.cwd();

function listerTs(dossier: string, acc: string[] = []): string[] {
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    const st = statSync(chemin);
    if (st.isDirectory()) {
      if (entree !== "node_modules" && entree !== ".next") listerTs(chemin, acc);
    } else if (entree.endsWith(".ts") || entree.endsWith(".tsx")) {
      acc.push(chemin);
    }
  }
  return acc;
}

const FICHIERS_SRC = listerTs(join(RACINE, "src"));

function lire(relatif: string): string {
  return readFileSync(join(RACINE, relatif), "utf8");
}

function normaliser(chemin: string): string {
  return chemin.replace(/\\/g, "/");
}

describe("M05 source - point de sortie unique", () => {
  it("aucun fetch https hors external-call.ts", () => {
    const fautifs = FICHIERS_SRC.filter((f) => {
      if (normaliser(f).endsWith("src/server/egress/external-call.ts")) return false;
      const contenu = readFileSync(f, "utf8");
      return /fetch\s*\(\s*["']https:\/\//.test(contenu);
    });
    expect(fautifs).toEqual([]);
  });

  it("aucun SDK ni client http externe direct dans src/", () => {
    const fautifs = FICHIERS_SRC.filter((f) => {
      const contenu = readFileSync(f, "utf8");
      return /from\s+["']openai["']|from\s+["']@google\/generative-ai["']|require\s*\(\s*["']axios["']\s*\)|from\s+["']axios["']/.test(
        contenu,
      );
    });
    expect(fautifs).toEqual([]);
  });
});

describe("M05 source - secrets jamais cote client", () => {
  it("aucun NEXT_PUBLIC_* dans src/server ni les routes api", () => {
    const zone = FICHIERS_SRC.filter(
      (f) => f.includes("src/server") || f.includes("src/app/api"),
    );
    const fautifs = zone.filter((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_"));
    expect(fautifs).toEqual([]);
  });

  it("les cles fournisseurs ne sont lues que dans env et external-call", () => {
    const lecteurs = FICHIERS_SRC.filter((f) =>
      /OPENROUTER_API_KEY|GROQ_API_KEY|ELEVENLABS_API_KEY/.test(readFileSync(f, "utf8")),
    ).map((f) => normaliser(f).split("src/").pop() ?? normaliser(f));
    expect(lecteurs.length).toBeGreaterThan(0);
    for (const l of lecteurs) {
      expect(
        l === "server/env.ts" || l === "server/egress/external-call.ts",
      ).toBe(true);
    }
  });
});

describe("M05 source - aucun MCP actif", () => {
  it("aucun import ni protocole MCP dans src/", () => {
    const fautifs = FICHIERS_SRC.filter((f) => {
      const contenu = readFileSync(f, "utf8");
      return /from\s+["'][^"']*mcp[^"']*["']|ModelContextProtocol|mcp-server/i.test(contenu);
    });
    expect(fautifs).toEqual([]);
  });
});

describe("M05 source - journal ferme", () => {
  it("LogFields ne porte que des comptes et des codes", () => {
    const contenu = lire("src/services/log.ts");
    const debut = contenu.indexOf("export interface LogFields");
    const fin = contenu.indexOf("}", contenu.indexOf("causeName"));
    const corps = contenu.slice(debut, fin);
    expect(corps).not.toMatch(/readonly\s+(message|nom|contenu|texte|payload|patient)\b/);
  });

  it("aucun console.* dans la zone egress ni les routes jarvis", () => {
    const zone = FICHIERS_SRC.filter(
      (f) => f.includes("src/server/egress") || f.includes("src/app/api/jarvis"),
    );
    const fautifs = zone.filter((f) => /console\.(log|info|warn|error|debug)\s*\(/.test(readFileSync(f, "utf8")));
    expect(fautifs).toEqual([]);
  });
});

describe("M05 source - la classification est la seule arbitre", () => {
  it("external-call applique la classification avant chaque appel texte", () => {
    const contenu = lire("src/server/egress/external-call.ts");
    expect(contenu).toContain("classerCharge");
    expect(contenu).toContain("frontiere");
  });

  it("la route pre-filtre le message libre avant le modele", () => {
    const contenu = lire("src/app/api/jarvis/jarvis-chat/route.ts");
    expect(contenu).toContain("messagePorteUnSignalPatient");
  });

  it("le classifieur NLU ecarte les motifs tel/mail avant tout transport", () => {
    const contenu = lire("src/server/jarvis/classifieur-intentions.ts");
    expect(contenu).toContain("porteUnMotifInterdit");
  });
});
