/**
 * AUCUNE COMMANDE NE DOIT SORTIR DU CADRE.
 *
 * POURQUOI CE FICHIER EXISTE. Le bouton « Envoyer » du panneau Alexa vivait
 * hors de l'écran : bord droit à 1520 px pour une fenêtre de 1440. Cause —
 * le `<footer>` du panneau est une grille, et un élément de grille vaut
 * `min-width: auto`, donc refuse de descendre sous la largeur de son contenu.
 *
 * ⚠️ AUCUN TEST EXISTANT NE POUVAIT LE VOIR, ET C'EST LE POINT. Playwright
 * considère `toBeVisible()` comme VRAI pour un élément simplement débordé : il
 * a une taille, il n'est ni `display:none` ni `visibility:hidden`. Un bouton
 * principal peut donc être injoignable à la souris tout en étant « visible »
 * pour toute la suite de tests. Seule la GÉOMÉTRIE le révèle.
 *
 * Ce fichier mesure donc, écran par écran, que toute commande cliquable tient
 * dans la fenêtre. Il ne remplace pas l'œil — il attrape la classe de défaut
 * qui échappe précisément au regard, parce qu'elle est hors-champ.
 *
 * Largeur de référence : 1440×900, le poste de travail décrit par
 * `06-PERF-BUDGET.md`.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";

async function rpc(page: Page, name: string, args: unknown): Promise<{ data?: unknown[] }> {
  const r = await page.request.post("/api/db/rpc", { data: { name, args } });
  return (await r.json()) as { data?: unknown[] };
}

async function login(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(OWNER_EMAIL);
  await page.getByLabel(/Mot de passe/i).fill(OWNER_PW);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

/**
 * Rend la liste des commandes qui dépassent, avec leur libellé — un nom lisible
 * vaut mieux qu'un compte : il dit QUOI corriger.
 */
async function commandesHorsCadre(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const large = window.innerWidth;
    const fautives: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
      const r = el.getBoundingClientRect();
      // Un élément replié (onglet inactif, menu fermé) n'a pas de surface : il
      // n'est pas « hors cadre », il est absent. On ne mesure que le visible.
      if (r.width === 0 || r.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      // Tolérance d'un pixel : les sous-pixels d'arrondi ne sont pas un défaut.
      if (r.right > large + 1 || r.left < -1) {
        const nom =
          el.getAttribute("aria-label") ??
          (el.textContent ?? "").trim().slice(0, 40) ??
          el.tagName;
        fautives.push(`${nom || el.tagName} [${Math.round(r.left)}→${Math.round(r.right)}]`);
      }
    }
    return fautives;
  });
}

const ECRANS: ReadonlyArray<readonly [string, string]> = [
  ["tableau de bord", "/tableauDeBord"],
  ["patients", "/patients"],
  ["agenda", "/agenda"],
  ["finances", "/finances"],
  ["documents", "/documents"],
];

test.describe("AUCUNE COMMANDE HORS CADRE — 1440×900", () => {
  for (const [nom, url] of ECRANS) {
    test(`H — ${nom}`, async ({ page }) => {
      await login(page);
      await page.goto(url);
      await page.waitForTimeout(1500);

      const fautives = await commandesHorsCadre(page);
      expect(fautives, `commandes hors cadre sur ${nom} :\n${fautives.join("\n")}`).toEqual([]);
    });
  }

  test("H — consultation, TOUS onglets ouverts", async ({ page }) => {
    /*
      Les écrans à identifiant dynamique ne peuvent pas figurer dans la liste
      ci-dessus. Or la consultation est justement celle qui a le plus changé en
      V9 : six onglets, dont trois montent des panneaux venus de l'écran
      Patient, conçus pour une largeur qui n'est pas la même ici. On les ouvre
      donc tous, et on mesure après chacun.
    */
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

    for (const nom of ["Séance", "Résumé", "Séances précédentes", "Traitement", "Documents", "Rendez-vous"]) {
      await page.getByRole("tab", { name: nom, exact: true }).click();
      await page.waitForTimeout(900);
      const fautives = await commandesHorsCadre(page);
      expect(fautives, `commandes hors cadre, onglet « ${nom} » :\n${fautives.join("\n")}`).toEqual(
        [],
      );
    }
  });

  test("H — aucun MONTANT tronque sur l ecran Finances", async ({ page }) => {
    /*
      UN MONTANT TRONQUÉ EST UN MONTANT FAUX.

      Les tuiles affichaient « 165 500 D… » et « 106 500 D… » : la valeur était
      `truncate` avec la valeur complète en infobulle. Mais une tuile de recette
      se lit au COUP D'ŒIL, et une infobulle ne se survole pas au coup d'œil.

      On mesure le débordement réel (`scrollWidth > clientWidth`) plutôt que
      l'apparence : c'est ce que fait le navigateur avant de poser les points de
      suspension, donc c'est la seule mesure qui ne dépende pas de la police.
    */
    await login(page);
    await page.goto("/finances");
    await page.waitForTimeout(2000);

    const coupees = await page.evaluate(() =>
      Array.from(document.querySelectorAll("p[title]"))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.getAttribute("title") ?? ""),
    );
    expect(coupees, `valeurs tronquees a l'ecran :\n${coupees.join("\n")}`).toEqual([]);
  });

  test("H — panneau Alexa ouvert", async ({ page }) => {
    await login(page);
    await page.goto("/tableauDeBord");
    await page.getByRole("button", { name: /Ouvrir Alexa/i }).click();
    await expect(page.getByRole("button", { name: /Envoyer/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);

    const fautives = await commandesHorsCadre(page);
    expect(fautives, `commandes hors cadre, panneau ouvert :\n${fautives.join("\n")}`).toEqual([]);
  });
});
