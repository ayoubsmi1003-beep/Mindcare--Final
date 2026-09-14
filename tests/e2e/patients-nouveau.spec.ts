/**
 * SCREEN 4 — /patients/nouveau
 * Creation, validation, duplicate detection, persistence, refresh
 */
import { test, expect } from "@playwright/test";

const CONNEXION = "/connexion";
const NOUVEAU = "/patients/nouveau";

async function login(page: import("@playwright/test").Page) {
  await page.goto(CONNEXION);
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
}

function uniquePhone(): string {
  const rand = Math.floor(10000000 + Math.random() * 90000000);
  return `0555${rand}`;
}

test.describe("SCREEN 4 — /patients/nouveau", () => {
  test("N4.1 form renders obligatoires + complementaires", async ({ page }) => {
    await login(page);
    await page.goto(NOUVEAU);
    await expect(page.getByRole("heading", { name: /Nouveau dossier/i })).toBeVisible();
    await expect(page.getByLabel("Prénom", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Nom", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Téléphone", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Créer le dossier/i })).toBeVisible();
  });

  test("N4.2 validation: empty submit shows champRequis", async ({ page }) => {
    await login(page);
    await page.goto(NOUVEAU);
    await page.getByRole("button", { name: /Créer le dossier/i }).click();
    await expect(page.locator("body")).toContainText(/Ce champ est obligatoire|champ.*obligatoire/i);
  });

  test("N4.3 phone format validation", async ({ page }) => {
    await login(page);
    await page.goto(NOUVEAU);
    await page.getByLabel("Prénom", { exact: true }).fill("TestN");
    await page.getByLabel("Nom", { exact: true }).fill("TestN");
    await page.getByLabel("Téléphone", { exact: true }).fill("abc"); // invalid
    await page.getByRole("button", { name: /Créer le dossier/i }).click();
    await expect(page.locator("body")).toContainText(/Ce numéro n'est pas enregistrable|8 à 20/i);
  });

  test("N4.4 successful creation, redirect to fiche, persistence after refresh and nav", async ({ page }) => {
    await login(page);
    await page.goto(NOUVEAU);
    const phone = uniquePhone();
    const prenom = `Pat${Math.floor(Math.random() * 9000)}`;
    const nom = `Test${Math.floor(Math.random() * 9000)}`;
    await page.getByLabel("Prénom", { exact: true }).fill(prenom);
    await page.getByLabel("Nom", { exact: true }).fill(nom);
    await page.getByLabel("Téléphone", { exact: true }).fill(phone);
    await page.getByRole("button", { name: /Créer le dossier/i }).click();
    // Should redirect to /patients/[id]
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/i, { timeout: 15_000 });
    await expect(page.locator("body")).toContainText(new RegExp(nom, "i"));
    // Refresh preserves
    await page.reload();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/i);
    await expect(page.locator("body")).toContainText(new RegExp(nom, "i"));
    // Nav away and back via URL
    const url = page.url();
    await page.goto("/patients");
    await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
    await page.goto(url);
    await expect(page.locator("body")).toContainText(new RegExp(nom, "i"), { timeout: 10_000 });
  });

  test("N4.5 duplicate detection: similar patient shows panneau, requires malgreTout", async ({ page }) => {
    await login(page);
    // First create a patient
    await page.goto(NOUVEAU);
    const phone = uniquePhone();
    const prenom = `Dup${Math.floor(Math.random() * 9000)}`;
    const nom = `Check${Math.floor(Math.random() * 9000)}`;
    await page.getByLabel("Prénom", { exact: true }).fill(prenom);
    await page.getByLabel("Nom", { exact: true }).fill(nom);
    await page.getByLabel("Téléphone", { exact: true }).fill(phone);
    await page.getByRole("button", { name: /Créer le dossier/i }).click();
    await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/i, { timeout: 15_000 });
    // Now try to create duplicate with same phone+nom+prenom
    await page.goto(NOUVEAU);
    await page.getByLabel("Prénom", { exact: true }).fill(prenom);
    await page.getByLabel("Nom", { exact: true }).fill(nom);
    await page.getByLabel("Téléphone", { exact: true }).fill(phone);
    // Wait for debounced similar search (300ms + network)
    await page.waitForTimeout(1200);
    // Should show similar panel
    await expect(page.locator("body")).toContainText(/Patients similaires|Ce dossier semble correspondre/i, { timeout: 10_000 });
    // Creation should be blocked until malgreTout checked
    const btn = page.getByRole("button", { name: /Créer le dossier/i });
    await expect(btn).toBeDisabled();
    await page.getByLabel(/Créer malgré tout/i).check();
    await expect(btn).toBeEnabled();
    // After checking, creation either succeeds (new dossier) or is refused by DB 23505 — both prove gating worked
    await btn.click();
    await page.waitForTimeout(2000);
    const afterUrl = page.url();
    const body = await page.locator("body").innerText();
    const succeeded = afterUrl.includes("/patients/") && afterUrl !== NOUVEAU;
    const refused = /existe déjà|doublon|conflit/i.test(body);
    expect(succeeded || refused, `expected either redirect to fiche or duplicate error, got url=${afterUrl} body snippet=${body.slice(0,200)}`).toBeTruthy();
  });

  test("N4.6 offline: creation fails gracefully", async ({ page }) => {
    await login(page);
    await page.goto(NOUVEAU);
    await page.route("**/api/db/rpc", (route) => {
      try {
        const j = JSON.parse(route.request().postData() || "{}") as { name?: string };
        if (j.name === "create_patient" || j.name === "find_similar_patients") return route.abort();
      } catch {}
      return route.continue();
    });
    await page.getByLabel("Prénom", { exact: true }).fill("Off");
    await page.getByLabel("Nom", { exact: true }).fill("Line");
    await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
    await page.getByRole("button", { name: /Créer le dossier/i }).click();
    await expect(page.locator("body")).toContainText(/Hors ligne|connexion.*interrompue|réseau|indisponible/i, { timeout: 10_000 });
    await page.unroute("**/api/db/rpc");
  });
});
