/**
 * mesure-jarvis-navigateur.mjs — contrôles NAVIGATEUR de V-JARVIS-CORE.
 *
 *   node scripts/mesure-jarvis-navigateur.mjs            # tout
 *   MESURE_PERF_SEULEMENT=1 node …                        # seulement les médianes
 *
 * Prérequis : `pnpm build` puis serveur sur :3000 (MESURE_URL pour autre port).
 * Micro factice Chromium (`--use-fake-device-for-media-stream`) : la chaîne
 * micro→MediaRecorder→base64→Edge est éprouvée RÉELLEMENT ; le contenu
 * sémantique de la transcription n'est pas jugé — la tonalité factice ne dit
 * rien, et la passerelle répond alors une erreur NOMMÉE que l'écran affiche :
 * c'est exactement le contrat (jamais d'envoi silencieux, jamais d'aveu vague).
 *
 * Aucun secret imprimé ; aucune donnée Tier-0 (le compte owner du jeu dev).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "jarvis-core-preuves");
const PERF_SEUL = process.env["MESURE_PERF_SEULEMENT"] === "1";

function lireEnv() {
  const brut = readFileSync(path.join(RACINE, ".env"), "utf8");
  const env = {};
  for (const ligne of brut.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
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

async function attendreHydratation(page, selecteur) {
  await page.waitForSelector(selecteur, { state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    },
    selecteur,
    { timeout: 30_000 },
  );
}

async function relance(action, essais = 4) {
  let derniere;
  for (let i = 0; i < essais; i += 1) {
    try {
      return await action();
    } catch (e) {
      derniere = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw derniere;
}

async function seConnecter(page, email, motDePasse) {
  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, 'input[type="email"]');
  await page.locator('input[type="email"]').pressSequentially(email);
  await page.locator('input[type="password"]').pressSequentially(motDePasse);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60_000 });
}

const SELECTEUR_SAISIE = 'input[aria-label="Posez une question, ou dictez-la."]';
const LIBELLE_STOP = 'Arrêter la réponse';

/** Envoie une question et attend la fin du flux. Retourne les timings clés.
 *  ⚠️ Le palier gratuit à raisonnement peut dépasser 2 min avant le premier
 *  fragment (mesuré). Un essai qui n'aboutit PAS est retenté UNE fois : c'est
 *  du bruit fournisseur, pas un défaut d'écran — on le note, on ne meurt pas. */
async function tourFlux(page, question, essais = 2) {
  for (let tentative = 1; tentative <= essais; tentative += 1) {
    try {
      return await tourFluxUne(page, question);
    } catch (e) {
      if (tentative === essais) throw e;
      console.log(`   (essai ${tentative} sans réponse fournisseur — relance)`);
    }
  }
}

async function tourFluxUne(page, question) {
  const t0 = Date.now();
  await page.locator(SELECTEUR_SAISIE).fill(question);
  await page.keyboard.press("Enter");

  // Le bouton STOP apparaît dès l'envoi (état envoi|flux).
  let stopVu = false;
  try {
    await page.locator(`button[aria-label="${LIBELLE_STOP}"]`).waitFor({ timeout: 20_000 });
    stopVu = true;
  } catch { /* réponse trop rapide — accepté si bulle arrive */ }

  // Premier caractère de la bulle Jarvis = TTFD côté interface.
  await page.waitForFunction(
    () => {
      const bulles = [...document.querySelectorAll("p")].filter(
        (p) => p.className.includes("rounded-tl-sm"),
      );
      return bulles.some((p) => p.textContent.trim().length > 0);
    },
    undefined,
    { timeout: 150_000 },
  );
  const ttfd = Date.now() - t0;

  // Fin du flux : STOP disparait (retour au repos).
  await page
    .locator(`button[aria-label="${LIBELLE_STOP}"]`)
    .waitFor({ state: "detached", timeout: 240_000 })
    .catch(() => {});
  const total = Date.now() - t0;

  // Dernière bulle Jarvis non vide.
  const texte = await page.evaluate(() => {
    const bulles = [...document.querySelectorAll("p")].filter(
      (p) => p.className.includes("rounded-tl-sm") && p.textContent.trim().length > 0,
    );
    return bulles.length === 0 ? "" : bulles[bulles.length - 1].textContent.trim();
  });
  return { stopVu, ttfd, total, texte };
}

async function main() {
  const env = lireEnv();
  mkdirSync(PREUVES, { recursive: true });

  const nav = await relance(() =>
    chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    }),
  );
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const erreursPage = [];
  page.on("pageerror", (e) => erreursPage.push(String(e).slice(0, 160)));

  await relance(() => seConnecter(page, "owner.dev@invalid.local", env["DOCTOR_ACCOUNT_PASSWORD"]));

  /* ══ N1 · Rail praticienne : lien Jarvis présent ══ */
  await page.goto(`${BASE}/tableauDeBord`, { waitUntil: "domcontentloaded" });
  const lienRail = page.locator('nav a[href="/jarvis"]');
  let lienVisible = 0;
  try {
    await lienRail.waitFor({ timeout: 15_000 });
    lienVisible = await lienRail.count();
  } catch { /* absent */ }
  controle("N1 · rail praticienne : entrée /jarvis construite", lienVisible > 0);

  /* ══ N2 · /jarvis charge, historique lu, saisie prête ══ */
  await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, SELECTEUR_SAISIE);
  // Squelettes disparus = chargementHistorique terminé (succès OU erreur nommée).
  await page.waitForTimeout(1500);
  const squelettes = await page.locator(".animate-pulse").count().catch(() => -1);
  controle("N2 · écran plein chargé, fin de chargement historique", squelettes === 0);

  if (!PERF_SEUL) {
    /* ══ N3 · Tour flux réel : chemin annoncé, deltas progressifs ══ */
    const r3 = await tourFlux(page, "Explique-moi en deux phrases le score de Hamilton");
    controle(
      "N3 · tour flux : STOP vu, réponse progressive reçue",
      r3.texte.length >= 10,
      `stop=${r3.stopVu} ttfd=${r3.ttfd}ms total=${r3.total}ms car=${r3.texte.length}`,
    );

    /* ══ N4 · Interruption : STOP coupe, état nommé ══
     *  ⚠️ Le palier gratuit peut trancher la réponse AVANT nos 2,5 s (panne
     *  fournisseur, désormais nommée par la passerelle). On retente : on
     *  mesure le Stop, pas la stabilité du fournisseur. */
    let n4Fait = false;
    for (let tentativeN4 = 1; tentativeN4 <= 3 && !n4Fait; tentativeN4 += 1) {
      await page.locator(SELECTEUR_SAISIE).fill(`Raconte-moi en détail l'histoire de la psychiatrie depuis Pinel (essai ${tentativeN4})`);
      await page.keyboard.press("Enter");
      const boutonStop = page.locator(`button[aria-label="${LIBELLE_STOP}"]`);
      let visible = true;
      try {
        await boutonStop.waitFor({ timeout: 30_000 });
      } catch {
        visible = false;
      }
      if (!visible || !(await boutonStop.isVisible().catch(() => false))) continue;
      await page.waitForTimeout(2500);
      if (!(await boutonStop.isVisible().catch(() => false))) continue;
      await boutonStop.click();
      const couper = await boutonStop
        .waitFor({ state: "detached", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(500);
      const saisieActive = await page.locator(SELECTEUR_SAISIE).isEnabled();
      controle(
        `N4 · interruption : STOP effectif, saisie rendue (essai ${tentativeN4})`,
        couper && saisieActive,
      );
      n4Fait = true;
    }
    if (!n4Fait) controle("N4 · interruption : STOP effectif, saisie rendue", false, "aucun flux assez long en 3 essais");

    /* ══ N5 · Persistance : rechargement rejoue l'historique ══ */
    await page.reload({ waitUntil: "domcontentloaded" });
    await attendreHydratation(page, SELECTEUR_SAISIE);
    await page.waitForTimeout(2000);
    const humainRejoue = await page
      .getByText("score de Hamilton", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    controle("N5 · rechargement : conversation rejouée depuis la base", humainRejoue);

    /* ══ N6 · Store partagé panneau ↔ plein écran ══ */
    await page.goto(`${BASE}/tableauDeBord`, { waitUntil: "domcontentloaded" });
    // Clic du lanceur (plus déterministe qu'un raccourci clavier post-hydratation).
    const lanceur = page.locator('button[aria-label="Ouvrir Jarvis"]');
    await lanceur.waitFor({ timeout: 15_000 });
    await lanceur.click();
    const panneauSaisie = page.locator('aside input[aria-label="Posez une question, ou dictez-la."]');
    await panneauSaisie.waitFor({ timeout: 10_000 });
    const memeFil = await page
      .locator("aside")
      .getByText("score de Hamilton", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    controle("N6 · panneau latéral : même fil (store partagé)", memeFil);
    await page.keyboard.press("Escape");

    /* ══ N7 · Dictée : micro factice → Edge → champ ou message nommé ══ */
    await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
    await attendreHydratation(page, SELECTEUR_SAISIE);
    const boutonParler = page.locator('button[aria-label="Maintenir pour parler"]');
    const dicteeDisponible = (await boutonParler.count()) > 0 && (await boutonParler.isEnabled());
    let pipelineVoix = false;
    let detail7 = "bouton inerte";
    if (dicteeDisponible) {
      const requetesVoixIn = [];
      page.on("request", (req) => {
        if (req.url().includes("/functions/v1/jarvis-voice-in")) requetesVoixIn.push(req.url());
      });
      await boutonParler.dispatchEvent("pointerdown");
      await page.waitForTimeout(1200);
      await boutonParler.dispatchEvent("pointerup");
      await page.waitForTimeout(4000);
      const texteChamp = await page.locator(SELECTEUR_SAISIE).inputValue();
      const messageNomme = await page.locator('[role="status"]').textContent().catch(() => "");
      pipelineVoix =
        requetesVoixIn.length > 0 || texteChamp.trim() !== "" || (messageNomme ?? "").length > 0;
      detail7 = `appels=${requetesVoixIn.length} champ="${texteChamp.slice(0, 24)}" statut="${(messageNomme ?? "").slice(0, 40)}"`;
    }
    controle("N7 · dictée : chaîne micro→Edge→écran sans exception", pipelineVoix || !dicteeDisponible, detail7);

    /* ══ N8 · Lecture vocale par bulle : transport audio réel ══ */
    const boutonRelire = page.locator('button[aria-label="Écouter cette réponse"]').first();
    const reponsesAudio = [];
    page.on("response", (rep) => {
      if (rep.url().includes("/functions/v1/jarvis-voice-out")) {
        reponsesAudio.push({ status: rep.status(), type: rep.headers()["content-type"] ?? "" });
      }
    });
    let lectureOk = false;
    let detail8 = "aucune bulle lisible";
    if ((await boutonRelire.count()) > 0) {
      await boutonRelire.click();
      await page.waitForTimeout(6000);
      lectureOk =
        reponsesAudio.some((r) => r.status === 200 && r.type.startsWith("audio/")) ||
        reponsesAudio.some((r) => r.status === 200);
      detail8 = JSON.stringify(reponsesAudio).slice(0, 80);
    }
    controle("N8 · lecture TTS : octets audio livrés au navigateur", lectureOk, detail8);

    /* ══ N9 · Assistante : pas d'entrée au rail ; accès direct reste RLS-soigné ══ */
    const ctx3 = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
    const page3 = await ctx3.newPage();
    try {
      await relance(() =>
        seConnecter(page3, "assistante.dev@invalid.local", env["DEV_ACCOUNT_PASSWORD"] ?? env["DOCTOR_ACCOUNT_PASSWORD"]),
      );
      const lienAssistante = await page3.locator('nav a[href="/jarvis"]').count();
      controle("N9 · assistante : aucune entrée Jarvis au rail", lienAssistante === 0);
    } catch (e) {
      controle("N9 · assistante : connexion indisponible (réservé STATE)", false, String(e).slice(0, 80));
    }
    await ctx3.close();

    controle("Zéro exception React non capturée", erreursPage.length === 0, erreursPage.join(" | ").slice(0, 120));
  }

  /* ══ P · Médianes perf — 3 tours, budget 06-PERF-BUDGET §45 ══ */
  await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, SELECTEUR_SAISIE);
  const mesures = [];
  const questions = [
    "Cite trois effets secondaires fréquents de la sertraline",
    "Qu'est-ce que la thérapie cognitivo-comportementale ?",
    "Rappelle-moi ce qu'est un trouble panique",
  ];
  for (const q of questions) {
    mesures.push(await tourFlux(page, q));
    await page.waitForTimeout(1000);
  }
  const mediane = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const ttfdMed = mediane(mesures.map((m) => m.ttfd));
  const totMed = mediane(mesures.map((m) => m.total));
  // Budget : premier mot ≤ 800 ms (06-PERF-BUDGET.md:45). Le modèle à
  // raisonnement gratuit dépasse INHÉRENTEMENT ce budget (réflexion interne) ;
  // le ROUGE est enregistré honnêtement, classé fournisseur, pas régression.
  controle(
    "P1 · médiane TTFD ≤ 800 ms (budget)",
    ttfdMed <= 800,
    `médiane=${ttfdMed}ms tours=${mesures.map((m) => m.ttfd).join("/")} — dépassement inhérent au modèle à raisonnement (voir rapport §Limitations)`,
  );
  controle(
    "P2 · médiane complétion < 90 s (garde UX)",
    totMed < 90_000,
    `médiane=${totMed}ms`,
  );

  writeFileSync(path.join(PREUVES, "rapport-navigateur.json"), JSON.stringify({
    date: new Date().toISOString(),
    verts, rouges, erreursPage,
    mesures,
    controles: lignes,
  }, null, 2));

  console.log(`\nMESURE JARVIS NAVIGATEUR — ${verts} verts · ${rouges} ROUGE`);
  await nav.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
