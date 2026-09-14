/**
 * CIVILITE IMPRIMEE — regression du defaut « Mr/Mme/Mlle » (088).
 *
 * Ce que ces tests verrouillent n est pas le resolveur SQL (la migration le
 * verifie deja dans son propre bloc `DO`), mais LE BOUT DE LA CHAINE : ce qui
 * s imprime reellement sur un certificat remis a un patient.
 *
 * Avant 088, `DOC-2026-00007` portait litteralement « Mr/Mme/Mlle NOM Prenom »
 * pour un patient HOMME — 045 §85-88 etait revenue au litteral pour retrouver
 * le texte Word d origine. C est ce document-la que C1 rend impossible.
 *
 * ⚠️ C2 et C3 couvrent la regle decidee le 2026-09-08 : « Mlle » n existe que
 * pour une femme CELIBATAIRE, et l absence de situation familiale vaut « Mme »
 * — jamais « Mlle ». Une inversion ici imprimerait une civilite que personne n
 * a saisie sur un document officiel.
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

interface Reponse {
  readonly ok: boolean;
  readonly code?: string;
  readonly data?: unknown[];
}

async function rpc(page: Page, name: string, args: unknown): Promise<Reponse> {
  const r = await page.request.post("/api/db/rpc", { data: { name, args } });
  return (await r.json()) as Reponse;
}

/** Un dossier complet : `issue_document` refuse sans sexe NI date de naissance. */
async function creerPatient(
  page: Page,
  sexe: "M" | "F",
  situation?: string,
): Promise<string> {
  const n = Date.now() % 100000;
  const r = await rpc(page, "create_patient", {
    p_charge: JSON.stringify({
      first_name: `Civilite${n}`,
      last_name: `Test${sexe}${n}`,
      phone: `055${String(n).padStart(7, "0")}`,
      birth_date: "1990-05-14",
      sex: sexe,
      ...(situation === undefined ? {} : { marital_status: situation }),
    }),
  });
  expect(r.ok, `create_patient: ${JSON.stringify(r)}`).toBe(true);
  return (r.data![0] as { id: string }).id;
}

/** Emet un certificat et rend son HTML rendu. */
async function emettre(page: Page, patientId: string): Promise<string> {
  const jour = new Date().toISOString().slice(0, 10);
  const emis = await rpc(page, "issue_document", {
    p_patient_id: patientId,
    p_doc_type: "justification",
    p_variables: JSON.stringify({ date_consultation: jour }),
    p_consultation_id: null,
  });
  expect(emis.ok, `issue_document: ${JSON.stringify(emis)}`).toBe(true);
  const lu = await rpc(page, "get_document", { p_id: emis.data![0] as string });
  expect(lu.ok).toBe(true);
  return (lu.data![0] as { rendered_html: string }).rendered_html;
}

test.describe("CIVILITE IMPRIMEE", () => {
  test("C1 aucun certificat ne porte plus les trois formes", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const html = await emettre(page, await creerPatient(page, "M"));

    // LA REGRESSION, ENONCEE DIRECTEMENT.
    expect(html).not.toContain("Mr/Mme/Mlle");
    expect(html).toContain("Mr ");
  });

  test("C2 femme sans situation renseignee : Mme, jamais Mlle", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const html = await emettre(page, await creerPatient(page, "F"));

    expect(html).not.toContain("Mr/Mme/Mlle");
    expect(html).toContain("Mme ");
    // Le defaut ne doit RIEN affirmer de plus que ce que le dossier sait.
    expect(html).not.toContain("Mlle ");
  });

  test("C3 femme celibataire : Mlle", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page);
    const patientId = await creerPatient(page, "F");

    const maj = await rpc(page, "update_patient", {
      p_id: patientId,
      p_changes: JSON.stringify({ marital_status: "celibataire" }),
    });
    expect(maj.ok, `update_patient: ${JSON.stringify(maj)}`).toBe(true);

    const html = await emettre(page, patientId);
    expect(html).not.toContain("Mr/Mme/Mlle");
    expect(html).toContain("Mlle ");
  });

  test("C4 la situation se saisit DES LA CREATION, et sort sur le certificat", async ({
    page,
  }) => {
    /*
      089. `create_patient` a sa PROPRE allowlist de cles et refuse toute cle
      inconnue : avant cette migration, la situation familiale ne pouvait pas
      etre saisie a l'ouverture d'un dossier, seulement apres coup. Un dossier
      neuf partait donc a NULL — donc « Mme » — meme pour une celibataire.
    */
    test.setTimeout(120_000);
    await login(page);
    const patientId = await creerPatient(page, "F", "celibataire");

    const html = await emettre(page, patientId);
    expect(html).not.toContain("Mr/Mme/Mlle");
    expect(html).toContain("Mlle ");
  });

  test("C5 le contrat d ecran PORTE la situation, sinon la fiche ne l affiche pas", async ({
    page,
  }) => {
    // `get_patient_workspace` rend un contrat jsonb explicite : une colonne
    // absente du contrat n'existe pas pour l'ecran, meme si la base la porte.
    await login(page);
    const patientId = await creerPatient(page, "F", "marie");

    const r = await rpc(page, "get_patient_workspace", { p_id: patientId });
    expect(r.ok).toBe(true);
    const espace = (r.data ?? [])[0] as { identite?: Record<string, unknown> };
    expect(espace.identite?.["marital_status"]).toBe("marie");
  });
});
