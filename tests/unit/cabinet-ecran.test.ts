import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { htmlEcranCabinet } from "../../electron/main/ecran-cabinet";

const messages = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "src", "i18n", "cabinet-desktop.fr.json"), "utf8"),
) as Record<string, string>;

const html = htmlEcranCabinet(messages, "nonce-de-test", "CABINET-PC");

/**
 * L'écran d'appairage est du HTML construit à la main : une faute de frappe dans
 * un identifiant ne casse pas la compilation, elle produit un bouton qui ne
 * répond pas — c'est-à-dire, du point de vue de la praticienne, l'écran gelé
 * qu'on vient de corriger.
 */
describe("écran d'appairage — structure", () => {
  it("autorise ses propres styles, sinon la page s'affiche en texte brut", () => {
    // Défaut d'origine : `default-src 'none'` sans `style-src` bloquait la
    // feuille de style entière. L'écran paraissait cassé avant même d'être lu.
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("style-src 'nonce-nonce-de-test'");
    expect(html).toContain("script-src 'nonce-nonce-de-test'");
  });

  it("n'utilise aucun attribut style inline (bloqué par la CSP)", () => {
    expect(html).not.toMatch(/\sstyle="/i);
  });

  it("rend tous les éléments que son script manipule", () => {
    const idsScript = [...html.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]!);
    const idsHtml = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]!));
    expect(idsScript.length).toBeGreaterThan(8);
    for (const id of new Set(idsScript)) {
      expect(idsHtml.has(id), `id manquant : ${id}`).toBe(true);
    }
  });

  it("affiche les quatre zones avec leur état initial", () => {
    // L'hôte et l'invitation sont masqués au départ ; la connexion manuelle et
    // la relance sont visibles : l'écran n'est jamais sans issue.
    expect(html).toMatch(/id="premier"[^>]*hidden/);
    expect(html).toMatch(/id="invitation"[^>]*hidden/);
    expect(html).not.toMatch(/id="manuelle"[^>]*hidden/);
    expect(html).not.toMatch(/id="retry"[^>]*hidden/);
  });

  it("remplace tous les marqueurs et n'affiche jamais undefined", () => {
    expect(html).not.toContain("{nom}");
    expect(html).not.toContain("{n}");
    expect(html).not.toContain("undefined");
    expect(html).toContain("CABINET-PC");
  });

  it("échappe le nom du poste dans le document", () => {
    const piege = htmlEcranCabinet(messages, "n", '<script>alert(1)</script>');
    expect(piege).not.toContain("<script>alert(1)</script>");
    expect(piege).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("n'injecte aucun texte clinique ni secret", () => {
    // Garde-fou grossier mais utile : cet écran précède toute session.
    expect(html.toLowerCase()).not.toContain("mot de passe");
    expect(html).not.toMatch(/postgresql:\/\//i);
  });
});
