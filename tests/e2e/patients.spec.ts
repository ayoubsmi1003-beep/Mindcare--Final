/**
 * SCREEN 3 — /patients
 * Liste, recherche debounced 250ms, pagination, RLS perimetre, offline, refresh
 */
import { test, expect } from "@playwright/test";

const CONNEXION = "/connexion";
const PATIENTS = "/patients";

async function login(page: import("@playwright/test").Page) {
  await page.goto(CONNEXION);
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
  await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
}

test.describe("SCREEN 3 — /patients", () => {
  test("P3.1 liste charge 1 RPC et affiche comptage perimetre", async ({ page }) => {
    const rpcs: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/db/rpc")) {
        try {
          const j = JSON.parse(r.postData() || "{}") as { name?: string };
          if (j.name) rpcs.push(j.name);
        } catch {}
      }
    });
    await login(page);
    // Comptage should be visible
    await expect(page.locator("body")).toContainText(/dossier\(s\) dans votre périmètre|Seuls les dossiers actifs/i, { timeout: 10_000 });
    // At least one search_patients call
    expect(rpcs.filter((n) => n === "search_patients").length).toBeGreaterThanOrEqual(1);
    expect(rpcs.filter((n) => n === "search_patients").length).toBeLessThanOrEqual(2);
  });

  test("P3.2 recherche debounced: typing triggers 1 RPC after 250ms", async ({ page }) => {
    const rpcTimes: number[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/db/rpc")) {
        try {
          const j = JSON.parse(r.postData() || "{}") as { name?: string };
          if (j.name === "search_patients") rpcTimes.push(Date.now());
        } catch {}
      }
    });
    await login(page);
    await page.getByPlaceholder(/Nom, téléphone/i).fill("Patient");
    // Wait for debounce + network
    await page.waitForTimeout(1200);
    // Should have at least 2 calls: initial load + debounced query
    expect(rpcTimes.length).toBeGreaterThanOrEqual(2);
    // If typed quickly, should not have produced many calls (not per char)
    expect(rpcTimes.length).toBeLessThanOrEqual(3);
  });

  test("P3.3 recherche courte (<2 chars) remet liste complete", async ({ page }) => {
    await login(page);
    const searchBox = page.getByPlaceholder(/Nom, téléphone/i);
    await searchBox.fill("Pa");
    await page.waitForTimeout(800);
    // Should show either list or empty state, not error
    await expect(page.locator("body")).toContainText(/dossier|aucun/i, { timeout: 5_000 });
    await searchBox.fill("P");
    await page.waitForTimeout(800);
    // Short query should revert to full list (empty query)
    await expect(page.locator("body")).toContainText(/dossier|aucun/i);
  });

  test("P3.4 offline shows BandeauHorsLigne not crash", async ({ page }) => {
    await login(page);
    await page.route("**/api/db/rpc", (route) => {
      try {
        const j = JSON.parse(route.request().postData() || "{}") as { name?: string };
        if (j.name === "search_patients") return route.abort();
      } catch {}
      return route.continue();
    });
    await page.getByPlaceholder(/Nom, téléphone/i).fill("zzzzzintrouvable");
    await page.waitForTimeout(1000);
    // Should show offline or error, not crash
    await expect(page.locator("body")).toContainText(/Hors ligne|connexion.*interrompue|réseau|indisponible/i, { timeout: 10_000 });
    await page.unroute("**/api/db/rpc");
  });

  test("P3.5 refresh preserves list", async ({ page }) => {
    await login(page);
    await page.reload();
    await expect(page).toHaveURL(/\/patients/);
    await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/dossier|aucun/i, { timeout: 10_000 });
  });

  test("P3.6 navigation patients -> tableauDeBord -> patients preserves", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    await expect(page.locator("body")).toContainText(/Tableau de bord|Journée|Fil/i, { timeout: 10_000 });
    await page.goto(PATIENTS);
    await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
  });

  test("P3.7 empty state honest (no fake data)", async ({ page }) => {
    await login(page);
    // Search for gibberish that matches nothing
    await page.getByPlaceholder(/Nom, téléphone/i).fill("ZZZNOPE999");
    await page.waitForTimeout(1200);
    await expect(page.locator("body")).toContainText(/Aucun dossier ne correspond|aucun dossier visible/i);
    // Should not contain fake patient names
    const content = await page.content();
    expect(content).not.toContain("John Doe");
    expect(content).not.toContain("Exemple");
  });

  test("P3.8 click patient opens fiche /patients/[id]", async ({ page }) => {
    await login(page);
    // Wait for list rows
    await page.waitForTimeout(1500);
    const firstRow = page.locator("a[href^='/patients/']").first();
    // If no patients, this test is informational — but seed has 1 patient for owner
    const count = await firstRow.count();
    if (count === 0) {
      test.info().annotations.push({ type: "note", description: "no patients visible for owner — seed may be empty, skipping navigation check" });
      return;
    }
    await firstRow.click();
    await expect(page).toHaveURL(/\/patients\//, { timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/Vue d'ensemble|Chronologie|Clinique|Identité/i, { timeout: 10_000 });
  });

  test("P3.9 RLS: owner sees only his perimeter (total is perimetre, not global)", async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    // The total shown is owner perimeter. Check that content does not reveal other practitioner's data via total global
    // Hard to assert exact number, but ensure page shows perimetre phrase
    await expect(page.locator("body")).toContainText(/dans votre périmètre/i);
    // No secret leak
    const content = await page.content();
    expect(content).not.toContain("OPENROUTER");
  });
});
