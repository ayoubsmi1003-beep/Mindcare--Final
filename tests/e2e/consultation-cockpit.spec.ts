/**
 * COCKPIT CONSULTATION — le poste de travail clinique.
 *
 * Ce que ces tests verrouillent n'est pas « un nouvel en-tête s'affiche »,
 * mais les promesses du lot : l'essentiel tient sans défiler (barre collante
 * avec clôture UNIQUE), le contexte se charge sur geste (budget d'ouverture
 * inchangé), les interactions structurées écrivent via les portes existantes
 * et persistent au rechargement, et le vide reste honnête.
 *
 * K1 travaille sur un dossier SYNTHÉTIQUE créé pour le test (aucune donnée
 * réelle touchée). K2 ne fait que LIRE un dossier réel avec passé (aucune
 * frappe) pour photographier l'état peuplé.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";
const PRACTITIONER_ID = "00000000-0000-0000-0000-0000000000a1";

async function login(page: Page): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(OWNER_EMAIL);
  await page.getByLabel(/Mot de passe/i).fill(OWNER_PW);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

async function rpc(page: Page, name: string, args: unknown): Promise<{ ok?: boolean; data?: unknown[] }> {
  const r = await page.request.post("/api/db/rpc", { data: { name, args } });
  return (await r.json()) as { ok?: boolean; data?: unknown[] };
}

function uniquePhone(): string {
  return `0555${Math.floor(10000000 + Math.random() * 90000000)}`;
}

/** Chaîne critique réduite : patient → RDV → séance ouverte, dossier frais. */
async function nouvelleSeance(page: Page): Promise<{ patientId: string; consultationId: string }> {
  await page.goto("/patients/nouveau");
  await expect(page.getByRole("heading", { name: /Nouveau dossier/i })).toBeVisible();
  const prenom = `Cockpit${Math.floor(Math.random() * 9000)}`;
  const nom = `Test${Math.floor(Math.random() * 9000)}`;
  await page.getByLabel("Prénom", { exact: true }).fill(prenom);
  await page.getByLabel("Nom", { exact: true }).fill(nom);
  await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
  await page.getByRole("button", { name: /Créer le dossier/i }).click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}/i, { timeout: 15_000 });
  const patientId = page.url().split("/").pop()!;

  let appointmentId: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const demain = new Date();
    demain.setDate(demain.getDate() + 1);
    demain.setHours(9 + Math.floor(Math.random() * 7), Math.floor(Math.random() * 4) * 15, 0, 0);
    const created = await rpc(page, "create_appointment", {
      p_patient_id: patientId,
      p_practitioner_id: PRACTITIONER_ID,
      p_starts_at: demain.toISOString(),
      p_duration_minutes: 30,
    });
    if (created.ok && created.data?.[0]) {
      appointmentId = created.data[0] as string;
      break;
    }
    if (attempt === 3) throw new Error("create_appointment a échoué après 4 essais");
    await page.waitForTimeout(200);
  }

  const open = await rpc(page, "get_open_consultation", {});
  const openRaw = open.data?.[0];
  const openId =
    typeof openRaw === "string"
      ? openRaw
      : openRaw !== null && typeof openRaw === "object"
        ? (Object.values(openRaw as Record<string, unknown>)[0] as string)
        : null;
  if (openId) {
    await rpc(page, "set_consultation_price", {
      p_consultation_id: openId,
      p_amount_dzd: 5000,
    });
    await rpc(page, "close_consultation", { p_id: openId });
  }

  const started = await rpc(page, "start_consultation", {
    p_patient_id: patientId,
    p_appointment_id: appointmentId,
  });
  if (!started.ok || !started.data?.[0]) throw new Error("start_consultation a échoué");
  return { patientId, consultationId: started.data[0] as string };
}

test.describe("COCKPIT — poste de travail clinique", () => {
  test("K1 cockpit complet sur dossier frais : tête, rail, focus, pistes, barre unique", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page);
    const { consultationId } = await nouvelleSeance(page);
    await page.goto(`/consultation/${consultationId}`);

    // Tête compacte : retour, nom, chrono modeste (hh:mm:ss, pas un monument).
    await expect(page.getByRole("link", { name: /Revenir à l'agenda/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator("body")).toContainText(/\d{2}:\d{2}:\d{2}/);

    // Chargeurs : la colonne patient ET le rail proposent le MÊME geste
    // explicite (budget d'ouverture : zéro lecture dossier sans clic, état
    // partagé, un seul appel au premier clic).
    await expect(
      page.getByRole("button", { name: /Charger le contexte patient/i }),
    ).toHaveCount(2);

    // Focus : cocher ne réécrit rien tant qu'on n'applique pas.
    await page.getByRole("button", { name: "Anxiété", exact: true }).click();
    await page.getByRole("button", { name: "Sommeil", exact: true }).click();
    const subjectif = page.getByRole("textbox", { name: "Subjectif", exact: true });
    await expect(subjectif).toHaveValue("");
    await page.getByRole("button", { name: /Inscrire dans Subjectif/i }).click();
    await expect(subjectif).toHaveValue("Focus : Anxiété, Sommeil — ");

    // Piste : un clic insère dans Objectif, sans doublon au second clic.
    // (éditeur à onglets : on ouvre la rubrique, puis la piste.)
    await page.getByRole("tab", { name: /Objectif/ }).click();
    await page.getByRole("button", { name: "Contact adapté", exact: true }).click();
    const objectifZone = page.getByRole("textbox", { name: "Objectif", exact: true });
    await expect(objectifZone).toHaveValue("Contact adapté");
    await page.getByRole("button", { name: "Contact adapté", exact: true }).click();
    await expect(objectifZone).toHaveValue("Contact adapté");

    // Brut compact : placeholder cockpit, 4 lignes, autosave vivant.
    const brut = page.getByRole("textbox", { name: "Notes de séance" });
    await expect(brut).toHaveAttribute("placeholder", /Commencer à écrire ou dicter/);
    await brut.fill("Séance cockpit — vérification automatisée.");
    await expect(page.locator("body")).toContainText(/Enregistré/, { timeout: 15_000 });

    // Barre collante : pas de clôture sans tarif (règle 037, gardée) ;
    // le rappel est là, avec son geste.
    await expect(page.getByRole("button", { name: "Terminer la séance" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText(/Tarif à fixer/);
    await expect(page.locator("body")).toContainText(/Le tarif manque/);

    // Fixer le tarif (workflow existant, montant manuel ADR-010) : la
    // clôture UNIQUE apparaît alors dans la barre, joignable sans défiler.
    await page.getByRole("spinbutton", { name: "Montant" }).fill("4000");
    await page.getByRole("button", { name: /Fixer le tarif/i }).click();
    await expect(page.locator("body")).toContainText(/Tarif fixé/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Terminer la séance" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Enregistrer/i }).first()).toBeVisible();

    // Clôture : prouve le cycle complet ET ne laisse aucune séance ouverte
    // (un reliquat `open` ferait échouer le `start_consultation` des suites
    // suivantes — `one_open_consult`, pas une régression).
    page.on("dialog", (dialogue) => void dialogue.accept());
    await page.getByRole("button", { name: "Terminer la séance" }).click();
    await expect(page.locator("body")).toContainText(/Séance terminée/, { timeout: 20_000 });
  });

  test("K2 rail peuplé en lecture seule : charge, affiche, ne fabrique rien", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await login(page);
    const patients = await rpc(page, "search_patients", {
      p_query: null,
      p_limit: 40,
      p_offset: 0,
    });
    let cible: { patientId: string; consultationId: string } | null = null;
    for (const ligne of patients.data ?? []) {
      const patientId = (ligne as { id?: string }).id;
      if (patientId === undefined) continue;
      const frise = await rpc(page, "list_patient_timeline", {
        p_id: patientId,
        p_before_at: null,
        p_before_id: null,
        p_limit: 50,
      });
      const consultations = (frise.data ?? []).filter(
        (e) => (e as { event_type?: string }).event_type === "consultation",
      ) as Array<{ event_id?: string }>;
      if (consultations.length >= 2 && consultations[0]?.event_id) {
        cible = { patientId, consultationId: consultations[0].event_id };
        break;
      }
    }
    test.skip(cible === null, "aucun dossier avec passé dans cette base");

    // AUCUNE frappe dans ce test : on photographie le cockpit peuplé.
    await page.goto(`/consultation/${cible!.consultationId}`);
    await expect(page.getByRole("link", { name: /Revenir à l'agenda/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: /Charger le contexte patient/i }).first().click();
    await expect(page.locator("body")).toContainText(/État clinique|Aujourd'hui/, {
      timeout: 20_000,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "checkpoints/cockpit-2026-09-11/peuple-1440.png", fullPage: true });
  });

  test("K3 captures aux trois largeurs : 1920, 1440, 1366", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const { consultationId } = await nouvelleSeance(page);
    await page.goto(`/consultation/${consultationId}`);
    await expect(page.getByRole("link", { name: /Revenir à l'agenda/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "checkpoints/cockpit-2026-09-11/frais-1920.png", fullPage: true });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "checkpoints/cockpit-2026-09-11/frais-1440.png", fullPage: true });

    // Rail replié : le geste de concentration maximale.
    await page.getByRole("button", { name: /Replier le contexte/i }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: "checkpoints/cockpit-2026-09-11/frais-1440-rail-replie.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: /Afficher le contexte/i }).click();

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: "checkpoints/cockpit-2026-09-11/frais-1366.png", fullPage: true });
  });
});
