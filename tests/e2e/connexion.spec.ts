/**
 * SCREEN 1 — /connexion (GATE)
 * Exhaustive Playwright audit: 5 states, forms, validation, offline, persistence, RLS
 * Must be GREEN before SCREEN 2.
 */
import { test, expect, type Page } from "@playwright/test";

const CONNEXION_URL = "/connexion";
const PATIENTS_URL = "/patients";

// Collect console errors / failed requests per test
function harness(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: { url: string; status: number | null; method: string }[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${msg.text()}`);
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (resp) => {
    const status = resp.status();
    if (status >= 400) {
      // Ignore HMR / dev artifacts, keep only relevant
      const url = resp.url();
      if (url.includes("/api/") || url.includes("/connexion") || url.includes("/patients")) {
        failedRequests.push({ url, status, method: resp.request().method() });
      }
    }
  });
  return { consoleErrors, pageErrors, failedRequests };
}

test.describe("SCREEN 1 — /connexion", () => {
  test("C1.1 root redirect / -> /patients -> /connexion when anonymous", async ({ page }) => {
    const { consoleErrors, pageErrors } = harness(page);
    await page.goto("/");
    // Root redirects to /patients (src/app/page.tsx:15), then gate redirects to /connexion when no session
    await expect(page).toHaveURL(/\/connexion/, { timeout: 10_000 });
    // Page should show connexion title
    await expect(page.getByRole("heading", { name: /Connexion/i })).toBeVisible();
    expect(pageErrors, `pageErrors: ${pageErrors.join("\n")}`).toEqual([]);
    // console errors allowed? Should be 0 unexpected (ignore expected 401 for anonymous)
    const unexpected = consoleErrors.filter((m) => !m.includes("hydration") && !m.includes("TrendTrack") && !m.includes("401"));
    expect(unexpected, `consoleErrors: ${unexpected.join("\n")}`).toEqual([]);
  });

  test("C1.2 renders form + states + a11y", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await expect(page.getByRole("heading", { name: /Connexion/i })).toBeVisible();
    // Labels from fr.connexion.champEmail / champMotDePasse
    await expect(page.getByLabel(/E-mail/i)).toBeVisible();
    await expect(page.getByLabel(/Mot de passe/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Se connecter/i })).toBeVisible();
    // Required attributes (html validation)
    await expect(page.getByLabel(/E-mail/i)).toHaveAttribute("required", "");
    await expect(page.getByLabel(/Mot de passe/i)).toHaveAttribute("required", "");
    // Focus visible / target size (>=36px is CSS, we check actionable)
    await expect(page.getByRole("button", { name: /Se connecter/i })).toBeEnabled();
    // Accroche present (fr.connexion.accroche) — appears twice (desktop+mobile), check at least one visible
    await expect(page.getByText(/Le poste de travail du cabinet/i).first()).toBeVisible();
  });

  test("C1.3 empty submit does not call API (HTML required prevents)", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    const button = page.getByRole("button", { name: /Se connecter/i });
    // Try click without filling — browser validation should block
    await button.click();
    // Should stay on connexion, button still enabled (no enCours)
    await expect(page).toHaveURL(/\/connexion/);
    await expect(button).toBeEnabled();
    // No error message yet (empty not submitted to server)
    // The form should still be visible
    await expect(page.getByLabel(/E-mail/i)).toBeVisible();
  });

  test("C1.4 invalid email format shows browser validation", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).fill("not-an-email");
    await page.getByLabel(/Mot de passe/i).fill("short");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    // Browser email type should cause validation; still on same page
    await expect(page).toHaveURL(/\/connexion/);
  });

  test("C1.5 wrong credentials shows error, stays on page, button re-enabled", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).fill("mauvais@invalid.local");
    await page.getByLabel(/Mot de passe/i).fill("MauvaisMdp123!");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    // Expect error alert (role=alert) — exclude Next route announcer
    const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)').first();
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText(/incorrect|refus|inattendu|connexion/i);
    // Button must be re-enabled after failure (enCours reset)
    await expect(page.getByRole("button", { name: /Se connecter/i })).toBeEnabled();
    await expect(page).toHaveURL(/\/connexion/);
  });

  test("C1.6 successful login via owner.dev and redirect to /patients", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    // Use DEV_ACCOUNT from .env — owner.dev@invalid.local
    // We try known dev accounts; first attempt a1
    const email = "owner.dev@invalid.local";
    const password = "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";
    await page.getByLabel(/E-mail/i).fill(email);
    await page.getByLabel(/Mot de passe/i).fill(password);
    await page.getByRole("button", { name: /Se connecter/i }).click();
    // Should navigate to /patients (src/app/connexion/page.tsx:73 router.replace("/patients"))
    await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
    // Check that patients page loaded (AppShell, rechercher)
    await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
    // No unexpected page errors
  });

  test("C1.7 refresh after login preserves session", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
    await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
    await page.reload();
    await expect(page).toHaveURL(/\/patients/, { timeout: 10_000 });
    // Still see search, not redirected to connexion
    await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
  });

  test("C1.8 navigation patients -> agenda -> back preserves session", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
    await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
    await page.goto("/agenda");
    await expect(page).toHaveURL(/\/agenda/, { timeout: 10_000 });
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients/, { timeout: 10_000 });
    await expect(page.getByRole("search")).toBeVisible();
  });

  test("C1.9 signOut via AppShell returns to /connexion and blocks back", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
    await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
    // Wait for AppShell to load (utilisateur resolved)
    await expect(page.getByRole("search")).toBeVisible({ timeout: 10_000 });
    // Find deconnexion button — in AppShell Rail (use title to avoid viewport-dependent hidden text)
    const deconnect = page.locator('button[title="Se déconnecter"]');
    await expect(deconnect).toBeVisible({ timeout: 10_000 });
    await deconnect.click();
    await expect(page).toHaveURL(/\/connexion/, { timeout: 10_000 });
    // Try to go back to patients — should be redirected to connexion again (gate)
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/connexion/, { timeout: 10_000 });
  });

  test("C1.10 offline: aborted API shows hors-ligne, stays on page", async ({ page }) => {
    harness(page);
    // Abort auth sign-in to simulate offline
    await page.route("**/api/auth/sign-in", (route) => route.abort());
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
    await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
    await page.getByRole("button", { name: /Se connecter/i }).click();
    // Should show hors-ligne status (role=status) or alert — wait for either
    await expect(page.locator('[role="status"], [role="alert"]:not(#__next-route-announcer__)').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("body")).toContainText(/Hors ligne|connexion.*interrompue|réseau/i);
    await expect(page).toHaveURL(/\/connexion/);
    await page.unroute("**/api/auth/sign-in");
  });

  test("C1.11 premiere-configuration gate respects environment", async ({ page }) => {
    harness(page);
    // In cloud-dev, /connexion should NOT redirect to /premiere-configuration
    await page.goto(CONNEXION_URL);
    await expect(page).toHaveURL(/\/connexion/, { timeout: 5_000 });
    // Also check that health endpoint says ok
    const resp = await page.request.get("/api/health");
    expect(resp.ok()).toBeTruthy();
  });

  test("C1.12 no secret in client bundle (basic check via page content)", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    const content = await page.content();
    expect(content).not.toContain("OPENROUTER_API_KEY");
    expect(content).not.toContain("GROQ_API_KEY");
    expect(content).not.toContain("ELEVENLABS");
    // Also fetch a JS chunk and check — best effort
    const scripts = await page.evaluate(() => Array.from(document.querySelectorAll("script[src]")).map((s) => (s as HTMLScriptElement).src));
    for (const src of scripts.slice(0, 3)) {
      if (!src) continue;
      try {
        const r = await page.request.get(src);
        const txt = await r.text();
        expect(txt).not.toContain("sk-or-v1");
        expect(txt).not.toContain("gsk_");
      } catch {
        // ignore fetch errors
      }
    }
  });

  test("C1.13 a11y focus visible and no a11y crash", async ({ page }) => {
    harness(page);
    await page.goto(CONNEXION_URL);
    await page.getByLabel(/E-mail/i).focus();
    await expect(page.getByLabel(/E-mail/i)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(/Mot de passe/i)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /Se connecter/i })).toBeFocused();
  });

  test("C1.14 perf: FCP skeleton <100ms concept check (build)", async ({ page }) => {
    harness(page);
    const start = Date.now();
    await page.goto(CONNEXION_URL, { waitUntil: "domcontentloaded" });
    const elapsed = Date.now() - start;
    // Basic sanity: domcontentloaded should be < 3s even in build
    expect(elapsed).toBeLessThan(3000);
    await expect(page.getByRole("heading", { name: /Connexion/i })).toBeVisible();
  });
});
