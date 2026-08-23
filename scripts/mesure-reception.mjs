/**
 * mesure-reception.mjs — les contrôles du lot COCKPIT qu'un grep ne rend pas.
 *
 *   node scripts/mesure-reception.mjs
 *
 * Prérequis : serveur de production sur :3000 (`next start`) et la fenêtre
 * assistante ouverte (`bash scripts/compte-assistante.sh`, garde ADR-016).
 *
 * Ce que seul un rendu réel prouve :
 *   1. le mobilier est là (rail + titre), donc l'écran est OBSERVÉ ;
 *   2. 1440×900 : zéro défilement DE PAGE (le conteneur qui défile est <main>,
 *      leçon STATE V7 — mesurer documentElement seul rendrait faux vert) ;
 *   3. la surface d'attention affiche au PLUS NEUF items (plafond dur du lot) ;
 *   4. AUCUN bouton d'actualisation : le live est un polling borné ;
 *   5. Ctrl+K reste réservé à Jarvis ;
 *   6. "/" met le focus sur la recherche (clavier gardé) ;
 *   7. fraîcheur SANS rechargement : le board se met à jour au retour sur
 *      l'onglet (branche `visibilitychange` du polling), preuve par injection
 *      réseau — aucune donnée réelle n'est mutée ;
 *   8. aucun marqueur clinique dans le DOM d'une session assistante ;
 *   9. prefers-reduced-motion éteint le mouvement ;
 *  10. les appels de données de l'ÉCRAN sont exactement deux :
 *      `rpc/reception_board` + table notifications (PERF §2/§3).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "reception-preuves");

const COMPTE = {
  email: "assistante.dev@invalid.local",
  varMdp: "DOCTOR_ACCOUNT_PASSWORD",
};

const MARQUEURS_CLINIQUES = [
  "motif de consultation",
  "diagnost",
  "ordonnance",
  "posolog",
  "transcription",
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

let verts = 0;
let rouges = 0;
const lignes = [];
function controle(label, ok, detail = "") {
  if (ok) {
    verts += 1;
    lignes.push(`vert   | ${label}${detail ? " | " + detail : ""}`);
  } else {
    rouges += 1;
    lignes.push(`ROUGE  | ${label}${detail ? " | " + detail : ""}`);
  }
  console.log(lignes[lignes.length - 1]);
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

  // ── Appels de données de l'écran ────────────────────────────────────────
  const appelsRest = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/rest/v1/")) {
      appelsRest.push(url.replace(/^.*\/rest\/v1\//, "").split("?")[0]);
    }
  });

  await seConnecter(page, env);

  // Capture du CORPS de chaque réponse board — posée AVANT la navigation,
  // sinon la première réponse (celle qu'on rejouera) échappe à l'instrument.
  let dernierBoard = null;
  page.on("response", async (res) => {
    if (res.url().includes("/rest/v1/rpc/reception_board")) {
      try { dernierBoard = await res.json(); } catch { /* réponse non JSON */ }
    }
  });

  // ── Navigation vers le cockpit ──────────────────────────────────────────
  const t0 = Date.now();
  await page.goto(`${BASE}/tableauDeBord`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, 'input[type="search"]');

  // Premier contenu : les compteurs du pulse (forme réelle du contenu).
  await page.waitForSelector("text=En salle d'attente", { timeout: 30_000 });
  const tContenu = Date.now() - t0;

  // Écran complet : la frise ou son état vide est rendu.
  await page
    .locator('[aria-label="Journée"]')
    .or(page.locator("text=Aucun rendez-vous aujourd'hui."))
    .first()
    .waitFor({ timeout: 30_000 });
  const tComplet = Date.now() - t0;

  controle("URL stable /tableauDeBord (pas une redirection)", page.url().endsWith("/tableauDeBord"));
  controle("mobilier observé : titre Poste d'accueil", await page.getByText("Poste d'accueil").count() > 0);

  // Durées des ressources RPC du board (performance entries).
  const dureesBoard = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/rest/v1/rpc/reception_board"))
      .map((e) => Math.round(e.duration)),
  );
  const dureeMaxBoard = dureesBoard.length > 0 ? Math.max(...dureesBoard) : -1;
  controle(
    "RPC reception_board dans le budget (≤ 500 ms)",
    dureeMaxBoard >= 0 && dureeMaxBoard <= 500,
    `${dureeMaxBoard} ms`,
  );
  controle(
    "appels de données de l’écran = board + notifications uniquement",
    appelsRest.some((u) => u.startsWith("rpc/reception_board"))
      && appelsRest.some((u) => u.startsWith("notifications"))
      && appelsRest.filter((u) => !u.startsWith("deployment")
        && !u.startsWith("profiles")
        && !u.startsWith("rpc/get_open_consultation")
        && !u.startsWith("rpc/reception_board")
        && !u.startsWith("notifications")).length === 0,
    `[${[...new Set(appelsRest)].join(", ")}]`,
  );

  // ── Zéro défilement de PAGE à 1440×900 ─────────────────────────────────
  const debordement = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    main: (() => {
      const m = document.querySelector("main");
      return m ? m.scrollHeight - m.clientHeight : -999;
    })(),
  }));
  controle(
    "1440×900 : zéro défilement de page (<main> compris)",
    debordement.doc <= 1 && debordement.main <= 1,
    `doc=${debordement.doc}px · main=${debordement.main}px`,
  );

  // ── Plafond ≤ 9 items actionnables ─────────────────────────────────────
  const nbAttention = await page.evaluate(() => {
    const zone = document.querySelector('[aria-label="Ce qui demande attention"]');
    if (!zone) return -1;
    const ul = zone.querySelector("ul");
    if (!ul) return 0; // état vide : rien d'actionnable
    return ul.querySelectorAll(":scope > li").length;
  });
  controle("surface d’attention ≤ 9 items", nbAttention >= 0 && nbAttention <= 9, `${nbAttention} item(s)`);

  // ── Aucun bouton d'actualisation ────────────────────────────────────────
  const boutonRefresh = await page.evaluate(() => {
    const interdits = /actualis|rafra[iî]ch|refresh/i;
    for (const b of document.querySelectorAll("button")) {
      const nom = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
      if (interdits.test(nom)) return nom;
    }
    return null;
  });
  controle("aucun bouton Actualiser/Rafraîchir", boutonRefresh === null, boutonRefresh ?? "");

  // ── Aucun marqueur clinique dans le DOM ─────────────────────────────────
  const fuites = await page.evaluate((marqueurs) => {
    const texte = document.body.innerText.toLowerCase();
    return marqueurs.filter((m) => texte.includes(m));
  }, MARQUEURS_CLINIQUES);
  controle("zéro marqueur clinique dans le DOM", fuites.length === 0, fuites.join(", "));

  // ── Clavier : "/" porte le focus recherche ──────────────────────────────
  await page.keyboard.press("Slash");
  const focusRecherche = await page.evaluate(
    () => document.activeElement?.getAttribute("type") === "search",
  );
  controle('touche "/" focus la recherche', focusRecherche);

  // ── Ctrl+K reste Jarvis ────────────────────────────────────────────────
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(400);
  const jarvisOuvert = await page.evaluate(() => document.body.innerText.includes("Jarvis"));
  controle("Ctrl+K ouvre Jarvis (réservé)", jarvisOuvert);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k"); // refermer si Escape ne suffit pas
  await page.keyboard.press("Escape");

  // ── Fraîcheur sans rechargement (branche visibilitychange) ─────────────
  // On rejoue la DERNIÈRE réponse capturée (posée avant navigation), enrichie
  // d'un RDV factice, au prochain appel déclenché par visibilitychange.
  // Le marqueur window.__mc_vivant prouve qu'AUCUN rechargement n'a eu lieu.

  await page.evaluate(() => { window.__mc_vivant = "pose"; });
  await page.route("**/rest/v1/rpc/reception_board*", async (route) => {
    if (dernierBoard !== null && Array.isArray(dernierBoard.journee)) {
      const corps = {
        ...dernierBoard,
        journee: [
          ...dernierBoard.journee,
          {
            id: "00000000-0000-4000-8000-mcrafraichi01",
            starts_at: new Date(Date.now() + 3600_000).toISOString(),
            ends_at: new Date(Date.now() + 3900_000).toISOString(),
            status: "confirmed",
            source: "assistant",
            kind: null,
            notes_admin: null,
            arrived_at: null,
            patient_id: null,
            record_number: "RAFRAÎCHI",
            first_name: "Test",
            last_name: "Rafraîchissement",
            practitioner_id: "00000000-0000-0000-0000-0000000000a2",
            practitioner_name: "Instrument",
          },
        ],
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corps) });
    } else {
      await route.continue();
    }
  });

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1500);

  const rafraichiSansRechargement = await page.evaluate(() => ({
    marqueur: window.__mc_vivant,
    visible: document.body.innerText.includes("Rafraîchissement"),
  }));
  controle(
    "board mis à jour SANS rechargement (visibilitychange)",
    rafraichiSansRechargement.marqueur === "pose"
      && rafraichiSansRechargement.visible,
  );
  await page.unroute("**/rest/v1/rpc/reception_board*");

  // ── Reduced motion : zéro animation vivante ────────────────────────────
  const animations = await page.evaluate(() => document.getAnimations().length);
  controle("prefers-reduced-motion : 0 animation vivante", animations === 0, `${animations}`);

  // Capture de preuve.
  await page.screenshot({ path: path.join(PREUVES, "cockpit-1440x900.png"), fullPage: false });

  // ── 1280 : utilisable, pas de débord horizontal ────────────────────────
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(400);
  const horiz = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  controle("1280 : zéro débordement horizontal", horiz.doc <= 1, `doc=${horiz.doc}px`);
  await page.screenshot({ path: path.join(PREUVES, "cockpit-1280.png"), fullPage: false });

  // ── Rapport ─────────────────────────────────────────────────────────────
  const rapport = {
    date: new Date().toISOString(),
    compte: COMPTE.email,
    timings: { premierContenuMs: tContenu, ecranCompletMs: tComplet, rpcReceptionBoardMs: dureesBoard },
    appelsRest: [...new Set(appelsRest)],
    resultats: lignes,
    verts,
    rouges,
  };
  writeFileSync(path.join(PREUVES, "rapport.json"), JSON.stringify(rapport, null, 2));

  console.log("");
  console.log(`MESURE RECEPTION — ${verts} verts · ${rouges} ROUGE`);
  console.log(`premier contenu : ${tContenu} ms · écran complet : ${tComplet} ms · board RPC max : ${dureeMaxBoard} ms`);
  console.log(`preuves : ${PREUVES}`);

  await navigateur.close();

  // Les durées brutes sont RAPPORTÉES, pas jugées ici : le budget §2 porte
  // l'appel RPC (contrôlé ci-dessus), pas la session ni la coquille.
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
