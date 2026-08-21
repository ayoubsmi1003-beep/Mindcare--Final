/**
 * mesure-finances-caisse — l'instrument de recette de /finances.
 *
 * Mesure ce que le contrat exige, et REND TROIS VERDICTS :
 *   vert    mesuré conforme
 *   ROUGE   mesuré non conforme
 *   BLOQUÉ  NON MESURÉ — jamais confondu avec un vert
 *
 * Un contrôle qui n'a pas pu s'exécuter est BLOQUÉ. C'est la leçon la plus
 * chère du dépôt : trois faux verdicts ont déjà été fabriqués par des
 * instruments qui rendaient « vert » là où ils n'avaient rien mesuré.
 *
 * ⚠️ À LANCER CONTRE `pnpm start` (build de PRODUCTION), jamais `pnpm dev` :
 * le serveur de développement compile à la demande, ses temps ne veulent rien
 * dire, et il a déjà produit un ROUGE de performance imaginaire ici.
 */

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const URL_BASE = process.env.MESURE_URL ?? "http://localhost:3000";
const SORTIE = "checkpoints/finances-caisse";

let verts = 0;
let rouges = 0;
let bloques = 0;

function vert(label, detail = "") {
  verts += 1;
  console.log(`vert   | ${label.padEnd(52)} | ${detail}`);
}
function rouge(label, detail = "") {
  rouges += 1;
  console.log(`ROUGE  | ${label.padEnd(52)} | ${detail}`);
}
function bloque(label, detail = "") {
  bloques += 1;
  console.log(`BLOQUÉ | ${label.padEnd(52)} | ${detail}`);
}

/** `.env` lu ligne à ligne — jamais `source`, jamais journalisé. */
function motDePasse() {
  try {
    for (const ligne of readFileSync(".env", "utf8").split("\n")) {
      if (ligne.startsWith("DEV_ACCOUNT_PASSWORD=")) {
        return ligne.slice("DEV_ACCOUNT_PASSWORD=".length).trim();
      }
    }
  } catch {
    return "";
  }
  return "";
}

const mdp = motDePasse();
if (mdp === "") {
  bloque("authentification", "DEV_ACCOUNT_PASSWORD absent de .env");
  console.log("\nVERDICT : BLOQUÉ — aucune mesure");
  process.exit(2);
}

mkdirSync(SORTIE, { recursive: true });

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const page = await contexte.newPage();

// Compteur d'appels de données. Remis à zéro APRÈS la connexion : les appels
// de la coquille et de l'authentification ne sont pas ceux de l'écran.
let appelsRpc = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/rest/v1/") || u.includes("/functions/v1/")) appelsRpc.push(u);
});

try {
  // ─── Connexion par l'interface réelle ────────────────────────────────────
  await page.goto(`${URL_BASE}/connexion`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const e = document.querySelector("input");
    return e !== null && Object.keys(e).some((k) => k.startsWith("__reactProps$"));
  }, { timeout: 20_000 });

  // `pressSequentially`, pas `fill` : `fill` ne déclenche pas onChange de React.
  await page.locator('input[type="email"]').pressSequentially("owner.dev@invalid.local");
  await page.locator('input[type="password"]').pressSequentially(mdp);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(patients|agenda)/, { timeout: 30_000 });
} catch (e) {
  bloque("authentification", `connexion impossible — ${String(e).slice(0, 80)}`);
  await navigateur.close();
  console.log("\nVERDICT : BLOQUÉ — aucune mesure");
  process.exit(2);
}

// ─── 1440×900 ──────────────────────────────────────────────────────────────
appelsRpc = [];
const t0 = Date.now();
await page.goto(`${URL_BASE}/finances`, { waitUntil: "networkidle" });
const duree = Date.now() - t0;

await page.waitForTimeout(1200);

// Le vrai conteneur qui defile est `<main>` (AppShell lui pose
// `overflow-y-auto`), pas `documentElement` : `<body>` est en `h-screen
// overflow-hidden`. Mesurer le document seul aurait rendu un vert sur un ecran
// qui defile pourtant sous les yeux de la medecin. On mesure LES DEUX.
const mesure1440 = await page.evaluate(() => {
  const d = {
    scrollV: Math.max(
      document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ...Array.from(document.querySelectorAll("main")).map(
        (m) => m.scrollHeight - m.clientHeight,
      ),
    ),
    scrollH: Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ...Array.from(document.querySelectorAll("main")).map(
        (m) => m.scrollWidth - m.clientWidth,
      ),
    ),
  };
  return { ...d, texte: document.body.innerText };
});

await page.screenshot({ path: `${SORTIE}/finances-1440x900.png` });

if (mesure1440.scrollV <= 1) {
  vert("1440×900 — aucun défilement vertical", `débord ${mesure1440.scrollV} px`);
} else {
  rouge("1440×900 — aucun défilement vertical", `débord ${mesure1440.scrollV} px`);
}

// ─── Un seul appel de données ──────────────────────────────────────────────
// La coquille émet ses propres appels (session, profil) : on ne compte que ceux
// qui portent une porte finance.
const appelsFinance = appelsRpc.filter((u) => /finance|charges|sessions_payments/.test(u));
if (appelsFinance.length === 1) {
  vert("un seul appel de données sur la vue d'ensemble", `${appelsFinance.length} appel`);
} else {
  rouge("un seul appel de données sur la vue d'ensemble", `${appelsFinance.length} appels`);
}

console.log(`INFO   | chargement complet de /finances                     | ${duree} ms`);

// ─── Vocabulaire bancaire : rien ne doit rester ────────────────────────────
const interdits = ["Facturé", "Encaissé", "En attente", "Taux d'encaissement", "Objectif"];
const restants = interdits.filter((m) => mesure1440.texte.includes(m));
if (restants.length === 0) {
  vert("aucun vocabulaire « facturé / encaissé / objectif »", "écran au comptant");
} else {
  rouge("aucun vocabulaire « facturé / encaissé / objectif »", restants.join(", "));
}

// ─── Aucun NaN, aucun état double ──────────────────────────────────────────
if (!mesure1440.texte.includes("NaN")) {
  vert("aucun NaN à l'écran", "");
} else {
  rouge("aucun NaN à l'écran", "un NaN est affiché");
}

// ─── 1280×720 ──────────────────────────────────────────────────────────────
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(900);
const mesure1280 = await page.evaluate(() => ({
  scrollV: Math.max(
    document.documentElement.scrollHeight - document.documentElement.clientHeight,
    ...Array.from(document.querySelectorAll("main")).map((m) => m.scrollHeight - m.clientHeight),
  ),
  scrollH: Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...Array.from(document.querySelectorAll("main")).map((m) => m.scrollWidth - m.clientWidth),
  ),
}));
await page.screenshot({ path: `${SORTIE}/finances-1280x720.png` });

if (mesure1280.scrollV <= 1) {
  vert("1280×720 — aucun défilement vertical", `débord ${mesure1280.scrollV} px`);
} else {
  rouge("1280×720 — aucun défilement vertical", `débord ${mesure1280.scrollV} px`);
}
if (mesure1280.scrollH <= 1) {
  vert("1280×720 — aucun défilement horizontal", `débord ${mesure1280.scrollH} px`);
} else {
  rouge("1280×720 — aucun défilement horizontal", `débord ${mesure1280.scrollH} px`);
}

// ─── Les onglets ───────────────────────────────────────────────────────────
await page.setViewportSize({ width: 1440, height: 900 });
for (const [libelle, fichier] of [
  ["Charges", "onglet-charges"],
  ["Séances & paiements", "onglet-seances"],
]) {
  try {
    appelsRpc = [];
    await page.getByRole("tab", { name: libelle }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SORTIE}/${fichier}.png` });
    const n = appelsRpc.filter((u) => /finance|charges|sessions_payments/.test(u)).length;
    if (n === 1) vert(`onglet « ${libelle} » — un seul appel`, `${n} appel`);
    else rouge(`onglet « ${libelle} » — un seul appel`, `${n} appels`);
  } catch (e) {
    bloque(`onglet « ${libelle} »`, String(e).slice(0, 70));
  }
}

// ─── Période sans aucune donnée ────────────────────────────────────────────
try {
  await page.goto(`${URL_BASE}/finances?du=2019-01-01&au=2019-01-31`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1200);
  const vide = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${SORTIE}/finances-periode-vide.png` });
  if (!vide.includes("NaN")) vert("période sans donnée — aucun NaN", "état vide propre");
  else rouge("période sans donnée — aucun NaN", "NaN affiché");
} catch (e) {
  bloque("période sans donnée", String(e).slice(0, 70));
}

await navigateur.close();

console.log("");
console.log(`VERDICT : ${verts} vert(s), ${rouges} ROUGE(s), ${bloques} BLOQUÉ(s)`);
console.log(`Preuves : ${SORTIE}/`);
process.exit(rouges > 0 ? 1 : bloques > 0 ? 2 : 0);
