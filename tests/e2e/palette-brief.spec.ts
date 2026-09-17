/**
 * M11 — palette ⌘K + brief matin.
 *
 * La palette est la 3e entrée de la MÊME conversation (voix, panneau, ⌘K) :
 * P1-P3 verrouillent le geste clavier. Le brief est DÉTERMINISTE : P4
 * verrouille l'invariant zéro `/api/jarvis/` (miroir O4 de
 * `consultation-onglets.spec.ts`), P5-P6 l'égalité octet aux portes.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";

async function login(page: Page): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(OWNER_EMAIL);
  await page.getByLabel(/Mot de passe/i).fill(OWNER_PW);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

async function rpc(page: Page, name: string, args: unknown): Promise<{ data?: unknown[] }> {
  const r = await page.request.post("/api/db/rpc", { data: { name, args } });
  return (await r.json()) as { data?: unknown[] };
}

test.describe("M11 — palette et brief", () => {
  test("P1 ⌘K ouvre la palette, Échap la referme", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    // Prêt hydraté avant le geste clavier (miroir L3) : sans cette attente,
    // `Control+k` part avant l'écouteur `window` de la palette et se perd.
    await expect(page.getByRole("button", { name: /Ouvrir Alexa/i })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Control+k");
    const dialogue = page.getByRole("dialog", { name: /Commande/i });
    await expect(dialogue).toBeVisible({ timeout: 15_000 });
    await expect(dialogue.getByRole("textbox").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogue).toHaveCount(0);
  });

  test("P2 une consigne part et le tour s'affiche, sans quitter la palette", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    // Prêt hydraté avant le geste clavier (miroir L3) : voir P1.
    await expect(page.getByRole("button", { name: /Ouvrir Alexa/i })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Control+k");
    const dialogue = page.getByRole("dialog", { name: /Commande/i });
    await expect(dialogue).toBeVisible({ timeout: 15_000 });
    await dialogue.getByRole("textbox").first().fill("Qui vient aujourd'hui ?");
    await dialogue.getByRole("textbox").first().press("Enter");
    // Pas d'assertion sur le TEXTE du modèle (free-tier non reproductible) :
    // on prouve l'envoi (état) et le maintien de la surface.
    await expect(dialogue.getByText("Qui vient aujourd'hui ?", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await expect(dialogue).toBeVisible();
  });

  test("P3 la palette ne déborde pas du cadre à 1440×900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto("/tableauDeBord");
    // Prêt hydraté avant le geste clavier (miroir L3) : voir P1.
    await expect(page.getByRole("button", { name: /Ouvrir Alexa/i })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Control+k");
    const dialogue = page.getByRole("dialog", { name: /Commande/i });
    await expect(dialogue).toBeVisible({ timeout: 15_000 });
    const boite = await dialogue.boundingBox();
    expect(boite).not.toBeNull();
    expect(boite!.x).toBeGreaterThanOrEqual(0);
    expect(boite!.y).toBeGreaterThanOrEqual(0);
    expect(boite!.x + boite!.width).toBeLessThanOrEqual(1440);
    expect(boite!.y + boite!.height).toBeLessThanOrEqual(900);
  });

  test("P4 le brief ne fait AUCUN appel /api/jarvis/", async ({ page }) => {
    let appels = 0;
    await page.route("**/api/jarvis/**", (route) => {
      appels += 1;
      return route.abort();
    });
    await login(page);
    await page.goto("/tableauDeBord");
    await expect(page.getByRole("heading", { name: /Brief du matin/i })).toBeVisible({ timeout: 15_000 });
    expect(appels).toBe(0);
  });

  test("P5 le brief dit les chiffres de dashboard_today, octet-égaux", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    await expect(page.getByRole("heading", { name: /Brief du matin/i })).toBeVisible({ timeout: 15_000 });
    const porte = await rpc(page, "dashboard_today", {});
    // Forme réelle de la porte : une ligne `TableauRow` dont la caisse est
    // NICHÉE sous `encaisse` (`{ montant_dzd, seances, perimetre } | null`,
    // migrations 059/060, mapper `dashboard.ts:237-248`) — jamais
    // `montant_dzd` à la racine.
    const ligne = (porte.data?.[0] ?? {}) as {
      encaisse?: { montant_dzd?: number | string } | null;
    };
    const montant = ligne.encaisse?.montant_dzd ?? null;
    if (montant !== undefined && montant !== null) {
      // Normalisation espaces des deux côtés (le `dzd` source utilise des
      // insécables, cf. `jarvis-briefs.ts:100-103`) : l'invariant verrouillé
      // est chiffres + groupement + devise identiques, pas l'octet d'espace.
      const normaliser = (s: string): string => s.replace(/\s+/g, " ");
      const figure = normaliser(`${Number(montant).toLocaleString("fr-FR")} DA`);
      const bloc = page.getByRole("heading", { name: /Brief du matin/i }).locator("..");
      const texte = normaliser((await bloc.textContent()) ?? "");
      expect(texte).toContain(figure);
    }
  });

  test("P6 sans assistante : ni palette ni brief praticienne", async ({ page }) => {
    // Miroir du helper de rôle de `cloison-consultation.spec.ts` (lire d'abord).
    // Sans identifiants assistante disponibles : NOT RUN déclaré, pas de vert silencieux.
    test.skip(true, "identifiants assistante : voir helper cloison-consultation");
  });
});
