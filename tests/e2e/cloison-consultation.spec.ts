/**
 * CLOISON DES PORTES OUVERTES PAR LA SOUS-NAVIGATION V9.
 *
 * POURQUOI CE FICHIER EXISTE. Le lot A a rendu atteignables, DEPUIS l'écran de
 * consultation, cinq portes qui n'y étaient pas appelées :
 * `get_patient_workspace`, `list_patient_timeline`, `get_consultation`,
 * `get_consultation_analysis` et `get_patient_treatments`. Aucune n'est neuve,
 * mais leur surface d'usage a changé — et une surface qui change se re-teste.
 *
 * ⚠️ CE QUI EST VÉRIFIÉ ICI N'EST PAS L'INTERFACE, C'EST LA BASE. On tape sur
 * `/api/db/rpc` directement, sans passer par un écran : masquer un onglet ne
 * protège rien (règle 4), et un test qui cliquerait dans l'application ne
 * prouverait que le masquage.
 *
 * ⚠️ DEUX RÉGIMES DE REFUS, ET LES CONFONDRE FAIT UN TEST FAUX. La première
 * version de ce fichier exigeait un 404 des CINQ portes. `get_patient_workspace`
 * rend 200 — et c'est CORRECT : c'est la porte d'identité, dont l'assistante a
 * légitimement besoin pour l'accueil. Elle ne filtre pas le clinique, elle ne le
 * PORTE PAS : `app.can_see_clinical` décide en base (081 §35) et les domaines
 * `clinique` et `traitements_v2` sortent à `null` (081 §42, §54). C'est la
 * composition par rôle d'I12 — un contrat distinct, pas un champ masqué.
 *
 * S1 vérifie donc le CONTENU, ce qui est plus fort qu'un code de statut : un
 * jour où quelqu'un ajouterait un diagnostic au contrat sans le conditionner,
 * un test sur le 404 resterait vert et la fuite passerait.
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";
const ASSISTANT_EMAIL = "assistante.dev@invalid.local";
const ASSISTANT_PW =
  process.env.ASSISTANT_ACCOUNT_PASSWORD ?? "VqTGuYVbmxNAsMY34ScmQ2M93lG2SBzj";

const PATIENT = "00000000-0000-0000-0000-0000000000b1";

async function login(page: Page, email: string, pw: string): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(email);
  await page.getByLabel(/Mot de passe/i).fill(pw);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

/** Les portes CLINIQUES : l'assistante ne doit pas même les voir exister. */
const PORTES_CLINIQUES = [
  { nom: "get_consultation", args: { p_id: "00000000-0000-0000-0000-0000000000c1" } },
  {
    nom: "get_consultation_analysis",
    args: { p_consultation_id: "00000000-0000-0000-0000-0000000000c1" },
  },
  { nom: "get_patient_treatments", args: { p_patient_id: PATIENT } },
];

test.describe("CLOISON — portes de la sous-navigation V9", () => {
  test("S1 assistante : la porte d identite repond, SANS porter de clinique", async ({ page }) => {
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);

    const r = await page.request.post("/api/db/rpc", {
      data: { name: "get_patient_workspace", args: { p_id: PATIENT } },
    });
    expect(r.status()).toBe(200);

    const corps = (await r.json()) as { ok: boolean; data?: unknown[] };
    const espace = (corps.data ?? [])[0] as Record<string, unknown> | undefined;
    test.skip(espace === undefined, "dossier b1 absent de cette base");

    // LE CŒUR DU TEST : les domaines cliniques sortent NULS de la base.
    expect(espace!["clinique"], "clinique doit etre null pour l assistante").toBeNull();
    expect(espace!["traitements_v2"], "traitements_v2 doit etre null").toBeNull();

    // Et rien de clinique ne doit trainer ailleurs dans la charge, meme en
    // profondeur : on cherche les mots qui n ont aucune raison d y etre.
    const brut = JSON.stringify(espace).toLowerCase();
    for (const interdit of ["diagnos", "icd", "subjective", "assessment", "posologie"]) {
      expect(brut, `« ${interdit} » ne doit pas figurer dans le contrat assistante`).not.toContain(
        interdit,
      );
    }
  });

  test("S2-S4 assistante : aucune ligne clinique, par QUELQUE couche que ce soit", async ({
    page,
  }) => {
    /*
      ⚠️ ON VÉRIFIE LA PROPRIÉTÉ, PAS LE MÉCANISME — ET LA PREMIÈRE VERSION DE CE
      TEST S'EST TROMPÉE DEUX FOIS EN EXIGEANT UN 404.

      Deux couches refusent, et elles ne rendent pas le même code :
        · l'allowlist de `/api/db/rpc` répond 404 pour les noms qu'un rôle n'a
          pas le droit de prononcer — refus de RECONNAISSANCE ;
        · la RLS laisse l'appel passer (200) et rend ZÉRO LIGNE — refus de
          LECTURE, celui d'ADR-003, qui ne distingue pas « introuvable » de
          « hors périmètre ».

      Les deux sont corrects. Exiger l'un des deux fabrique un test qui casse
      quand la défense se DÉPLACE, alors que la garantie, elle, tient. Ce qui
      doit rester vrai est plus simple et plus fort : **l'assistante ne reçoit
      aucune ligne clinique**, quel que soit le chemin du refus.
    */
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);

    for (const porte of PORTES_CLINIQUES) {
      const r = await page.request.post("/api/db/rpc", {
        data: { name: porte.nom, args: porte.args },
      });
      const corps = (await r.json()) as { ok: boolean; data?: unknown[] };
      const lignes = corps.data ?? [];

      expect(
        [404, 200],
        `${porte.nom} : statut inattendu ${r.status()}`,
      ).toContain(r.status());
      expect(lignes, `${porte.nom} a rendu ${lignes.length} ligne(s) a l'assistante`).toHaveLength(
        0,
      );
    }
  });

  test("S8 assistante : la frise ne rend QUE l operationnel, filtre par la RLS", async ({
    page,
  }) => {
    /*
      ⚠️ CETTE PORTE N'A AUCUN `IF` DE RÔLE, ET C'EST CORRECT.

      `list_patient_timeline` (078) est SECURITY DEFINER mais appartient à
      `app_gatekeeper`, un rôle SANS BYPASSRLS : les `UNION ALL` qui la
      composent (consultations, diagnostics, prescriptions, échelles…) sont donc
      filtrés par la RLS, qui évalue `auth.uid()` de l'APPELANT. La cloison est
      en base, pas dans une condition JavaScript — règle 4, littéralement.

      Contrairement à `get_patient_workspace`, elle ne calcule donc pas
      `can_see_clinical` : elle n'en a pas besoin. Ce test existe pour que cette
      absence reste un CHOIX vérifié, et non un oubli que personne ne rattrape.

      Mesuré le 2026-09-08 : assistante → `rdv` seulement ; owner → `rdv`,
      `consultation`, `note`.
    */
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);

    const r = await page.request.post("/api/db/rpc", {
      data: {
        name: "list_patient_timeline",
        args: { p_id: PATIENT, p_before_at: null, p_before_id: null, p_limit: 50 },
      },
    });
    expect(r.status()).toBe(200);
    const corps = (await r.json()) as { ok: boolean; data?: unknown[] };
    const lignes = (corps.data ?? []) as Array<{ event_type?: string }>;
    test.skip(lignes.length === 0, "aucun evenement sur b1 dans cette base");

    const types = [...new Set(lignes.map((l) => l.event_type))];
    for (const clinique of ["consultation", "note", "diagnostic", "prescription", "echelle"]) {
      expect(types, `l'assistante ne doit voir aucun evenement « ${clinique} »`).not.toContain(
        clinique,
      );
    }
    // Le rendez-vous, lui, est son métier : la porte ne doit pas non plus
    // devenir muette, sinon l'accueil perd sa donnée opérationnelle.
    expect(types).toContain("rdv");
  });

  test("S6 praticienne : un id de consultation inexistant rend zero ligne, pas une erreur", async ({
    page,
  }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);

    // Un UUID qui n'existe pas. La porte doit se taire, exactement comme pour
    // une consultation d'une consoeur : c'est ce silence COMMUN qui empeche de
    // deduire l'existence d'un dossier qu'on n'a pas le droit de voir (ADR-003).
    const r = await page.request.post("/api/db/rpc", {
      data: { name: "get_consultation", args: { p_id: "11111111-2222-3333-4444-555555555555" } },
    });
    const corps = (await r.json()) as { ok: boolean; data?: unknown[] };
    expect(r.ok()).toBe(true);
    expect(corps.ok).toBe(true);
    expect(corps.data ?? []).toHaveLength(0);
  });

  test("S7 praticienne : la chronologie d un dossier inexistant ne fuit rien", async ({ page }) => {
    await login(page, OWNER_EMAIL, OWNER_PW);

    const r = await page.request.post("/api/db/rpc", {
      data: {
        name: "list_patient_timeline",
        args: {
          p_id: "11111111-2222-3333-4444-555555555555",
          p_before_at: null,
          p_before_id: null,
          p_limit: 10,
        },
      },
    });
    const corps = (await r.json()) as { ok: boolean; data?: unknown[] };
    expect(corps.data ?? []).toHaveLength(0);
  });
});
