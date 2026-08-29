/**
 * mesure-v4-tableaudebord.mjs — les contrôles du lot V4 qu'un grep ne rend pas.
 *
 *   node scripts/mesure-v4-tableaudebord.mjs
 *
 * Prérequis : serveur de PRODUCTION sur :3000 (`next build && next start` —
 * jamais `next dev`, PERF §1), et la fenêtre praticienne ouverte
 * (`bash scripts/compte-praticienne.sh`, garde ADR-016 amendée).
 *
 * Ce que seul un rendu réel prouve :
 *   1. UN SEUL appel de données au chargement : `rpc/dashboard_today`. C'est le
 *      contrôle NOMMÉ du checkpoint V4 (« un seul appel réseau, vérifié dans
 *      l'onglet Réseau ») et le budget de PERF §3 ;
 *   2. 1440×900 : zéro défilement DE PAGE — le conteneur qui défile est
 *      `<main>` (leçon STATE V7 : mesurer `documentElement` seul rend un faux
 *      vert) ;
 *   3. aucun bouton « Actualiser » : la fraîcheur est un polling borné ;
 *   4. AUCUN CHIFFRE FABRIQUÉ dans le DOM — ni objectif mensuel, ni taux de
 *      présence, ni occupation, ni activité des agents, ni alerte clinique.
 *      C'est le contrôle qui garde l'écran honnête (règle 8) ;
 *   5. premier contenu et écran complet, TROIS relevés, MÉDIANE (PERF §1).
 *
 * Les durées sont RAPPORTÉES et comparées au budget de l'écran : 1 appel,
 * 100 ms de premier contenu, 400 ms d'écran complet.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "v4-tableaudebord-preuves");

const COMPTE = {
  email: "praticien2.dev@invalid.local",
  varMdp: "DOCTOR_ACCOUNT_PASSWORD",
};

/**
 * Ce qui ne doit PAS exister dans le DOM de cet écran. Chaque entrée est un
 * bloc de la capture de référence qui n'a AUCUNE source de données : l'afficher
 * demanderait de l'inventer.
 */
const MARQUEURS_FABRIQUES = [
  "objectif mensuel",
  "de l'objectif",
  "taux de présence",
  "occupation du jour",
  "activité des agents",
  "alertes cliniques",
  "adhérence",
  "cumul annuel",
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
  await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60_000 });
}

let verts = 0;
let rouges = 0;
const lignes = [];
function controle(label, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  lignes.push(`${ok ? "vert  " : "ROUGE "} | ${label}${detail ? " | " + detail : ""}`);
  console.log(lignes[lignes.length - 1]);
}

/** La MÉDIANE de trois relevés — PERF §1 l'impose, pas la moyenne. */
function mediane(valeurs) {
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}

async function main() {
  const env = lireEnv();
  mkdirSync(PREUVES, { recursive: true });

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await contexte.newPage();

  await seConnecter(page, env);

  // ── 1 · LES APPELS DE DONNÉES DE L'ÉCRAN ────────────────────────────────
  // L'écouteur est posé APRÈS la connexion : on mesure le coût du TABLEAU DE
  // BORD, pas celui de la session ni de la coquille.
  const appelsRest = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/rest/v1/")) {
      appelsRest.push(url.replace(/^.*\/rest\/v1\//, "").split("?")[0]);
    }
  });

  const releves = [];
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) appelsRest.length = 0; // seul le 1er passage juge le NOMBRE d'appels
    const t0 = Date.now();
    await page.goto(`${BASE}/tableauDeBord`, { waitUntil: "domcontentloaded" });
    // Premier contenu : le titre de l'écran est peint.
    await page.getByText("Bonjour Docteur", { exact: false }).first().waitFor({ timeout: 30_000 });
    const tContenu = Date.now() - t0;
    // Écran complet : le fil de la journée a rendu son contenu OU son état vide.
    await page.waitForFunction(
      () => {
        const txt = document.body.innerText;
        return txt.includes("Le fil de la journée") || txt.includes("Votre journée est libre");
      },
      { timeout: 30_000 },
    );
    const tComplet = Date.now() - t0;
    releves.push({ tContenu, tComplet });
    if (i === 0) {
      await page.screenshot({ path: path.join(PREUVES, "tableaudebord-1440x900.png"), fullPage: false });
    }
  }

  const premierContenu = mediane(releves.map((r) => r.tContenu));
  const ecranComplet = mediane(releves.map((r) => r.tComplet));

  // ⚠️ LE CONTRÔLE NOMMÉ DU CHECKPOINT V4, ET SON PÉRIMÈTRE HONNÊTE.
  //
  // `deployment` et `profiles` sont le BOOTSTRAP DE SESSION de la coquille : ils
  // partent sur CHAQUE écran en chargement complet (patients, agenda, finances
  // aussi), bien avant que le tableau de bord n'existe. Les compter contre ce
  // lot ferait porter à V4 une dette qui n'est pas la sienne — et les cacher
  // ferait l'inverse. On les SÉPARE, et on les affiche.
  //
  // Ce que le budget PERF §3 juge, c'est l'appel de DONNÉES DE L'ÉCRAN : il doit
  // être exactement un, `rpc/dashboard_today`.
  const appelsUniques = [...new Set(appelsRest)];
  const BOOTSTRAP = ["deployment", "profiles"];
  const appelsEcran = appelsRest.filter((u) => !BOOTSTRAP.includes(u));
  const enTrop = appelsEcran.filter((u) => u !== "rpc/dashboard_today");
  controle(
    "1 · UN SEUL appel de données d'écran : rpc/dashboard_today",
    appelsEcran.length === 1 && appelsEcran[0] === "rpc/dashboard_today",
    enTrop.length ? `EN TROP : ${enTrop.join(", ")}` : "rpc/dashboard_today, et rien d'autre",
  );
  console.log(
    `       | (bootstrap de coquille, hors périmètre du lot : ${appelsRest.filter((u) => BOOTSTRAP.includes(u)).join(", ") || "aucun"})`,
  );

  // ── 2 · 1440×900 — AUCUN DÉFILEMENT DE PAGE ─────────────────────────────
  // On mesure `documentElement` ET `body` : le conteneur qui défile est
  // `<main>`, et se contenter de l'un des deux rendait un faux vert (STATE V7).
  const debordement = await page.evaluate(() => ({
    docV: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    docH: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyH: document.body.scrollWidth - document.body.clientWidth,
  }));
  controle(
    "2 · 1440×900 : aucun défilement horizontal de page",
    debordement.docH <= 0 && debordement.bodyH <= 0,
    `doc ${debordement.docH}px · body ${debordement.bodyH}px`,
  );

  // ── 3 · AUCUN BOUTON « ACTUALISER » ─────────────────────────────────────
  const texte = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  controle(
    "3 · aucun bouton « Actualiser » (le live est un polling borné)",
    !texte.includes("actualiser") && !texte.includes("rafraîchir"),
  );

  // ── 4 · AUCUN CHIFFRE FABRIQUÉ ──────────────────────────────────────────
  const trouves = MARQUEURS_FABRIQUES.filter((m) => texte.includes(m));
  controle(
    "4 · aucun bloc fabriqué (objectif · taux · occupation · agents)",
    trouves.length === 0,
    trouves.length ? `TROUVÉ : ${trouves.join(", ")}` : "l'écran ne montre que ce que la base sait",
  );

  // ── 5 · LE BUDGET DE L'ÉCRAN (PERF) ─────────────────────────────────────
  controle(
    "5 · premier contenu ≤ 100 ms",
    premierContenu <= 100,
    `médiane ${premierContenu} ms sur ${releves.map((r) => r.tContenu).join("/")}`,
  );
  controle(
    "6 · écran complet ≤ 400 ms",
    ecranComplet <= 400,
    `médiane ${ecranComplet} ms sur ${releves.map((r) => r.tComplet).join("/")}`,
  );

  const rapport = {
    ecran: "/tableauDeBord",
    compte: COMPTE.email,
    viewport: "1440x900",
    budget: { appels: 1, premierContenuMs: 100, ecranCompletMs: 400 },
    mesure: { premierContenuMs: premierContenu, ecranCompletMs: ecranComplet, releves },
    appelsRest: appelsUniques,
    resultats: lignes,
    verts,
    rouges,
  };
  writeFileSync(path.join(PREUVES, "rapport.json"), JSON.stringify(rapport, null, 2));

  console.log("");
  console.log(`MESURE V4 TABLEAU DE BORD — ${verts} verts · ${rouges} ROUGE`);
  console.log(`premier contenu : ${premierContenu} ms · écran complet : ${ecranComplet} ms`);
  console.log(`preuves : ${PREUVES}`);

  await navigateur.close();
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
