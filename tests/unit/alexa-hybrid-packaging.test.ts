import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CHEMINS_RECETTE_SECONDAIRE } from "@/server/knowledge/vecteur-secondaire-production";

const root = process.cwd();

it("ships every approved vector recipe, so the flag doesn't silently leave Alexa lexical-only", () => {
  const packaging = readFileSync(join(root, "scripts", "preparer-paquet.mjs"), "utf8");
  for (const recipe of Object.values(CHEMINS_RECETTE_SECONDAIRE)) {
    expect(existsSync(join(root, ...recipe))).toBe(true);
    expect(packaging).toContain(recipe.at(-1)!);
  }
});

it("allows the vector flags in the packaged server configuration", () => {
  const server = readFileSync(join(root, "electron", "main", "serveur-cabinet.ts"), "utf8");
  expect(server).toContain('"KNOWLEDGE_VECTOR"');
  expect(server).toContain('"KNOWLEDGE_VECTOR_RECETTE"');
});
