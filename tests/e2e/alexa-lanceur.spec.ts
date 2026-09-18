/**
 * LE LANCEUR D'ALEXA — bulle flottante unique (V9, décision D-1).
 *
 * V7 avait retiré la bulle au profit du champ de commande de la barre
 * supérieure. V9 fait l'inverse : la bulle revient, le champ s'en va. Ce
 * fichier verrouille les deux moitiés de cette décision, parce qu'un retour en
 * arrière partiel — la bulle ajoutée SANS retirer le champ — donnerait deux
 * lanceurs pour la même chose, ce que V7 reprochait déjà à V6.
 *
 * ⚠️ L4 EST LA RAISON PROFONDE DU CHANGEMENT. `AppShell` ne rend pas la barre
 * supérieure en mode séance. Le lanceur unique de V7 disparaissait donc pendant
 * une consultation — là où l'assistante sert le plus — ne laissant que `⌘K`,
 * un raccourci que rien n'annonce à l'écran.
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

test.describe("ALEXA — lanceur flottant", () => {
  test("L1 la bulle ouvre le panneau, et s efface une fois ouvert", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");

    const bulle = page.getByRole("button", { name: /Ouvrir Alexa/i });
    await expect(bulle).toBeVisible({ timeout: 15_000 });

    await bulle.click();
    await expect(page.getByRole("button", { name: /Maintenir pour parler/i })).toBeVisible({
      timeout: 15_000,
    });

    // Un lanceur qui flotte PAR-DESSUS ce qu'il vient d'ouvrir n'ouvre plus
    // rien : il masque. La bulle doit donc disparaitre.
    await expect(bulle).toHaveCount(0);
  });

  test("L2 UN SEUL lanceur : le champ de commande de la barre a bien disparu", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    await expect(page.getByRole("button", { name: /Ouvrir Alexa/i })).toBeVisible({
      timeout: 15_000,
    });

    // Le champ de commande de V7/V8 portait ce libelle dans la barre. Sa
    // survivance ferait DEUX portes pour la meme conversation.
    const banniere = page.getByRole("banner");
    await expect(banniere.getByText(/Demander à Alexa/i)).toHaveCount(0);
  });

  // M11 — ⌘K ouvre la PALETTE, plus le panneau : la palette est la 3e entrée
  // de la MÊME conversation (voix, panneau, ⌘K), sur le même store. Le
  // raccourci ouvre toujours l'assistante — c'est exactement ce que L3 verrouille.
  test("L3 le raccourci clavier ouvre la palette de commande", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    await expect(page.getByRole("button", { name: /Ouvrir Alexa/i })).toBeVisible({
      timeout: 15_000,
    });

    // La bulle AJOUTE une porte visible, elle n'en retire aucune.
    await page.keyboard.press("Control+k");
    const dialogue = page.getByRole("dialog", { name: /Commande/i });
    await expect(dialogue).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialogue).toHaveCount(0);
  });

  test("L5 le bouton Envoyer tient DANS le panneau", async ({ page }) => {
    /*
      REGRESSION MESURÉE AU NAVIGATEUR, PAS SUPPOSÉE.

      Le `<footer>` du panneau est une grille, et la saisie en est un élément.
      Un élément de grille vaut `min-width: auto` : il refuse de descendre sous
      la largeur de son contenu. La ligne saisie + voix + envoi dépassait donc
      les 380 px du panneau, et « Envoyer » — dernier de la ligne — sortait de
      l'écran : bord droit mesuré à 1520 px pour une fenêtre de 1440.

      Le bouton principal de l'assistante était hors cadre, invisible et
      incliquable, et aucun test ne le voyait : `toBeVisible()` reste VRAI pour
      un élément simplement débordé. Il faut mesurer sa géométrie.
    */
    await login(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tableauDeBord");
    await page.getByRole("button", { name: /Ouvrir Alexa/i }).click();

    const envoi = page.getByRole("button", { name: /Envoyer/i });
    await expect(envoi).toBeVisible({ timeout: 15_000 });

    const cadre = await envoi.boundingBox();
    expect(cadre, "le bouton Envoyer n'a pas de geometrie").not.toBeNull();
    const largeurFenetre = page.viewportSize()!.width;
    expect(
      cadre!.x + cadre!.width,
      `« Envoyer » deborde de ${Math.round(cadre!.x + cadre!.width - largeurFenetre)} px`,
    ).toBeLessThanOrEqual(largeurFenetre);
    expect(cadre!.x, "« Envoyer » deborde a gauche").toBeGreaterThanOrEqual(0);
  });

  test("L4 la bulle est la SUR L ECRAN DE CONSULTATION, ou la barre n existe pas", async ({
    page,
  }) => {
    await login(page);

    const pats = await rpc(page, "search_patients", { p_query: null, p_limit: 40, p_offset: 0 });
    let cible: string | null = null;
    for (const l of pats.data ?? []) {
      const id = (l as { id?: string }).id;
      if (id === undefined) continue;
      const f = await rpc(page, "list_patient_timeline", {
        p_id: id,
        p_before_at: null,
        p_before_id: null,
        p_limit: 50,
      });
      const cs = (f.data ?? []).filter(
        (e) => (e as { event_type?: string }).event_type === "consultation",
      ) as Array<{ event_id?: string }>;
      if (cs[0]?.event_id !== undefined) {
        cible = cs[0].event_id;
        break;
      }
    }
    test.skip(cible === null, "aucune consultation dans cette base");

    await page.goto(`/consultation/${cible}`);
    await expect(page.getByRole("tablist")).toBeVisible({ timeout: 20_000 });

    // LE POINT DE TOUT LE LOT : joignable depuis la consultation.
    await expect(page.getByRole("button", { name: /Ouvrir Alexa/i })).toBeVisible();
  });
});
