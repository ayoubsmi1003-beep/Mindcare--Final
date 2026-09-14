/**
 * RESOLUTION DE ROLE — regression de l'incident « owner affiche Reception ».
 *
 * Contexte : deux migrations jamais appliquees (086, 087) faisaient echouer le
 * controle de demarrage sur CHAQUE requete /api/db/* (503 `indisponible`).
 * `getCurrentUser()` echouait donc, `utilisateur` valait `null`, et chaque
 * ecran retombait sur `?? "assistant"` — l'experience Reception pour le owner.
 *
 * Ces tests verrouillent la chaine complete :
 *   DB (role) -> backend (/api/db/*) -> session -> profil -> navigation -> dashboard
 *
 * Comptes : lus dans l'environnement quand il est pose (DEV/ASSISTANT), avec
 * repli sur les fixtures deja commises dans connexion.spec.ts — aucun secret
 * nouveau ici.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";
const ASSISTANT_EMAIL = "assistante.dev@invalid.local";
const ASSISTANT_PW =
  process.env.ASSISTANT_ACCOUNT_PASSWORD ?? "VqTGuYVbmxNAsMY34ScmQ2M93lG2SBzj";

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(email);
  await page.getByLabel(/Mot de passe/i).fill(password);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

function rpcNames(page: Page): string[] {
  const names: string[] = [];
  page.on("request", (r) => {
    if (!r.url().includes("/api/db/rpc")) return;
    try {
      const data = r.postDataJSON() as { name?: string } | null;
      if (data?.name) names.push(data.name);
    } catch {
      /* corps non JSON — ignore */
    }
  });
  return names;
}

test.describe("RESOLUTION DE ROLE — owner vs reception", () => {
  test("R1 owner : la chaine session -> profil rend role=owner (jamais indisponible)", async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);

    const session = await page.request.get("/api/auth/session");
    expect(session.ok()).toBe(true);
    const sessionBody = (await session.json()) as { ok: boolean; data: { userId: string } | null };
    expect(sessionBody.data).not.toBeNull();

    // Le profil DOIT se lire : un `indisponible` ici etait le symptome de l'incident.
    const profil = await page.request.post("/api/db/select", {
      data: {
        relation: "profiles",
        columns: ["id", "role", "full_name", "cabinet_id"],
        filters: [{ column: "id", op: "eq", value: sessionBody.data!.userId }],
        limit: 1,
      },
    });
    const profilBody = (await profil.json()) as {
      ok: boolean;
      code?: string;
      data?: Array<{ role: string }>;
    };
    expect(profilBody.ok, `profil illisible : ${JSON.stringify(profilBody)}`).toBe(true);
    expect(profilBody.data?.[0]?.role).toBe("owner");
  });

  test("R2 owner : /tableauDeBord affiche l'experience praticienne, pas la Reception", async ({
    page,
  }) => {
    const rpc = rpcNames(page);
    await login(page, OWNER_EMAIL, OWNER_PW);
    rpc.length = 0;
    await page.goto("/tableauDeBord");
    await expect(page.locator("body")).toContainText(/Bonjour Docteur/i, { timeout: 15_000 });
    // Pas le cockpit de reception…
    await expect(page.locator("body")).not.toContainText(/Poste d'accueil/i);
    // …et jamais le message de panne de l'incident.
    await expect(page.locator("body")).not.toContainText(/momentanément indisponible/i);
    // La navigation praticienne expose les ecrans Patients et Finances.
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: /Patients/i }).first()).toBeVisible();
    await expect(nav.getByRole("link", { name: /Finances/i }).first()).toBeVisible();
    // Le dashboard praticien interroge dashboard_today, pas reception_board.
    await page.waitForTimeout(1500);
    expect(rpc).toContain("dashboard_today");
    expect(rpc).not.toContain("reception_board");
  });

  test("R3 owner : reload conserve l'experience praticienne", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);
    await page.goto("/tableauDeBord");
    await expect(page.locator("body")).toContainText(/Bonjour Docteur/i, { timeout: 15_000 });
    await page.reload();
    await expect(page).toHaveURL(/\/tableauDeBord/);
    await expect(page.locator("body")).toContainText(/Bonjour Docteur/i, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/Poste d'accueil/i);
  });

  test("R4 assistante : /tableauDeBord affiche le cockpit, sans navigation clinique", async ({
    page,
  }) => {
    const rpc = rpcNames(page);
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);

    const profil = await page.request.post("/api/db/select", {
      data: {
        relation: "profiles",
        columns: ["id", "role"],
        filters: [{ column: "id", op: "eq", value: "00000000-0000-0000-0000-0000000000a3" }],
        limit: 1,
      },
    });
    const profilBody = (await profil.json()) as {
      ok: boolean;
      data?: Array<{ role: string }>;
    };
    expect(profilBody.ok).toBe(true);
    expect(profilBody.data?.[0]?.role).toBe("assistant");

    rpc.length = 0;
    await page.goto("/tableauDeBord");
    await expect(page.locator("body")).toContainText(/Poste d'accueil/i, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/Bonjour Docteur/i);
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: /Patients/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Finances/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /Agenda/i }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    expect(rpc).toContain("reception_board");
    expect(rpc).not.toContain("dashboard_today");
  });

  test("R5 assistante : frontieres API — operationnel oui, clinique non", async ({ page }) => {
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);
    const day = new Date().toISOString().slice(0, 10);

    // Le tableau de reception est la voie operationnelle legitime.
    const board = await page.request.post("/api/db/rpc", {
      data: { name: "reception_board", args: { p_day: day } },
    });
    expect(board.ok()).toBe(true);

    // Aucune lecture directe des relations sensibles (refus de reconnaissance).
    for (const relation of ["clinical_notes", "diagnoses", "payments"]) {
      const r = await page.request.post("/api/db/select", {
        data: { relation, columns: ["id"], limit: 1 },
      });
      expect(r.status(), `select ${relation}`).toBe(404);
    }

    // Aucun historique de notes cliniques via la porte dediee.
    const notes = await page.request.post("/api/db/rpc", {
      data: {
        name: "get_patient_notes_history",
        args: { p_patient_id: "00000000-0000-0000-0000-0000000000b1" },
      },
    });
    expect(notes.status()).toBe(404);
  });

  test("R6 sans session : 401 non-authentifie, jamais 503 indisponible", async ({ page }) => {
    // La signature de l'incident : le controle de demarrage barrait TOUT en 503,
    // y compris avant le controle de session. Sain, un anonyme recoit 401.
    const r = await page.request.post("/api/db/select", {
      data: { relation: "profiles", columns: ["id"], limit: 1 },
    });
    expect(r.status()).toBe(401);
    const body = (await r.json()) as { code?: string };
    expect(body.code).toBe("non-authentifie");
  });
});

/**
 * R7-R9 — LE MODE DE PANNE, ET NON PLUS SEULEMENT L ETAT DE LA BASE.
 *
 * R1-R6 verrouillent que la chaine FONCTIONNE quand la base est saine. Ils ne
 * disent rien du chemin qui, le jour de l incident, a transforme une panne de
 * lecture en changement de metier : `getCurrentUser()` rend `null` pour quatre
 * causes distinctes — pas de session, pas de ligne, role inconnu, transport en
 * panne — et `?? "assistant"` les traitait toutes comme un role assistante.
 *
 * Sur /agenda ce defaut etroit est juste : il n y change que le rail. Sur
 * /tableauDeBord il fait basculer d `app.dashboard_today` vers
 * `app.reception_board` : la praticienne recoit le poste d accueil.
 *
 * On simule donc la panne EXACTE de l incident — 503 sur la lecture de
 * `profiles`, session par ailleurs valide — et on exige que l ecran le DISE.
 */
test.describe("RESOLUTION DE ROLE — mode de panne", () => {
  /** 503 sur la seule lecture de `profiles`. Tout le reste passe normalement. */
  async function casserLectureProfil(page: Page): Promise<void> {
    await page.route("**/api/db/select", async (route) => {
      let relation: string | undefined;
      try {
        relation = (route.request().postDataJSON() as { relation?: string } | null)?.relation;
      } catch {
        relation = undefined;
      }
      if (relation !== "profiles") return route.continue();
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "indisponible" }),
      });
    });
  }

  test("R7 owner : un profil illisible n affiche JAMAIS le poste d accueil", async ({ page }) => {
    const rpc = rpcNames(page);
    await login(page, OWNER_EMAIL, OWNER_PW);

    await casserLectureProfil(page);
    rpc.length = 0;
    await page.goto("/tableauDeBord");

    // La regression de l incident, enoncee positivement.
    await expect(page.locator("body")).not.toContainText(/Poste d'accueil/i);
    // Et la porte de l autre metier ne doit surtout pas avoir ete interrogee.
    await page.waitForTimeout(1500);
    expect(rpc).not.toContain("reception_board");
  });

  test("R8 owner : l ecran DIT la panne au lieu de supposer un role", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);
    await casserLectureProfil(page);
    await page.goto("/tableauDeBord");

    // ERREUR remplace le contenu (UX_CONTRACT §1), avec le geste qui repare.
    // Le filtre sur le texte n est pas cosmetique : Next monte en permanence un
    // `role="alert"` VIDE (`__next-route-announcer__`) pour annoncer les
    // changements de route. Un `getByRole("alert")` nu resout donc deux
    // elements et echoue en mode strict, sans que le produit soit en cause.
    const erreur = page.getByRole("alert").filter({ hasText: /profil n'a pas pu être lu/i });
    await expect(erreur).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Réessayer/i })).toBeVisible();
  });

  test("R9 owner : Réessayer republie le tableau de bord une fois la lecture revenue", async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);
    await casserLectureProfil(page);
    await page.goto("/tableauDeBord");
    await expect(page.getByRole("button", { name: /Réessayer/i })).toBeVisible({
      timeout: 15_000,
    });

    // La panne cesse : le meme geste doit suffire, sans rechargement complet.
    await page.unroute("**/api/db/select");
    await page.getByRole("button", { name: /Réessayer/i }).click();

    await expect(page.locator("body")).toContainText(/Bonjour Docteur/i, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/Poste d'accueil/i);
  });
});
