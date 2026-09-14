/**
 * V9 — LA SOUS-NAVIGATION DE LA CONSULTATION.
 *
 * Ce que ces tests verrouillent n est pas « une barre d onglets s affiche »,
 * mais la promesse qui a justifie le lot : la praticienne atteint le dossier
 * SANS QUITTER SA SEANCE, et son travail en cours survit au va-et-vient.
 *
 * O3 est le test qui compte. Il tape du texte dans les notes brutes, part dans
 * un autre onglet, revient, et exige que le texte soit toujours la. C est la
 * seule maniere de prouver que la sous-navigation n a pas transforme un
 * changement d onglet en perte de saisie clinique.
 *
 * Comptes : memes fixtures que connexion.spec.ts / role-resolution.spec.ts,
 * aucun secret nouveau.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";

async function login(page: Page): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(OWNER_EMAIL);
  await page.getByLabel(/Mot de passe/i).fill(OWNER_PW);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

async function rpc(page: Page, name: string, args: unknown): Promise<{ data?: unknown[] }> {
  const r = await page.request.post("/api/db/rpc", { data: { name, args } });
  return (await r.json()) as { data?: unknown[] };
}

/**
 * Trouve une consultation REELLE du cabinet, sans en creer une.
 *
 * On passe par les memes portes que l application (`search_patients` puis
 * `list_patient_timeline`) plutot que par un identifiant en dur : un id de
 * fixture code ici deviendrait faux a la premiere purge, et le test echouerait
 * pour une raison qui n aurait rien a voir avec les onglets.
 */
async function trouverConsultation(
  page: Page,
): Promise<{ patientId: string; consultationId: string; avecHistorique: boolean } | null> {
  const patients = await rpc(page, "search_patients", { p_query: null, p_limit: 40, p_offset: 0 });
  let repli: { patientId: string; consultationId: string; avecHistorique: boolean } | null = null;

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
    const premier = consultations[0]?.event_id;
    if (premier === undefined) continue;

    // ⚠️ ON CHERCHE UN DOSSIER QUI A UN PASSE, ET C EST LE POINT DU TEST O2.
    // Un dossier a une seule consultation fait passer O2 en `skip` : le test
    // serait vert sans avoir jamais exerce le geste qu il pretend verrouiller.
    if (consultations.length >= 2) {
      return { patientId, consultationId: premier, avecHistorique: true };
    }
    repli ??= { patientId, consultationId: premier, avecHistorique: false };
  }
  return repli;
}

test.describe("CONSULTATION — sous-navigation V9", () => {
  test("O1 les cinq sections sont atteignables depuis la seance", async ({ page }) => {
    await login(page);
    const cible = await trouverConsultation(page);
    test.skip(cible === null, "aucune consultation dans cette base");

    await page.goto(`/consultation/${cible!.consultationId}`);

    const onglets = page.getByRole("tablist", { name: /Sections de la consultation/i });
    await expect(onglets).toBeVisible({ timeout: 20_000 });
    // Noms EXACTS : « Séance » est un prefixe de « Séances précédentes », et
    // un `name` non exact resout les deux (violation du mode strict).
    for (const nom of [
      "Séance",
      "Résumé",
      "Séances précédentes",
      "Traitement",
      "Documents",
      "Rendez-vous",
    ]) {
      await expect(onglets.getByRole("tab", { name: nom, exact: true })).toBeVisible();
    }
  });

  test("O2 cliquer une date passee ouvre la seance SANS quitter l ecran", async ({ page }) => {
    await login(page);
    const cible = await trouverConsultation(page);
    test.skip(cible === null, "aucune consultation dans cette base");

    const url = `/consultation/${cible!.consultationId}`;
    await page.goto(url);
    await page.getByRole("tab", { name: "Séances précédentes", exact: true }).click();

    test.skip(!cible!.avecHistorique, "aucun dossier a deux consultations dans cette base");

    const lignes = page.getByRole("button", { name: /Lire la séance/i });
    await expect(lignes.first()).toBeVisible({ timeout: 15_000 });

    await lignes.first().click();
    await expect(page.getByRole("button", { name: /Replier/i })).toBeVisible({ timeout: 15_000 });

    // LA PROMESSE : on n a pas navigue. Meme URL, meme ecran.
    await expect(page).toHaveURL(new RegExp(`${cible!.consultationId}$`));
  });

  test("O4 le resume d avant-seance s affiche sans appel de modele", async ({ page }) => {
    await login(page);
    const cible = await trouverConsultation(page);
    test.skip(cible === null, "aucune consultation dans cette base");

    // Aucun appel a la passerelle ne doit partir : ces sections sont
    // DETERMINISTES. Si un modele etait sollicite ici, le resume mentirait
    // le jour ou le fournisseur tombe (I20).
    const appelsJarvis: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/jarvis/")) appelsJarvis.push(r.url());
    });

    await page.goto(`/consultation/${cible!.consultationId}`);
    await page.getByRole("tab", { name: "Résumé", exact: true }).click();

    // « Depuis » est le titre de la section de diff factuel.
    await expect(page.getByRole("heading", { name: /Depuis/i })).toBeVisible({
      timeout: 15_000,
    });
    expect(appelsJarvis, `appels modele inattendus : ${appelsJarvis.join(", ")}`).toHaveLength(0);
  });

  test("O5 ouvrir la consultation ne coute AUCUN appel de plus qu avant", async ({ page }) => {
    /*
      LA PROMESSE DE PERFORMANCE DU LOT A, MESURÉE.

      Cinq onglets ont été ajoutés, dont trois lisent le dossier. Si l'un d'eux
      lisait à l'OUVERTURE plutôt qu'à sa première sélection, le budget
      d'ouverture de `06-PERF-BUDGET.md` sauterait — et il sauterait en silence,
      parce que l'écran continuerait de s'afficher correctement.

      On énumère donc les portes réellement appelées à l'ouverture. Seules
      celles de la SÉANCE ont le droit d'y être ; toute porte de dossier
      (`get_patient_workspace`, `list_patient_timeline`,
      `list_patient_documents`) est une régression de budget.
    */
    await login(page);
    const cible = await trouverConsultation(page);
    test.skip(cible === null, "aucune consultation dans cette base");

    const portes: string[] = [];
    page.on("request", (r) => {
      if (!r.url().includes("/api/db/rpc")) return;
      try {
        const corps = r.postDataJSON() as { name?: string } | null;
        if (corps?.name !== undefined) portes.push(corps.name);
      } catch {
        /* corps non JSON — ignore */
      }
    });

    await page.goto(`/consultation/${cible!.consultationId}`);
    // La sous-navigation de l'écran (l'éditeur SOAP porte sa propre
    // `tablist` « Notes de la consultation » depuis le cockpit 3 volets).
    await expect(
      page.getByRole("tablist", { name: "Sections de la consultation" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);

    for (const paresseuse of [
      "get_patient_workspace",
      "list_patient_timeline",
      "list_patient_documents",
      "get_patient_treatments",
    ]) {
      expect(
        portes,
        `« ${paresseuse} » est partie a l'OUVERTURE : la lecture paresseuse est cassee. Portes vues : ${portes.join(", ")}`,
      ).not.toContain(paresseuse);
    }
  });

  test("O3 la saisie clinique survit au changement d onglet", async ({ page }) => {
    await login(page);
    const cible = await trouverConsultation(page);
    test.skip(cible === null, "aucune consultation dans cette base");

    await page.goto(`/consultation/${cible!.consultationId}`);

    const panneauSeance = page.locator("#panneau-seance");
    await expect(panneauSeance).toBeVisible({ timeout: 20_000 });

    // LE MECANISME QUI PROTEGE LA SAISIE : le panneau de seance reste ATTACHE
    // au DOM quand un autre onglet est actif. C est lui qui garde les `ref` des
    // zones de texte, dont depend l insertion de la dictee. Cette assertion
    // vaut pour toute seance, ouverte ou close.
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await expect(panneauSeance).toBeAttached();
    await expect(panneauSeance).not.toBeVisible();

    await page.getByRole("tab", { name: "Séance", exact: true }).click();
    await expect(panneauSeance).toBeVisible();

    // Et LA PROMESSE elle-meme, quand la seance est encore ouverte : le texte
    // saisi traverse le va-et-vient.
    const notes = page.getByLabel(/Notes brutes/i).first();
    if ((await notes.count()) === 0 || (await notes.isDisabled())) return;

    const temoin = `temoin-onglets-${Date.now()}`;
    await notes.fill(temoin);
    await page.getByRole("tab", { name: "Documents", exact: true }).click();
    await page.getByRole("tab", { name: "Séance", exact: true }).click();
    await expect(page.getByLabel(/Notes brutes/i).first()).toHaveValue(temoin);
  });
});
