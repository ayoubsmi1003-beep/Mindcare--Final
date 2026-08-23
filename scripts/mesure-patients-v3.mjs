/**
 * mesure-patients-v3.mjs — mesure de performance des écrans Patients V3,
 * sur le patron `mesure-reception.mjs` (contrat T2 de clôture).
 *
 *   node scripts/mesure-patients-v3.mjs
 *
 * Prérequis : serveur de PRODUCTION sur :3000 (`next build` puis `next start`,
 * jamais `next dev`) et fenêtre …a2 ouverte (compte-praticienne.sh, ADR-016).
 *
 * Méthode 06-PERF §1 :
 *   - médiane de TROIS navigations par écran, chaque navigation repart de zéro ;
 *   - appels REST comptés SÉPARÉMENT : COQUILLE (deployment · profiles ·
 *     rpc/get_open_consultation — dette §3 antérieure, hors périmètre) vs
 *     ÉCRAN ;
 *   - premier contenu mesuré par l'API Paint du navigateur
 *     (`first-contentful-paint`) — §2 : les 100 ms « ne dépendent d'aucun
 *     réseau », c'est le squelette qui est jugé, pas l'aller-retour base.
 *
 * Budgets d'ACCEPTATION V3 : fiche 2 appels · 100 ms FCP · 500 ms complet ;
 * /patients 1 appel · 400 ms ; création complète ≤ 60 s + numéro P-nnnx.
 * ⚠️ TERMINOLOGIE (consigne de clôture) : ces seuils ne remplacent pas la cible
 * constitutionnelle Phase-1 « ouverture d'un dossier < 1 s », inchangée.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "v3-preuves");
const PATIENT_FIXTURE =
  process.argv[2] ?? "00000000-0000-0000-0000-0000000000b2";

/** Compte …a2 — la praticienne de 015 (fenêtre ADR-016 ouverte pour la session). */
const COMPTE = {
  email: "praticien2.dev@invalid.local",
  varMdp: "DOCTOR_ACCOUNT_PASSWORD",
};

const COQUILLE = [
  (u) => u.startsWith("deployment"),
  (u) => u.startsWith("profiles"),
  (u) => u.startsWith("rpc/get_open_consultation"),
];

function lireEnv() {
  const brut = readFileSync(path.join(RACINE, ".env"), "utf8");
  const env = {};
  for (const ligne of brut.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

async function attendreHydratation(page, selecteur) {
  await page.waitForSelector(selecteur, { state: "visible" });
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    },
    selecteur,
    { timeout: 30_000 },
  );
}

async function seConnecter(page, env) {
  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, 'input[type="email"]');
  await page.locator('input[type="email"]').pressSequentially(COMPTE.email);
  await page.locator('input[type="password"]').pressSequentially(env[COMPTE.varMdp] ?? "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/patients/, { timeout: 60_000 });
}

function mediane(valeurs) {
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}

/** FCP du document courant — lu APRÈS l'écran complet, il ne bouge plus. */
async function lireFcp(page) {
  return page.evaluate(() => {
    const entrees = performance.getEntriesByType("paint");
    const fcp = entrees.find((e) => e.name === "first-contentful-paint");
    return fcp !== undefined ? Math.round(fcp.startTime) : -1;
  });
}

/**
 * UNE navigation chronométrée. Compteurs réinitialisés à chaque passage :
 * on veut les appels DE CETTE navigation, jamais un cumul.
 */
async function navigerEtMesurer(page, chemin, selecteurComplet) {
  const appels = [];
  const capteur = (req) => {
    const url = req.url();
    if (url.includes("/rest/v1/") || url.includes("/auth/v1/")) {
      appels.push(
        url.includes("/auth/v1/")
          ? "(auth)"
          : url.replace(/^.*\/rest\/v1\//, "").split("?")[0],
      );
    }
  };
  page.on("request", capteur);
  try {
    const t0 = Date.now();
    await page.goto(`${BASE}${chemin}`, { waitUntil: "domcontentloaded" });
    await page.locator(selecteurComplet).first().waitFor({ timeout: 30_000 });
    const tComplet = Date.now() - t0;
    const fcp = await lireFcp(page);
    return { tComplet, fcp, appels: [...appels] };
  } finally {
    page.off("request", capteur);
  }
}

function classer(appels) {
  const ecran = appels.filter(
    (u) => u !== "(auth)" && !COQUILLE.some((estCoquille) => estCoquille(u)),
  );
  return { ecran: [...new Set(ecran)], coquilleNb: appels.length - ecran.length };
}

let verts = 0;
let rouges = 0;
const lignes = [];
function controle(label, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  lignes.push({ verdict: ok ? "vert" : "ROUGE", label, detail });
  console.log(`${ok ? "vert  " : "ROUGE "} | ${label}${detail ? " | " + detail : ""}`);
}

async function main() {
  const env = lireEnv();
  mkdirSync(PREUVES, { recursive: true });

  const nav = await chromium.launch();
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  await seConnecter(page, env);

  // ── Écran /patients — budget : 1 appel écran · 100 ms FCP · 400 ms ──────
  const essaisListe = [];
  for (let i = 0; i < 3; i++) {
    // Première ligne de l'annuaire OU l'état vide honnête : les deux prouvent
    // que l'écran a FINI, qu'il n'est plus en chargement.
    essaisListe.push(
      await navigerEtMesurer(
        page,
        "/patients",
        '#recherche-patients',
        'main a[href^="/patients/"], text=Aucun dossier visible dans votre périmètre.',
      ),
    );
  }
  const liste = {
    fcpMediane: mediane(essaisListe.map((e) => e.fcp)),
    completMediane: mediane(essaisListe.map((e) => e.tComplet)),
    ...classer(essaisListe.flatMap((e) => e.appels)),
    bruts: essaisListe.map(({ fcp, tComplet }) => ({ fcp, tComplet })),
  };
  controle("/patients · appels ÉCRAN ≤ 1", liste.ecran.length <= 1, `[${liste.ecran.join(", ")}] (+${liste.coquilleNb} coquille)`);
  controle("/patients · FCP ≤ 100 ms (médiane 3)", liste.fcpMediane >= 0 && liste.fcpMediane <= 100, `${liste.fcpMediane} ms`);
  controle("/patients · complet ≤ 400 ms (médiane 3)", liste.completMediane <= 400, `${liste.completMediane} ms`);

  // ── Écran fiche patient — budget : 2 appels écran · 100 ms FCP · 500 ms ─
  const essaisFiche = [];
  for (let i = 0; i < 3; i++) {
    essaisFiche.push(
      await navigerEtMesurer(page, `/patients/${PATIENT_FIXTURE}`, '[aria-label="Aujourd\'hui"]'),
    );
  }
  const fiche = {
    fcpMediane: mediane(essaisFiche.map((e) => e.fcp)),
    completMediane: mediane(essaisFiche.map((e) => e.tComplet)),
    ...classer(essaisFiche.flatMap((e) => e.appels)),
    bruts: essaisFiche.map(({ fcp, tComplet }) => ({ fcp, tComplet })),
  };
  controle("fiche patient · appels ÉCRAN ≤ 2", fiche.ecran.length <= 2, `[${fiche.ecran.join(", ")}] (+${fiche.coquilleNb} coquille)`);
  controle("fiche patient · FCP ≤ 100 ms (médiane 3)", fiche.fcpMediane >= 0 && fiche.fcpMediane <= 100, `${fiche.fcpMediane} ms`);
  controle("fiche patient · complet ≤ 500 ms (médiane 3)", fiche.completMediane <= 500, `${fiche.completMediane} ms`);

  // ── Création complète — budget : ≤ 60 s, redirection + numéro P-nnnx ────
  const t0Creation = Date.now();
  await page.goto(`${BASE}/patients/nouveau`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, "form input");
  const suffixe = Date.now().toString().slice(-6);
  await page.getByLabel("Prénom", { exact: true }).fill("Sonde");
  await page.getByLabel("Nom", { exact: true }).fill(`Perf${suffixe}`);
  await page.getByLabel("Téléphone", { exact: true }).fill("05 00 99 88 77");
  await page.getByRole("button", { name: "Créer le dossier" }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const numero = await page.getByText(/^P-\d{4}$/).first().textContent({ timeout: 30_000 });
  const dureeCreation = Date.now() - t0Creation;
  const numeroNet = (numero ?? "").trim();
  controle("création complète · redirection fiche + numéro P-nnnx", /^P-\d{4}$/.test(numeroNet), `numéro=« ${numeroNet} »`);
  controle("création complète · ≤ 60 s", dureeCreation <= 60_000, `${dureeCreation} ms`);

  await ctx.close();
  await nav.close();

  const rapport = {
    date: new Date().toISOString(),
    methode: "next start (production) · médiane de 3 · FCP via API Paint · appels coquille/écran séparés",
    budgets:
      "ACCEPTATION V3 : fiche 2 appels/100 ms FCP/500 ms · liste 1 appel/400 ms · création ≤ 60 s. " +
      "La cible constitutionnelle Phase-1 (< 1 s ouverture dossier) reste INCHANGÉE et distincte.",
    liste,
    fiche,
    creation: { dureeMs: dureeCreation, numero: numeroNet },
    resultats: lignes,
    verts,
    rouges,
  };
  writeFileSync(path.join(PREUVES, "rapport-perf.json"), JSON.stringify(rapport, null, 2));

  console.log("");
  console.log(`MESURE PATIENTS V3 — ${verts} verts · ${rouges} ROUGE`);
  console.log(`liste    : FCP=${liste.fcpMediane} ms · complet=${liste.completMediane} ms · écran=[${liste.ecran.join(",")}]`);
  console.log(`fiche    : FCP=${fiche.fcpMediane} ms · complet=${fiche.completMediane} ms · écran=[${fiche.ecran.join(",")}]`);
  console.log(`création : ${dureeCreation} ms · numéro « ${numeroNet} »`);
  console.log(`preuves  : ${PREUVES}`);
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
