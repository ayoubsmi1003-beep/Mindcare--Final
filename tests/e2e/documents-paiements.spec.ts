/**
 * DOCUMENTS + PAIEMENTS — workflows metiers de bout en bout (owner).
 *
 * W1 documents : emission -> lecture figee -> marquage imprime -> liste.
 * W2 paiements : seance -> tarif -> cloture -> encaissement -> recette du jour,
 *   avec idempotence du double encaissement.
 * W3 assistante : encaissement operationnel autorise, analytique fermee
 *   (day_revenue vide, pas d'erreur).
 */
import { test, expect, type Page } from "@playwright/test";

const OWNER_EMAIL = "owner.dev@invalid.local";
const OWNER_PW = process.env.DEV_ACCOUNT_PASSWORD ?? "Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP";
const ASSISTANT_EMAIL = "assistante.dev@invalid.local";
const ASSISTANT_PW =
  process.env.ASSISTANT_ACCOUNT_PASSWORD ?? "VqTGuYVbmxNAsMY34ScmQ2M93lG2SBzj";
const PRATICIEN_OWNER = "00000000-0000-0000-0000-0000000000a1";

async function login(page: Page, email: string, pw: string): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel(/E-mail/i).fill(email);
  await page.getByLabel(/Mot de passe/i).fill(pw);
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients|\/tableauDeBord/, { timeout: 20_000 });
}

async function rpc(page: Page, name: string, args: Record<string, string | number | boolean | null>) {
  const r = await page.request.post("/api/db/rpc", {
    data: { name, args },
    timeout: 60_000,
  });
  return { status: r.status(), body: (await r.json()) as { ok: boolean; code?: string; data?: Array<unknown> } };
}

function uniquePhone(): string {
  return `0555${Math.floor(10000000 + Math.random() * 90000000)}`;
}

async function creerPatient(page: Page): Promise<string> {
  const phone = uniquePhone();
  const tag = Math.floor(Math.random() * 90000);
  // Dossier COMPLET (sexe + naissance) : la porte issue_document refuse
  // d'emettre sur un dossier incomplet (regle metier deliberee).
  const created = await rpc(page, "create_patient", {
    p_charge: JSON.stringify({
      first_name: `Doc${tag}`,
      last_name: `Flux${tag}`,
      phone,
      birth_date: "2004-09-11",
      sex: "M",
    }),
  });
  expect(created.body.ok, `create_patient: ${JSON.stringify(created.body)}`).toBe(true);
  return (created.body.data![0] as { id: string }).id;
}

async function creerRendezVous(page: Page, patientId: string): Promise<string> {
  for (let essai = 0; essai < 4; essai++) {
    const demain = new Date();
    demain.setDate(demain.getDate() + 1);
    demain.setHours(9 + Math.floor(Math.random() * 7), Math.floor(Math.random() * 4) * 15, 0, 0);
    const r = await rpc(page, "create_appointment", {
      p_patient_id: patientId,
      p_practitioner_id: PRATICIEN_OWNER,
      p_starts_at: demain.toISOString(),
      p_duration_minutes: 30,
    });
    if (r.body.ok) return r.body.data![0] as string;
    expect(r.body.code, `create_appointment: ${JSON.stringify(r.body)}`).toBe("conflit");
    await page.waitForTimeout(200);
  }
  throw new Error("aucun creneau libre apres 4 essais");
}

test.describe("DOCUMENTS + PAIEMENTS", () => {
  test("W1 document : emission -> lecture -> impression -> liste", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, OWNER_EMAIL, OWNER_PW);
    const patientId = await creerPatient(page);
    const jour = new Date().toISOString().slice(0, 10);

    const emis = await rpc(page, "issue_document", {
      p_patient_id: patientId,
      p_doc_type: "justification",
      p_variables: JSON.stringify({ date_consultation: jour }),
      p_consultation_id: null,
    });
    expect(emis.body.ok, `issue_document: ${JSON.stringify(emis.body)}`).toBe(true);
    const docId = emis.body.data![0] as string;

    const lu = await rpc(page, "get_document", { p_id: docId });
    expect(lu.body.ok).toBe(true);
    const doc = lu.body.data![0] as { doc_number: string; rendered_html: string; printed_count: number; status: string };
    expect(doc.doc_number.length).toBeGreaterThan(0);
    expect(doc.rendered_html.length).toBeGreaterThan(0);
    expect(doc.status).toBe("issued");

    const imprime = await rpc(page, "mark_document_printed", { p_id: docId });
    expect(imprime.body.ok).toBe(true);

    const relu = await rpc(page, "get_document", { p_id: docId });
    expect((relu.body.data![0] as { printed_count: number }).printed_count).toBe(1);

    const liste = await rpc(page, "list_patient_documents", { p_patient_id: patientId });
    expect(liste.body.ok).toBe(true);
    expect((liste.body.data as Array<{ document_id: string }>).some((d) => d.document_id === docId)).toBe(true);

    // L'ecran /documents affiche le dossier sans panne du service de donnees.
    await page.goto("/documents");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/momentanément indisponible/i);
  });

  test("W2 paiement : seance -> tarif -> cloture -> encaissement idempotent -> recette", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await login(page, OWNER_EMAIL, OWNER_PW);
    const patientId = await creerPatient(page);
    const appointmentId = await creerRendezVous(page, patientId);

    // Fermer une eventuelle seance ouverte restante d'un autre test.
    const ouverte = await rpc(page, "get_open_consultation", {});
    if (ouverte.body.ok && ouverte.body.data![0]) {
      const raw = ouverte.body.data![0] as unknown;
      const openId = typeof raw === "string" ? raw : (Object.values(raw as Record<string, unknown>)[0] as string);
      if (openId) {
        await rpc(page, "set_consultation_price", { p_consultation_id: openId, p_amount_dzd: 5000 });
        await rpc(page, "close_consultation", { p_id: openId });
      }
    }

    const demarree = await rpc(page, "start_consultation", {
      p_patient_id: patientId,
      p_appointment_id: appointmentId,
    });
    expect(demarree.body.ok, `start_consultation: ${JSON.stringify(demarree.body)}`).toBe(true);
    const consultationId = demarree.body.data![0] as string;

    const tarif = await rpc(page, "set_consultation_price", {
      p_consultation_id: consultationId,
      p_amount_dzd: 5000,
    });
    expect(tarif.body.ok, `set_consultation_price: ${JSON.stringify(tarif.body)}`).toBe(true);

    const cloturee = await rpc(page, "close_consultation", { p_id: consultationId });
    expect(cloturee.body.ok, `close_consultation: ${JSON.stringify(cloturee.body)}`).toBe(true);

    const paiement = await rpc(page, "get_consultation_payment", { p_consultation_id: consultationId });
    expect(paiement.body.ok).toBe(true);
    const paymentId = (paiement.body.data![0] as { payment_id: string }).payment_id;

    const encaisse1 = await rpc(page, "record_payment_collected", { p_payment_id: paymentId });
    expect(encaisse1.body.ok).toBe(true);
    // Idempotence : rejouer rend le meme identifiant, sans doublon.
    const encaisse2 = await rpc(page, "record_payment_collected", { p_payment_id: paymentId });
    expect(encaisse2.body.ok).toBe(true);
    expect(encaisse2.body.data![0]).toBe(encaisse1.body.data![0]);

    // La recette du jour porte l'encaissement : l'agregat day_revenue reste
    // coherent et la ligne est visible dans list_day_payments (montants
    // entiers, jamais de flottant).
    const jour = new Date().toISOString().slice(0, 10);
    const recette = await rpc(page, "day_revenue", { p_day: jour });
    expect(recette.body.ok).toBe(true);
    const lignes = await rpc(page, "list_day_payments", { p_day: jour });
    expect(lignes.body.ok).toBe(true);
    const montants = (lignes.body.data as Array<{ amount_dzd: number }>).map((l) => l.amount_dzd);
    expect(montants).toContain(5000);
    for (const m of montants) expect(Number.isInteger(m)).toBe(true);

    // L'ecran /finances affiche la journee sans panne.
    await page.goto("/finances");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/momentanément indisponible/i);
  });

  test("W3 assistante : encaissement operationnel oui, analytique non", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, OWNER_EMAIL, OWNER_PW);
    const patientId = await creerPatient(page);
    const appointmentId = await creerRendezVous(page, patientId);
    const demarree = await rpc(page, "start_consultation", {
      p_patient_id: patientId,
      p_appointment_id: appointmentId,
    });
    expect(demarree.body.ok).toBe(true);
    const consultationId = demarree.body.data![0] as string;
    await rpc(page, "set_consultation_price", { p_consultation_id: consultationId, p_amount_dzd: 4000 });
    await rpc(page, "close_consultation", { p_id: consultationId });
    const paiement = await rpc(page, "get_consultation_payment", { p_consultation_id: consultationId });
    const paymentId = (paiement.body.data![0] as { payment_id: string }).payment_id;

    // Bascule assistante : deconnexion puis reconnexion (pas de partage de session).
    await page.goto("/connexion");
    await login(page, ASSISTANT_EMAIL, ASSISTANT_PW);

    // L'encaissement operationnel est une voie legitime de la reception.
    const encaisse = await rpc(page, "record_payment_collected", { p_payment_id: paymentId });
    expect(encaisse.body.ok, `collecte assistante: ${JSON.stringify(encaisse.body)}`).toBe(true);

    // Mais l'analytique reste fermee : zero ligne, pas d'erreur.
    const jour = new Date().toISOString().slice(0, 10);
    const recette = await rpc(page, "day_revenue", { p_day: jour });
    expect(recette.body.ok).toBe(true);
    expect(recette.body.data).toEqual([]);
  });
});
