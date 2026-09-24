/**
 * SCREEN 9b — /jarvis preuves documentaires (M07 slice 2).
 *
 * Task 4: medical questions abstain while all six books are quarantined;
 * the clinician can inspect an exact book excerpt and physical page in UI.
 */
import { test, expect } from "playwright/test";
import { loadEnvFile } from "node:process";

loadEnvFile(".env");

const CONNEXION = "/connexion";
async function login(page: import("@playwright/test").Page) {
  await page.goto(CONNEXION, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // The SSR form is clickable before React attaches its submit handler. Wait
  // for that handler or a native submit reload clears the fields.
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form !== null && Object.keys(form).some((key) => {
      const props: unknown = Reflect.get(form, key);
      return key.startsWith("__reactProps$") && typeof props === "object" && props !== null &&
        "onSubmit" in props && typeof props.onSubmit === "function";
    });
  }, undefined, { timeout: 30_000 });
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  const password = process.env.DEV_ACCOUNT_PASSWORD;
  if (!password) throw new Error("DEV_ACCOUNT_PASSWORD is required for the local book E2E test");
  await page.getByLabel(/Mot de passe/i).fill(password);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 45_000 });
}

test.describe("SCREEN 9b — Book evidence", () => {
  test("medical question abstains while book gates are closed", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto("/jarvis");
    const champ = page.getByPlaceholder(/Posez une question|Demander|Écrire/i).or(page.locator("textarea")).first();
    await expect(champ).toBeVisible({ timeout: 10_000 });
    await champ.fill("sertraline 50 mg");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Arrêter/i })).toBeHidden({ timeout: 200_000 });
    await expect(page.locator("body")).toContainText(/livres sont présents|aucun passage accessible|recherche sémantique n'était pas disponible/i);
    await expect(page.locator("body")).not.toContainText(/Catalogue medicaments/i);
  });

  test("book citation opens the excerpt and physical PDF page", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page);
    await page.goto("/jarvis");
    await page.route("**/api/jarvis/jarvis-chat", async (route) => {
      const proof = {
        titre: "Livre exact", section: "Chapitre › Section", version: "ocr-2026-09",
        extrait: "ABCD EFGH", id: "11111111-1111-4111-8111-111111111111",
        livre: { numero: 1, edition: "Édition vérifiée", ocrReviewStatus: "accepted",
          pages: [{ splitId: "volume-1.pdf", physicalPage: 4, globalPhysicalPage: 4, printedPage: null }] },
      };
      const payload = { chemin: "connaissance", type: "texte", reponse: "ABCD EFGH", preuves: [proof] };
      const body = [
        { t: "chemin", chemin: "connaissance" },
        { t: "fin", payload, persiste: true },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
      await route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });
    const champ = page.getByPlaceholder(/Posez une question|Demander|Écrire/i).or(page.locator("textarea")).first();
    await champ.fill("Question de test");
    await page.keyboard.press("Enter");
    const citation = page.getByText(/Livre B01 · DSM-5 Manuel diagnostique et statistiques des troubles mentaux · Édition vérifiée/);
    await expect(citation).toBeVisible();
    await citation.click();
    await expect(page.getByText(/Titre imprimé : Livre exact/)).toBeVisible();
    await expect(page.getByText(/volume-1.pdf · PDF p. 4 · Page imprimée non vérifiée/)).toBeVisible();
    await expect(page.getByText(/Extrait source : « ABCD EFGH »/)).toBeVisible();
  });
});
