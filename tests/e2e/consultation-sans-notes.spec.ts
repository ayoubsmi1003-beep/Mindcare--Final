/**
 * PREUVE NAVIGATEUR — clôture SANS notes (`regle-metier` n'est pas une panne).
 *
 * ═══ CE QUE CE SPEC PROUVE, ET À QUEL PRIX ═══
 *
 * Le défaut d'origine : clore une séance sans notes brutes affichait un
 * « Console Error » rouge (`jarvis.analyseSeance … regle-metier`) alors que
 * rien n'avait échoué, plus un message « elle se relance depuis la séance »
 * doublement faux. La preuve exige le VRAI leg d'analyse (route réelle +
 * base réelle, qui rend `regle-metier` à l'étape 3 AVANT tout appel modèle —
 * coût LLM nul sur ce leg) et observe la console DEV (en production `log.ts`
 * n'émet rien, l'assertion y serait vacuite — cf. `log.ts:66`).
 *
 * Le leg de résumé, lui, appellerait le modèle pour de vrai : il est
 * STUBBÉ (`/api/jarvis/jarvis-resume-cas` → enveloppe de succès). Ce qui est
 * prouvé reste honnête : le stub ne touche ni l'analyse, ni la console, ni
 * le message — et le message final `analyseSansObjet` n'apparaît QUE si le
 * résumé a abouti (`resume === "faite"` avec analyse `ignoree`), donc un
 * stub cassé ferait échouer le spec au lieu de le verdir à tort.
 */
import { test, expect } from "@playwright/test";

const CONNEXION = "/connexion";

async function login(page: import("@playwright/test").Page) {
  // Délai large : en `next dev`, la première compilation de la route peut
  // dépasser le `navigationTimeout` de 15 s du config (pré-chauffée par le
  // lanceur, mais sans garantie).
  await page.goto(CONNEXION, { timeout: 60_000 });
  await page.getByLabel(/E-mail/i).fill("owner.dev@invalid.local");
  await page.getByLabel(/Mot de passe/i).fill("Y1RWX2D5uNz0YqG7K2fljBs5KZrZohbP");
  await page.getByRole("button", { name: /Se connecter/i }).click();
  await expect(page).toHaveURL(/\/patients/, { timeout: 15_000 });
}

function uniquePhone(): string {
  return `0555${Math.floor(10000000 + Math.random() * 90000000)}`;
}

test.describe("CLÔTURE SANS NOTES — `regle-metier` silencieux au niveau error", () => {
  test("aucun console.error `jarvis.analyseSeance`, message sans-objet", async ({ page }) => {
    test.setTimeout(120_000);
    const erreursConsole: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") erreursConsole.push(msg.text());
    });
    page.on("pageerror", (err) => erreursConsole.push(String(err)));

    await login(page);

    // 1. Dossier via API (le formulaire UI `/patients/nouveau` ne redirige
    // pas dans cet environnement — constaté, cause non attribuée ; la pièce
    // sous test est la chaîne de clôture, pas le formulaire, et les autres
    // montages passent déjà par `/api/db/rpc` dans ce fichier).
    const phone = uniquePhone();
    const prenom = `SansNotes${Math.floor(Math.random() * 9000)}`;
    const nom = `Patient${Math.floor(Math.random() * 9000)}`;
    const patientResp = await page.request.post("http://localhost:3000/api/db/rpc", { timeout: 60_000,
      data: {
        name: "create_patient",
        args: {
          p_charge: JSON.stringify({ first_name: prenom, last_name: nom, phone }),
        },
      },
    });
    const patientBody = await patientResp.json();
    if (!patientBody.ok) throw new Error(`create_patient failed: ${JSON.stringify(patientBody)}`);
    const created = patientBody.data[0] as { id: string };
    const patientId = created.id;
    // Délai large : première compilation de la route dynamique en `next dev`.
    await page.goto(`/patients/${patientId}`, { timeout: 60_000 });
    await expect(page.locator("body")).toContainText(new RegExp(nom, "i"), { timeout: 15_000 });

    const practitionerId = "00000000-0000-0000-0000-0000000000a1";
    // Plusieurs essais sur des creneaux differents : la base est partagee
    // entre les specs et un autre test peut deja tenir le creneau —auquel
    // cas la porte rend legitimement `conflit` (garde anti-double-booking,
    // voir critical-chain.spec.ts qui applique le meme motif). Le `conflit`
    // est la preuve que la porte fonctionne, pas un echec du montage.
    let appointmentId: string | null = null;
    for (let essai = 0; essai < 4; essai++) {
      const demain = new Date();
      demain.setDate(demain.getDate() + 1);
      demain.setHours(9 + Math.floor(Math.random() * 7), Math.floor(Math.random() * 4) * 15, 0, 0);
      const createResp = await page.request.post("http://localhost:3000/api/db/rpc", { timeout: 60_000,
        data: {
          name: "create_appointment",
          args: {
            p_patient_id: patientId,
            p_practitioner_id: practitionerId,
            p_starts_at: demain.toISOString(),
            p_duration_minutes: 30,
          },
        },
      });
      const createBody = await createResp.json();
      if (createBody.ok) {
        appointmentId = createBody.data[0] as string;
        break;
      }
      if (createBody.code !== "conflit" || essai === 3) {
        throw new Error(`create_appointment failed: ${JSON.stringify(createBody)}`);
      }
      await page.waitForTimeout(200);
    }
    if (appointmentId === null) throw new Error("create_appointment: aucun creneau libre apres 4 essais");

    const startResp = await page.request.post("http://localhost:3000/api/db/rpc", { timeout: 60_000,
      data: { name: "start_consultation", args: { p_patient_id: patientId, p_appointment_id: appointmentId } },
    });
    const startBody = await startResp.json();
    if (!startBody.ok) throw new Error(`start_consultation failed: ${JSON.stringify(startBody)}`);
    const consultationId = startBody.data[0] as string;

    // 2. Le leg de résumé est stubbé (AUCUN appel modèle, coût nul) — voir
    // l'en-tête : le stub ne peut pas verdir le spec à tort.
    await page.route("**/api/jarvis/jarvis-resume-cas", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            resume: {
              id: "00000000-0000-0000-0000-0000000000ff",
              version: 1,
              genere_le: new Date().toISOString(),
              genere_par: null,
              content: {},
            },
          },
        }),
      });
    });

    // 3. Tarif exigé depuis 037, puis clôture SANS remplir la moindre note.
    await page.request.post("http://localhost:3000/api/db/rpc", { timeout: 60_000,
      data: { name: "set_consultation_price", args: { p_consultation_id: consultationId, p_amount_dzd: 5000 } },
    });
    await page.goto(`/consultation/${consultationId}`, { timeout: 60_000 });
    await expect(page.locator("body")).toContainText(/Notes de séance|Note clinique/i, { timeout: 15_000 });

    page.once("dialog", async (dialog) => await dialog.accept());
    await page.getByRole("button", { name: /Terminer la séance/i }).click();

    // 4. Le message final prouve la traversée complète : il n'apparaît que si
    // l'analyse est `ignoree` (vrai `regle-metier` serveur) ET le résumé
    // `faite` (stub abouti).
    await expect(page.locator("body")).toContainText(/Aucune note de séance à analyser/, {
      timeout: 30_000,
    });

    // 5. Et la console ne porte AUCUNE erreur d'analyse — le défaut d'origine.
    expect(erreursConsole.filter((t) => t.includes("jarvis.analyseSeance"))).toEqual([]);
  });
});
