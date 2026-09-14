/**
 * mesure-jarvis-phase5-alexa.mjs — PHASE 5 ALEXA : 14 questions du médecin,
 * au navigateur, sur données réelles (42 dossiers synthétiques cloud-dev),
 * avec un VRAI modèle (OpenRouter du .env).
 *
 * ═══ HYGIÈNE PII — PLUS STRICTE QUE LA PRÉCÉDENTE PASSE ═══
 * Aucune réponse n'est écrite sur disque ni imprimée : seuls des verdicts,
 * des longueurs et des nombres AGRÉGÉS déjà connus (13, 47000…) sortent.
 * Les UUID de dossiers restent en variables, jamais affichés. Les charges
 * client→serveur capturées servent aux contrôles de jetons en mémoire ;
 * la charge EXTERNE (serveur→fournisseur) est interceptée par le preload
 * (`capture-sortant.cjs`, NODE_OPTIONS du serveur mesuré) dans
 * `checkpoints/jarvis-phase5-preuves/charges-openrouter.txt`, comparée
 * ENSUITE en base (fuite SQL) — jamais lue ici.
 *
 *   node scripts/mesure-jarvis-phase5-alexa.mjs
 *   PHASE5_ALEXA=B1,B2 node scripts/mesure-jarvis-phase5-alexa.mjs
 *
 * Prérequis : `pnpm build` + serveur :3000 avec interception active.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "jarvis-phase5-preuves");
const CHOISIS = (process.env["PHASE5_ALEXA"] ?? "").split(",").filter((s) => s !== "");

// Attendus relevés en base le 2026-09-03 (comptes et sommes, aucune PII).
// Si la base change, ces nombres changent : le scénario rougit, on ré-ancre.
const ATTENDUS = {
  rdvAujourdhui: 13,
  rdvDemain: 1,
  encaisseAujourdhui: 47000,
  paiementsAttenteNombre: 3,
  paiementsAttenteTotal: 13000,
  attentionNombre: 14,
};

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
const LIBELLE_STOP = "Arrêter la réponse";
const SELECTEUR_PANNEAU = 'aside[aria-label="Alexa"]';

/**
 * Ouvre le panneau latéral s'il est fermé (bascule sinon — d'où la garde).
 * Le panneau partage le store avec `/jarvis`, mais LUI SEUL porte le bandeau
 * de contexte Phase 3, et LUI SEUL permet d'interroger SANS quitter la fiche
 * (quitter la fiche efface la cible : `effacerPatientActif` au démontage).
 */
async function ouvrirPanneau(page) {
  const panneau = page.locator(SELECTEUR_PANNEAU);
  let visible = false;
  try {
    visible = await panneau.isVisible();
  } catch {
    visible = false;
  }
  if (!visible) {
    await page.keyboard.press("Control+k");
    await panneau.waitFor({ state: "visible", timeout: 30_000 });
  }
}

// Les aveux honnêtes — `fr.jarvis.boucle` (`src/i18n/fr.ts`) : échec nommé,
// jamais d'hallucination, plus le fail-closed du pare-feu (`frontiere`).
// Recopiés EN LITTÉRAL, et c'est voulu : un oracle qui importerait la
// constante qu'il contrôle ne prouverait rien. Seule une ÉGALITÉ stricte
// sort d'ici (boolean), jamais le texte — aucune PII n'est journalisée.
const AVEUX_CONNUS = [
  "Je n'ai pas réussi à aboutir avec les informations dont je dispose. Rien n'a été modifié. Reformulez, ou demandez-moi un point précis.",
  "Cette demande a nécessité trop de consultations successives. Rien n'a été modifié. Posez-la en plusieurs fois.",
  "Cette demande a pris trop de temps. Rien n'a été modifié. Réessayez, ou demandez-moi un point plus précis.",
  "Je tourne en rond sur cette demande. Rien n'a été modifié. Reformulez-la autrement.",
  "Je n'ai pas pu traiter cette demande sans risquer d'exposer une donnée identifiante. Rien n'a été envoyé, rien n'a été modifié.",
];

async function tourFlux(page, question) {
  const t0 = Date.now();
  // ⚠️ FRAÎCHEUR D'ABORD. Les tours s'accumulent sur la même page ET l'historique
  // des conversations précédentes est rejoué au chargement : prendre « la dernière
  // bulle » sans repère, c'est relire le tour PRÉCÉDENT quand le courant échoue
  // sans bulle (erreur → bulle retirée, `conversation.ts`). Constaté : des tours
  // sans aucune persistance affichaient un texte « non vide » — celui d'avant.
  // Seules comptent les bulles APPARUES APRÈS l'envoi. Les alertes, elles, sont
  // fraîches par construction (`envoyer()` remet `interne.erreur` à null au départ).
  const avant = await page.evaluate(() => ({
    bulles: [...document.querySelectorAll("p")].filter(
      (p) => p.className.includes("rounded-tl-sm") && p.textContent.trim().length > 0,
    ).length,
  }));
  await page.locator(SELECTEUR_SAISIE).fill(question);
  await page.keyboard.press("Enter");
  try {
    await page.locator(`button[aria-label="${LIBELLE_STOP}"]`).waitFor({ timeout: 20_000 });
  } catch {
    /* réponse trop rapide — accepté si la bulle arrive */
  }
  let expire = false;
  try {
    // ⚠️ DEUX SURFACES, PAS UNE. Un tour qui échoue (fail-closed du pare-feu,
    // transport en panne, budget épuisé) ne rend AUCUNE bulle : `conversation.ts`
    // fait disparaître la bulle vide et l'erreur parle via `etat.erreur`, affiché
    // dans `div[role=alert] p` (`app/jarvis/page.tsx`). N'attendre que les bulles,
    // c'était expirer 180 s devant une réponse déjà affichée — puis enregistrer
    // deux verts VACUIFS sur `""` (constaté sur leVerdict B1 précédent).
    // ⚠️ ET SEULES LES NOUVELLES BULLES COMPTENT (voir `avant` ci-dessus).
    await page.waitForFunction(
      (n0) =>
        [...document.querySelectorAll("p")].filter(
          (p) => p.className.includes("rounded-tl-sm") && p.textContent.trim().length > 0,
        ).length > n0 ||
        [...document.querySelectorAll('div[role="alert"] p')].some(
          (p) => p.textContent.trim().length > 0,
        ),
      avant.bulles,
      { timeout: 180_000 },
    );
  } catch {
    expire = true;
  }
  try {
    await page
      .locator(`button[aria-label="${LIBELLE_STOP}"]`)
      .waitFor({ state: "detached", timeout: 240_000 })
      .catch(() => {});
  } catch {
    /* déjà parti */
  }
  // ⚠️ On ne sort que présence / longueur / classification / égalité à un aveu
  // connu. Le texte lui-même ne quitte jamais cette fonction que vers les
  // contrôles en mémoire — jamais vers le disque ni la console.
  // ⚠️ FRAÎCHEUR : seules les bulles apparues APRÈS l'envoi comptent. Sans bulle
  // fraîche et sans alerte, le texte est "" — un tour sans réponse affichée est
  // un fait, pas un blanc à remplir avec le tour précédent.
  const releve = await page.evaluate((n0) => {
    const bulles = [...document.querySelectorAll("p")]
      .filter((p) => p.className.includes("rounded-tl-sm") && p.textContent.trim().length > 0)
      .map((p) => p.textContent.trim());
    const nouvelles = bulles.slice(n0);
    if (nouvelles.length > 0)
      return { texte: nouvelles[nouvelles.length - 1], surface: "bulle", fraiche: true };
    const alertes = [...document.querySelectorAll('div[role="alert"] p')]
      .map((p) => p.textContent.trim())
      .filter((t) => t.length > 0);
    // Fraîche par construction : `envoyer()` efface l'erreur au départ du tour.
    if (alertes.length > 0) return { texte: alertes[alertes.length - 1], surface: "alerte", fraiche: true };
    return { texte: "", surface: "aucune", fraiche: false };
  }, avant.bulles);
  return {
    total: Date.now() - t0,
    texte: releve.texte,
    expire,
    surface: releve.surface,
    fraiche: releve.fraiche,
    aveuConnu: AVEUX_CONNUS.includes(releve.texte),
  };
}

/** Squelette commun : non vide, sans jeton brut, sans référence irrésolue. */
function saine(nom, r) {
  // ⚠️ LES DEUX CONTRÔLES NÉGATIFS EXIGENT UN TEXTE NON VIDE. Sur `""`, une
  // regex d'absence est verte PAR CONSTRUCTION — c'est exactement le faux vert
  // qui a fait passer B1 pour « carte cohérente » sans aucune réponse.
  controle(
    `${nom} · réponse non vide`,
    r.texte.length > 0,
    `${r.total} ms${r.expire ? " (expiration)" : ""} · surface:${r.surface} · fraiche:${r.fraiche ? "oui" : "non"}${r.aveuConnu ? " · aveu-connu" : ""}`,
  );
  controle(
    `${nom} · aucun jeton brut`,
    r.texte.length > 0 && !/\{\{[A-Z]+_\d+\}\}/.test(r.texte),
    "rendu identité ok",
  );
  controle(
    `${nom} · aucune référence irrésolue`,
    r.texte.length > 0 && !r.texte.includes("[référence inconnue]"),
    "carte cohérente",
  );
}

function actif(lettre) {
  return CHOISIS.length === 0 || CHOISIS.includes(lettre);
}

async function main() {
  const env = lireEnv();
  mkdirSync(PREUVES, { recursive: true });

  const nav = await relance(() => chromium.launch());
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  // Capture client→serveur : prouve la tokenisation AVANT notre serveur.
  // (La charge serveur→fournisseur est interceptée côté serveur — preload.)
  let charges = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/jarvis/") && req.method() === "POST") charges += 1;
  });
  page.on("response", (rep) => {
    const u = rep.url();
    if (u.includes("/api/jarvis/") && rep.status() >= 400) {
      console.log(`        [HTTP ${rep.status()}] ${u.replace(/^https?:\/\/[^/]+/, "").split("?")[0]}`);
    }
  });
  const erreursPage = [];
  page.on("pageerror", (e) => erreursPage.push(String(e).slice(0, 160)));

  // Compte owner.dev : son mot de passe est DEV_ACCOUNT_PASSWORD (diagnostiqué
  // le 2026-09-03 : DOCTOR_ACCOUNT_PASSWORD ne l'ouvre plus ; le spec e2e
  // J9 épingle le même secret en dur — on lit la clé, jamais la valeur).
  await relance(() => seConnecter(page, "owner.dev@invalid.local", env["DEV_ACCOUNT_PASSWORD"]));
  await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, SELECTEUR_SAISIE);

  /* ══ B1 · agenda du jour : 13 RDV ══ */
  if (actif("B1")) {
    console.log("\nB1 — agenda du jour");
    const r = await tourFlux(page, "Qu'est-ce que j'ai aujourd'hui dans mon agenda ?");
    saine("B1", r);
    controle("B1 · cite 13", new RegExp(`\\b${ATTENDUS.rdvAujourdhui}\\b`).test(r.texte), "compte base");
  }

  /* ══ B2 · prochain patient ══ */
  if (actif("B2")) {
    console.log("\nB2 — prochain patient");
    const r = await tourFlux(page, "Qui est mon prochain patient ?");
    saine("B2", r);
  }

  /* ══ B3 · demain : 1 RDV, pas d'invention ══ */
  if (actif("B3")) {
    console.log("\nB3 — rendez-vous de demain");
    const r = await tourFlux(page, "Montre-moi les rendez-vous de demain.");
    saine("B3", r);
    controle(
      "B3 · cite 1 (ni 0 ni inventé)",
      /\b1\b/.test(r.texte) || /un rendez-vous/i.test(r.texte),
      "compte base",
    );
    controle("B3 · ne dit pas « aucun »", !/(aucun|pas de rendez-vous|rien)/i.test(r.texte), "présence dite");
  }

  /* ══ B4 · Karim n'existe pas : l'absence est DITE ══ */
  if (actif("B4")) {
    console.log("\nB4 — Karim (absent de la base)");
    const r = await tourFlux(page, "Quand est la prochaine consultation de Karim ?");
    saine("B4", r);
    controle(
      "B4 · l'absence est dite, pas comblée",
      /(aucun|introuvable|ne correspond|pas de|trouve pas)/i.test(r.texte),
      "anti-hallucination",
    );
  }

  /* ══ S5 · encaissé : 47000 DA entiers ══ */
  if (actif("S5")) {
    console.log("\nS5 — encaissé du jour");
    const r = await tourFlux(page, "Combien ai-je encaissé aujourd'hui ?");
    saine("S5", r);
    controle("S5 · cite 47000", r.texte.includes(String(ATTENDUS.encaisseAujourdhui)), "somme base");
    controle("S5 · dinars entiers", !/\d[.,]\d{2}\b/.test(r.texte), "ADR-018");
    // DIAG hors verdict (booleans console uniquement, jamais persistés) : la typographie
    // française écrit « 47 000 », que le contrôle contigu ci-dessus ne voit pas.
    console.log(
      `    [diag] S5 · « 47 000 » espacé: ${/47\s?000/.test(r.texte) ? "oui" : "non"} · un chiffre quelconque: ${/\d/.test(r.texte) ? "oui" : "non"}`,
    );
  }

  /* ══ S6 · en attente : 3 / 13000 ══ */
  if (actif("S6")) {
    console.log("\nS6 — paiements en attente");
    const r = await tourFlux(page, "Quels paiements sont en attente ?");
    saine("S6", r);
    controle(
      "S6 · cite 3 ou 13000",
      /\b3\b/.test(r.texte) || r.texte.includes(String(ATTENDUS.paiementsAttenteTotal)),
      "compte/somme base",
    );
  }

  /* ══ S7 · attention : 14 payment_due ══ */
  if (actif("S7")) {
    console.log("\nS7 — attention requise");
    const r = await tourFlux(page, "Quels patients nécessitent mon attention ?");
    saine("S7", r);
    controle(
      "S7 · cite 14 ou « paiement »",
      r.texte.includes(String(ATTENDUS.attentionNombre)) || /paiement/i.test(r.texte),
      "natures base",
    );
  }

  /* ══ Contexte dossier n°1 ══ */
  let href1 = null;
  let href2 = null;
  if (["S8", "S9", "S10", "S11", "S12", "S13", "S14", "AB"].some(actif)) {
    await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const liens = await page.locator('a[href^="/patients/"]').all();
    const ids = [];
    for (const l of liens) {
      const href = await l.getAttribute("href");
      const m = /^\/patients\/([0-9a-f-]{36})$/.exec(href ?? "");
      if (m !== null && !ids.includes(m[1])) ids.push(m[1]);
    }
    controle("dossiers atteignables", ids.length >= 2, `${ids.length} dossiers (UUID non affichés)`);
    href1 = ids[0] ?? null;
    href2 = ids[1] ?? null;
  }

  let resume1 = "";
  if (href1 !== null && ["S8", "S9", "S10", "S11", "S12", "S13", "S14"].some(actif)) {
    // ⚠️ ON RESTE SUR LA FICHE. Naviguer vers `/jarvis` démonte la fiche, et le
    // démontage EFFACE la cible (`effacerPatientActif`) : les tours S9–S14
    // partaient sans cible, tombaient sur la clarification locale
    // (« De quel patient parlez-vous ? », zéro appel modèle), et AB comparait
    // deux fois la même phrase statique. Le panneau partage le store : on
    // interroge DEDANS, cible vivante.
    await page.goto(`${BASE}/patients/${href1}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await ouvrirPanneau(page);
    await attendreHydratation(page, SELECTEUR_SAISIE);

    if (actif("S8")) {
      console.log("\nS8 — bandeau de contexte Phase 3");
      // ⚠️ LE BANDEAU NE VIT QUE DANS LE PANNEAU (`PanneauJarvis`, `role=status`),
      // jamais sur `/jarvis` plein écran. Le chercher là-bas, c'était le rater
      // par construction. Le texte (qui porte un nom) reste en mémoire : seuls
      // des booleans sortent.
      const bandeau = await page
        .locator(`${SELECTEUR_PANNEAU} div[role="status"]`)
        .first()
        .textContent()
        .catch(() => "");
      controle("S8 · bandeau « Contexte » visible", /Contexte/.test(bandeau ?? ""), "cible écran→boucle");
      controle("S8 · âge affiché", /il y a|instant/.test(bandeau ?? ""), "TTL explicite");
    }
    if (actif("S9")) {
      console.log("\nS9 — résumé du dossier (contexte écran)");
      const r = await tourFlux(page, "Résume-moi son dossier.");
      saine("S9", r);
      resume1 = r.texte;
    }
    if (actif("S10")) {
      console.log("\nS10 — dernières séances");
      saine("S10", await tourFlux(page, "Quelles sont ses dernières séances ?"));
    }
    if (actif("S11")) {
      console.log("\nS11 — médicaments en cours");
      saine("S11", await tourFlux(page, "Quels médicaments prend-elle actuellement ?"));
    }
    if (actif("S12")) {
      console.log("\nS12 — qu'est-ce qui a changé");
      saine("S12", await tourFlux(page, "Qu'est-ce qui a changé depuis la dernière consultation ?"));
    }
    if (actif("S13")) {
      console.log("\nS13 — dernières notes");
      saine("S13", await tourFlux(page, "Lis-moi les dernières notes de cette patiente."));
    }
    if (actif("S14")) {
      console.log("\nS14 — documents du dossier");
      saine("S14", await tourFlux(page, "Quels documents ont été émis pour cette patiente ?"));
    }
  }

  /* ══ AB · dossier n°2 : remplacement, pas accumulation ══ */
  if (actif("AB") && href2 !== null) {
    console.log("\nAB — changement de dossier");
    await page.goto(`${BASE}/patients/${href2}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await ouvrirPanneau(page);
    await attendreHydratation(page, SELECTEUR_SAISIE);
    const r = await tourFlux(page, "Résume-moi son dossier.");
    saine("AB", r);
    if (resume1 !== "") {
      controle("AB · pas la réponse du dossier n°1", r.texte !== resume1, "cible remplacée");
    }
  }

  controle("charges client→serveur capturées", charges > 0, `${charges} POST /api/jarvis/`);
  controle("zéro exception React non capturée", erreursPage.length === 0, erreursPage.join(" | ").slice(0, 120));

  writeFileSync(
    path.join(PREUVES, "verdicts-alexa.json"),
    JSON.stringify({ verts, rouges, lignes, attendus: ATTENDUS }, null, 2),
    "utf8",
  );

  await nav.close();
  console.log(`\nVERDICT ALEXA : ${rouges === 0 ? "VERT" : `ROUGE — ${rouges} contrôle(s)`} (${verts} vert(s))`);
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ÉCHEC INSTRUMENT :", e);
  process.exit(2);
});
