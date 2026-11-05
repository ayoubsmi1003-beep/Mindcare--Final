/**
 * Live browser acceptance for the three reliability questions.
 *
 * Credentials are read from .env in Node and never printed. The test is
 * skipped unless MINDCARE_E2E_LIVE=1.
 *
 *   $env:MINDCARE_E2E_LIVE = "1"
 *   pnpm playwright test tests/e2e/alexa-reliability.spec.ts --project=chromium
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const live = process.env["MINDCARE_E2E_LIVE"] === "1";
test.skip(!live, "live credentials required");

function credentials(): { username: string; password: string } {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8").split(/\r?\n/u).filter(line => /^[A-Z0-9_]+=/u.test(line))
      .map(line => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }),
  ) as Record<string, string>;
  const username = env["DOCTOR_ACCOUNT_USERNAME"];
  const password = env["DOCTOR_ACCOUNT_PASSWORD"];
  if (!username || !password) throw new Error("DOCTOR_ACCOUNT_* missing from .env");
  return { username, password };
}

async function login(page: Page): Promise<void> {
  const { username, password } = credentials();
  await page.goto("/connexion");
  await page.getByLabel(/Nom d[’']utilisateur/i).fill(username);
  await page.getByLabel(/^Mot de passe/i).fill(password);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/(patients|tableauDeBord|agenda)/u, { timeout: 20_000 });
}

async function ask(page: Page, question: string, expected: RegExp, marker: string, screenshot: string): Promise<string> {
  const input = page.getByPlaceholder(/Posez une question|Demander|écrire/i).or(page.locator("textarea")).first();
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(question);
  const send = page.getByRole("button", { name: /Envoyer|Demander/i }).first();
  if (await send.count()) await send.click();
  else await input.press("Enter");

  // Wait for the answer marker, not the SSE headers: the stream is the turn.
  await page.waitForFunction(
    value => new RegExp(value, "iu").test(document.body.innerText),
    marker,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1_500);
  const body = await page.locator("body").innerText();
  await page.screenshot({ path: `test-results/${screenshot}.png`, fullPage: true });
  expect(body).not.toMatch(/Aucune preuve suffisante/iu);
  expect(body).toMatch(expected);
  return body;
}

test("Alexa answers the three reliability questions in the real UI", async ({ page }) => {
  test.setTimeout(600_000);
  const consoleErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => consoleErrors.push(`pageerror:${error.message}`));

  await login(page);
  await page.goto("/jarvis");
  await expect(page.locator("body")).toContainText(/Alexa|Jarvis|aide à la décision/iu, { timeout: 20_000 });

  const one = process.env["MINDCARE_E2E_ONE"] === "1";
  const sertraline = await ask(page, "Quelles précautions pour la sertraline ?", /sertraline|précaution|warnings/iu, "Passage cité|Ces sources|Aucune preuve suffisante|La synthèse", "alexa-sertraline");
  const lithium = one ? sertraline : await ask(page, "Comment surveiller un patient sous lithium ?", /lithium|surveillance|monitoring/iu, "Passage cité|Ces sources|Aucune preuve suffisante|La synthèse", "alexa-lithium");
  const capital = one ? sertraline : await ask(page, "Quelle est la capitale de l'Australie ?", /canberra|australie|réponse fiable/iu, "Canberra|Indisponible|réponse fiable|capitale", "alexa-capital");

  console.log(JSON.stringify({
    sertraline: { hasAbstention: /Aucune preuve suffisante/iu.test(sertraline), characters: sertraline.length },
    lithium: { hasAbstention: /Aucune preuve suffisante/iu.test(lithium), characters: lithium.length },
    capital: { characters: capital.length },
    consoleErrors,
  }));
  expect(consoleErrors.filter(message => !/hydration|TrendTrack|401|favicon/iu.test(message))).toEqual([]);
});
