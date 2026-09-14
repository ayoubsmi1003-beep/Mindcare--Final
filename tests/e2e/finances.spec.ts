/**
 * SCREEN 8 — /finances
 * Caisse vue: pulse, calendrier, evolution, composition, attention — 1 call per onglet
 */
import { test, expect } from "@playwright/test";

const CONNEXION = "/connexion";
async function login(page: import("@playwright/test").Page) {
  await page.goto(CONNEXION);
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
}

test.describe("SCREEN 8 — /finances", () => {
  test("F8.1 finances loads overview with 1 RPC", async ({ page }) => {
    const rpcs: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/db/rpc")) {
        try { const j = JSON.parse(r.postData()||"{}") as {name?:string}; if(j.name) rpcs.push(j.name)} catch {}
      }
    });
    await login(page);
    await page.goto("/finances");
    await expect(page.locator("body")).toContainText(/Finances|encaissé|Vue d'ensemble|Recette/i, { timeout: 15_000 });
    // At least one overview call
    const overview = rpcs.filter(n=>n==="get_finance_overview");
    expect(overview.length).toBeGreaterThanOrEqual(1);
    expect(overview.length).toBeLessThanOrEqual(1);
  });

  test("F8.2 onglets charges and seances load on demand", async ({ page }) => {
    await login(page);
    await page.goto("/finances");
    await expect(page.locator("body")).toContainText(/Finances/i, { timeout: 10_000 });
    // Click Charges
    const chargesTab = page.getByRole("tab", { name: /Charges/i }).or(page.getByRole("button", { name: /Charges/i }));
    if (await chargesTab.count() > 0) {
      await chargesTab.first().click();
      await expect(page.locator("body")).toContainText(/Charges|Intitulé|Montant/i, { timeout: 10_000 });
    }
    // Click Seances
    const seancesTab = page.getByRole("tab", { name: /Séances/i }).or(page.getByRole("button", { name: /Séances/i }));
    if (await seancesTab.count() > 0) {
      await seancesTab.first().click();
      await expect(page.locator("body")).toContainText(/Séances|Patient|Montant|Reçu/i, { timeout: 10_000 });
    }
  });

  test("F8.3 refresh preserves", async ({ page }) => {
    await login(page);
    await page.goto("/finances");
    await expect(page.locator("body")).toContainText(/Finances/i, { timeout: 10_000 });
    await page.reload();
    await expect(page).toHaveURL(/\/finances/);
    await expect(page.locator("body")).toContainText(/Finances/i, { timeout: 10_000 });
  });

  test("F8.4 offline not crash", async ({ page }) => {
    await login(page);
    await page.route("**/api/db/rpc", (route) => {
      try {
        const j = JSON.parse(route.request().postData()||"{}") as {name?:string};
        if (j.name==="get_finance_overview") return route.abort();
      } catch {}
      return route.continue();
    });
    await page.goto("/finances");
    await expect(page.locator("body")).toContainText(/Finances|Hors ligne|indisponible/i, { timeout: 10_000 });
    await page.unroute("**/api/db/rpc");
  });
});
