/**
 * LES JETONS DES FAMILLES DE GRAPHES — définis, ET distincts.
 *
 * POURQUOI CE FICHIER EXISTE. Deux défauts réels, trouvés à l'écran :
 *
 * 1 · `--ambre-600`, `--ambre-400`, `--corail-600`, `--corail-400` étaient
 *     RÉFÉRENCÉS par `tailwind.config.ts` et par `Graphes.tsx`, mais n'étaient
 *     définis NULLE PART. Une variable CSS absente ne colore rien : la série
 *     « Charges » de l'écran Finances sortait sans couleur, pastille de légende
 *     comprise. Rien ne le signalait — ni la compilation, ni le lint, ni un
 *     test : une couleur manquante est silencieuse.
 *
 * 2 · Les six familles retombaient sur `--chart-1..5`, un dégradé d'une SEULE
 *     teinte. `emeraude` et `azure` valaient le même bleu. Six noms, une
 *     couleur : un anneau à quatre parts ne se relisait plus dans sa légende.
 *
 * Ce test lit `tokens.css` — la SEULE source de vérité des couleurs (CLAUDE.md
 * §3) — plutôt que le rendu, pour échouer à la compilation plutôt qu'à l'œil.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FAMILLES } from "@/components/ui/Graphes";

const CSS = readFileSync(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");

/**
 * La DERNIÈRE définition gagne, comme dans la cascade CSS : les surcharges V9
 * sont posées après les rampes V8, et c'est ce que le navigateur applique.
 */
function jeton(nom: string): string | null {
  const trouvees = [...CSS.matchAll(new RegExp(`--${nom}\\s*:\\s*([^;]+);`, "g"))];
  const derniere = trouvees.at(-1);
  return derniere === undefined ? null : (derniere[1] ?? "").trim();
}

/** Suit les alias `var(--x)` jusqu'à une couleur littérale. */
function resoudre(nom: string, profondeur = 0): string | null {
  const brut = jeton(nom);
  if (brut === null || profondeur > 8) return brut;
  const alias = /^var\(\s*--([\w-]+)\s*\)$/.exec(brut);
  return alias === null ? brut : resoudre(alias[1]!, profondeur + 1);
}

describe("jetons des familles de graphes", () => {
  for (const famille of FAMILLES) {
    it(`${famille} : le trait (600) et le remplissage (400) EXISTENT`, () => {
      // C'est le défaut n°1 : référencé partout, défini nulle part.
      expect(resoudre(`${famille}-600`), `--${famille}-600 introuvable`).not.toBeNull();
      expect(resoudre(`${famille}-400`), `--${famille}-400 introuvable`).not.toBeNull();
    });
  }

  it("les six familles ne se confondent pas deux à deux", () => {
    // C'est le défaut n°2 : `emeraude` et `azure` valaient tous deux --chart-2.
    const traits = FAMILLES.map((f) => resoudre(`${f}-600`));
    const distinctes = new Set(traits);
    expect(
      distinctes.size,
      `six familles pour ${distinctes.size} couleur(s) : ${JSON.stringify(traits)}`,
    ).toBe(FAMILLES.length);
  });

  it("les teintes diffèrent vraiment — pas seulement la clarté", () => {
    /*
      Une rampe monochrome (même teinte, clartés différentes) ne se relit pas
      dans une légende : c'est ce que faisait `--chart-1..5`, toutes entre 252
      et 266. On exige donc des TEINTES écartées, ce qui sert autant la lecture
      que l'accessibilité — une différence de clarté seule ne survit ni à une
      impression en noir et blanc, ni à un écran mal réglé.
    */
    const teintes = FAMILLES.map((f) => {
      const v = resoudre(`${f}-600`) ?? "";
      const m = /oklch\(\s*[\d.]+\s+[\d.]+\s+([\d.]+)/.exec(v);
      return m === null ? null : Number(m[1]);
    }).filter((t): t is number => t !== null);

    expect(teintes.length, "toutes les familles doivent être en oklch").toBe(FAMILLES.length);

    const triees = [...teintes].sort((a, b) => a - b);
    expect(
      triees[triees.length - 1]! - triees[0]!,
      `étendue de teinte trop faible : ${JSON.stringify(triees)}`,
    ).toBeGreaterThan(120);
  });
});
