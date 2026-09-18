/**
 * SCREEN 9b — /jarvis preuves documentaires (M07 slice 2).
 *
 * Preuve live du câblage : une question de connaissance générale portant
 * sur le corpus gouverné rend une réponse ET un badge de source
 * (titre · section · version). Le fournisseur LLM reste la seule source
 * de variance : en cas d'indisponibilité, le test échoue en le disant
 * (NOT RUN manuel, jamais un vert de complaisance).
 */
import { test, expect } from "playwright/test";

const CONNEXION = "/connexion";
async function login(page: import("@playwright/test").Page) {
  await page.goto(CONNEXION);
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
}

test.describe("SCREEN 9b — Preuves M07", () => {
  test("P9.1 question corpus rend une reponse avec badge de source", async ({ page }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto("/jarvis");
    const champ = page.getByPlaceholder(/Posez une question|Demander|Écrire/i).or(page.locator("textarea")).first();
    await expect(champ).toBeVisible({ timeout: 10_000 });
    // Question calibrée : routage connaissance (minuscules, sans motif
    // patient) + requête mot-clé présente au corpus (configuration câblée :
    // le tsvector fait un ET — les questions en phrases sont du ressort de
    // l'hybride, différé ; voir rapport M07).
    await champ.fill("sertraline 50 mg");
    await page.keyboard.press("Enter");
    // Fin du streaming : le bouton d'arret disparait (le modele peut
    // prendre jusqu'à 3 minutes au palier gratuit ; une panne nommee
    // fait aussi disparaitre le bouton, et le badge tranche ensuite).
    await expect(page.getByRole("button", { name: /Arrêter/i })).toBeHidden({ timeout: 200_000 });
    // Le badge de preuve gouvernée : titre · section · version.
    await expect(page.locator("body")).toContainText(/Catalogue medicaments/i, { timeout: 10_000 });
  });
});
