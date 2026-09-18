/**
 * OBSERVABILITE M09 — inspection en lecture seule (owner vs assistante).
 *
 * Ce que ces tests verrouillent :
 * - O1 owner : les trois sections se rendent, les portes d'observabilité
 *   sont interrogées, et AUCUN appel /api/jarvis/ ne part (l'observabilité
 *   lit des portes, jamais le modèle).
 * - O2 assistante : erreur d'accès, panneaux jamais montés, ZÉRO appel aux
 *   cinq portes (get/live/history x2, listes x2, stats). Le rail est
 *   cosmétique (Rail.tsx) : c'est l'absence d'appels qui prouve la cloison.
 * - O3 : le détail d'un run s'ouvre quand des runs existent, sinon l'état
 *   vide honnête se rend — les deux branches assertent, jamais de vert muet.
 * - O4 : aucun contrôle hors cadre à 1440×900 (leçon V9 `aucun-controle-
 *   hors-cadre` : `toBeVisible()` ne voit pas le débordement, on MESURE).
 * - O5 : profil illisible → l'écran DIT la panne (patron role-resolution
 *   R7-R9), jamais de rôle supposé.
 *
 * Comptes : même convention que role-resolution.spec.ts (env avec repli
 * commis, aucun secret nouveau). Pas de login praticienne : aucun
 * précédent E2E pour a2, et la branche est la même que owner
 * (`role !== "assistant"`) — NOT RUN documenté, pas un trou silencieux.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";
const ASSISTANT_EMAIL = "assistante.dev@invalid.local";
const ASSISTANT_PW =
  process.env.ASSISTANT_ACCOUNT_PASSWORD ?? "VqTGuYVbmxNAsMY34ScmQ2M93lG2SBzj";

const PORTES_OBSERVABILITE = [
  "get_live_history",
  "get_replay_history",
  "get_observability_stats",
  "list_live_runs",
  "list_replay_runs",
];

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(email);
  await page.getByLabel(/Mot de passe/i).fill(password);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

function rpcNames(page: Page): string[] {
  const names: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/db/rpc")) return;
    try {
      const data = r.postDataJSON() as { name?: string } | null;
      if (data?.name) names.push(data.name);
    } catch {
      /* corps non JSON — ignore */
    }
  });
  return names;
}

function jarvisCalls(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/jarvis/")) urls.push(r.url());
  });
  return urls;
}

/** 503 sur la seule lecture de `profiles` (patron role-resolution R7). */
async function casserLectureProfil(page: Page): Promise<void> {
  await page.route("**/api/db/select", async (route) => {
    let relation: string | undefined;
    try {
      relation = (route.request().postDataJSON() as { relation?: string } | null)?.relation;
    } catch {
      relation = undefined;
    }
    if (relation !== "profiles") return route.continue();
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, code: "indisponible" }),
    });
  });
}

test.describe("OBSERVABILITE — owner lit, rien n'appelle Jarvis", () => {
  test("O1 owner : trois sections, portes lues, zéro appel Jarvis", async ({ page }) => {
    const rpc = rpcNames(page);
    const jarvis = jarvisCalls(page);
    await login(page, OWNER_EMAIL, OWNER_PW);
    rpc.length = 0;

    await page.goto("/observabilite");
    await expect(page.getByRole("heading", { name: /Observabilité/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: /Activité et durées/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Runs live récents/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Runs replay récents/i })).toBeVisible();

    // Les trois listes/stats partent au montage, sans exception.
    await expect
      .poll(() => rpc.filter((n) => PORTES_OBSERVABILITE.includes(n)).length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);
    // Et rien ne part vers le modèle : l'observabilité lit des portes.
    await page.waitForTimeout(1500);
    expect(jarvis).toEqual([]);
  });

  test("O3 owner : détail d'un run ou vide honnête (les deux assertent)", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);
    await page.goto("/observabilite");
    await expect(page.getByRole("heading", { name: /Runs live récents/i })).toBeVisible({
      timeout: 15_000,
    });

    const details = page.getByRole("button", { name: /Voir le détail/i });
    if ((await details.count()) > 0) {
      await details.first().click();
      await expect(page.getByRole("button", { name: /Masquer le détail/i }).first()).toBeVisible();
    } else {
      // Aucun run : les vides honnêtes se rendent, pas un blanc muet.
      await expect(page.locator("body")).toContainText(/Aucun run (live|replay) ingéré|aucun run enregistré/i);
    }
  });

  test("O4 owner : aucun contrôle hors cadre à 1440×900", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, OWNER_EMAIL, OWNER_PW);
    await page.goto("/observabilite");
    await expect(page.getByRole("heading", { name: /Observabilité/i })).toBeVisible({
      timeout: 15_000,
    });
    const debord = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(debord).toBeLessThanOrEqual(0);
  });

  test("O5 owner : profil illisible → l'écran DIT la panne", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);
    await casserLectureProfil(page);
    await page.goto("/observabilite");
    const erreur = page.getByRole("alert").filter({ hasText: /session a expiré|Reconnectez/i });
    await expect(erreur.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Réessayer/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Runs live récents/i })).toHaveCount(0);
  });
});

test.describe("OBSERVABILITE — assistante : erreur, zéro porte", () => {
  test("O2 assistante : accès refusé, panneaux jamais montés, zéro appel", async ({ page }) => {
    const rpc = rpcNames(page);
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);
    rpc.length = 0;

    await page.goto("/observabilite");
    await expect(page.locator("body")).toContainText(/réservé aux praticiennes/i, {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: /Runs live récents/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Activité et durées/i })).toHaveCount(0);

    await page.waitForTimeout(1500);
    expect(rpc.filter((n) => PORTES_OBSERVABILITE.includes(n))).toEqual([]);
  });
});
