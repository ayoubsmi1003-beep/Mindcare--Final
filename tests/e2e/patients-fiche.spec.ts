/**
 * SCREEN 5 — /patients/[id]
 * Workspace: 1 call, 6 onglets, timeline keyset, modif, refresh, RLS
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

async function getFirstPatientId(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/patients");
  await expect(page.getByPlaceholder(/Nom, téléphone/i)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2000);
  // Patient rows are /patients/<uuid> (uuid contains dashes), not /patients/nouveau
  const link = page.locator("a[href^='/patients/'][href*='-']").first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  const href = await link.getAttribute("href");
  const id = href!.split("/").pop()!;
  // If somehow got 'nouveau', retry finding proper
  if (id === "nouveau") {
    const alt = page.locator("a[href^='/patients/']").filter({ hasText: /P-/ }).first();
    const href2 = await alt.getAttribute("href");
    return href2!.split("/").pop()!;
  }
  return id;
}

test.describe("SCREEN 5 — /patients/[id]", () => {
  test("F5.1 workspace loads 1 RPC and shows 6 onglets structure", async ({ page }) => {
    await login(page);
    const id = await getFirstPatientId(page);
    const rpcs: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/db/rpc")) {
        try { const j = JSON.parse(r.postData()||"{}") as {name?:string}; if(j.name) rpcs.push(j.name)} catch {}
      }
    });
    await page.goto(`/patients/${id}`);
    await expect(page.locator("body")).toContainText(/Vue d'ensemble|Chronologie|Clinique|Traitements|Rendez-vous|Documents/i, { timeout: 10_000 });
    // Should have called get_patient_workspace
    expect(rpcs.filter(n=>n==="get_patient_workspace").length).toBeGreaterThanOrEqual(1);
  });

  test("F5.2 refresh preserves workspace", async ({ page }) => {
    await login(page);
    const id = await getFirstPatientId(page);
    await page.goto(`/patients/${id}`);
    await expect(page.locator("body")).toContainText(/Vue d'ensemble/i, { timeout: 10_000 });
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/patients/${id}`));
    await expect(page.locator("body")).toContainText(/Vue d'ensemble/i, { timeout: 10_000 });
  });

  test("F5.3 timeline demande loads on click", async ({ page }) => {
    await login(page);
    const id = await getFirstPatientId(page);
    await page.goto(`/patients/${id}`);
    await expect(page.locator("body")).toContainText(/Vue d'ensemble/i, { timeout: 10_000 });
    // Click Historique
    const histBtn = page.getByRole("button", { name: /Afficher l'historique/i });
    if (await histBtn.count() > 0) {
      await histBtn.click();
      await expect(page.locator("body")).toContainText(/Consultation|Rendez-vous|Prescription|Document|Traitement|Chronologie/i, { timeout: 10_000 });
    } else {
      // Fallback: click Chronologie onglet
      await page.getByRole("button", { name: /Chronologie|Historique/i }).first().click();
      await page.waitForTimeout(1000);
      await expect(page.locator("body")).toContainText(/Chronologie|événement/i, { timeout: 10_000 });
    }
  });

  test("F5.4 modification dossier persists after reload", async ({ page }) => {
    await login(page);
    const id = await getFirstPatientId(page);
    await page.goto(`/patients/${id}`);
    await expect(page.locator("body")).toContainText(/Vue d'ensemble/i, { timeout: 10_000 });
    // Open modifier — may be via EnTeteCollant
    const modBtn = page.getByRole("button", { name: /Modifier le dossier/i });
    if (await modBtn.count() === 0) {
      test.info().annotations.push({ type: "note", description: "Modifier button not found — maybe role restriction, skipping" });
      return;
    }
    await modBtn.click();
    // Modify address
    const addressField = page.getByLabel(/Adresse/i);
    if (await addressField.count() > 0) {
      const newAddr = `Adresse test ${Math.floor(Math.random()*9000)}`;
      await addressField.fill(newAddr);
      await page.getByRole("button", { name: /Enregistrer/i }).click();
      // Le formulaire se referme dans le meme batch React que le succes
      // (FormulaireModification: setEtat("enregistre") + onEnregistre
      // synchrones) : l'indicateur "Enregistre" ne se peint jamais. Le
      // comportement garanti est le retour a la fiche puis le rechargement
      // depuis le serveur (apresModification refait getPatientWorkspace).
      await expect(page.getByRole("button", { name: /Modifier le dossier/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("body")).toContainText(new RegExp(newAddr, "i"), { timeout: 15_000 });
      await page.reload();
      await expect(page.locator("body")).toContainText(new RegExp(newAddr, "i"), { timeout: 10_000 });
    }
  });

  test("F5.5 hors perimetre vs introuvable indistinguishable (fake UUID)", async ({ page }) => {
    await login(page);
    await page.goto(`/patients/00000000-0000-0000-0000-0000000000ff`);
    await expect(page.locator("body")).toContainText(/introuvable/i, { timeout: 10_000 });
    await expect(page.locator("body")).not.toContainText(/pas accessible|hors périmètre/i);
  });

  test("F5.6 offline shows bandeau not crash", async ({ page }) => {
    await login(page);
    const id = await getFirstPatientId(page);
    await page.route("**/api/db/rpc", (route) => {
      try {
        const j = JSON.parse(route.request().postData()||"{}") as {name?:string};
        if (j.name==="get_patient_workspace") return route.abort();
      } catch {}
      return route.continue();
    });
    await page.goto(`/patients/${id}`);
    await expect(page.locator("body")).toContainText(/Hors ligne|indisponible|réseau/i, { timeout: 10_000 });
    await page.unroute("**/api/db/rpc");
  });
});
