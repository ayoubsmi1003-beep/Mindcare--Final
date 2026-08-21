#!/usr/bin/env node
/**
 * mesure-v6-finance — l'écran /finances dans un vrai Chromium, en session.
 *
 *   MESURE_COMPTE=praticienne node scripts/mesure-v6-finance.mjs
 *
 * ⚠️ CE FICHIER NE REMPLACE PAS `mesure-v3-navigateur.mjs`. Celui-là mesure le
 * CONTRASTE, le FOCUS et le MOUVEMENT RÉDUIT sur tous les écrans, et il reste la
 * base de non-régression V3 : il tourne inchangé. Celui-ci mesure ce que V3 ne
 * pouvait pas connaître — la vérité financière telle qu'elle est RENDUE.
 *
 * ⚠️ CE QU'IL VÉRIFIE, ET POURQUOI AU NAVIGATEUR PLUTÔT QU'EN SQL.
 * Le checkpoint SQL prouve que la PORTE réconcilie. Il ne prouve pas que
 * l'ÉCRAN affiche ce que la porte a rendu. Entre les deux il y a un service, un
 * schéma Zod, un formateur de montants et un composant — quatre endroits où un
 * chiffre juste peut devenir un chiffre faux. On relit donc les montants DANS
 * LE DOM et on refait l'addition.
 *
 * ⚠️ TROIS VERDICTS. `vert` mesuré conforme · `ROUGE` mesuré non conforme ·
 * `BLOQUÉ` NON MESURÉ. Un écran qui redirige vers /connexion n'est ni vert ni
 * rouge : il n'a pas été regardé. C'est le faux rouge que V3 a documenté le
 * 2026-08-20, et il ne se refait pas ici.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "v6-preuves");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";

const COMPTE =
  process.env["MESURE_COMPTE"] === "praticienne"
    ? { email: "praticien2.dev@invalid.local", varMdp: "DOCTOR_ACCOUNT_PASSWORD" }
    : { email: "owner.dev@invalid.local", varMdp: "DEV_ACCOUNT_PASSWORD" };

let verts = 0;
let rouges = 0;
let bloques = 0;

function vert(l, d = "") { console.log(`  vert   | ${l.padEnd(52)} | ${d}`); verts += 1; }
function rouge(l, d = "") { console.log(`  ROUGE  | ${l.padEnd(52)} | ${d}`); rouges += 1; }
function bloque(l, d = "") { console.log(`  BLOQUÉ | ${l.padEnd(52)} | ${d}`); bloques += 1; }

/**
 * ⚠️ UN CONTRÔLE DONT LA CONDITION EST `null`/`undefined` N'EST PAS VERT.
 * Une valeur absente n'a rien prouvé. Sans cette branche, un sélecteur qui ne
 * trouve rien rendrait `undefined === undefined` et passerait pour un succès —
 * le faux vert exact que les instruments de ce dépôt ont déjà fabriqué.
 */
function controle(label, condition, detail = "") {
  if (condition === null || condition === undefined) {
    bloque(label, `${detail} (valeur absente — rien n'a été mesuré)`);
  } else if (condition) {
    vert(label, detail);
  } else {
    rouge(label, detail);
  }
}

/** Lit `.env` sans le journaliser — le mot de passe ne sort jamais d'ici. */
async function motDePasse() {
  const { readFileSync } = await import("node:fs");
  const contenu = readFileSync(path.join(RACINE, ".env"), "utf8");
  const ligne = contenu.split(/\r?\n/).find((l) => l.startsWith(`${COMPTE.varMdp}=`));
  return ligne === undefined ? null : ligne.slice(COMPTE.varMdp.length + 1).trim();
}

/**
 * Les montants sont écrits « 1 842 500 DZD » avec une espace fine insécable
 * (U+202F) posée par `formaterDzd`. On la retire pour comparer des nombres —
 * et on ne réimplémente PAS le formatage : on lit ce que l'écran a écrit.
 */
function montantDepuisTexte(texte) {
  if (typeof texte !== "string") return null;
  const nettoye = texte.replace(/[  \s]/g, "").replace("DZD", "");
  if (!/^-?\d+$/.test(nettoye)) return null;
  return Number.parseInt(nettoye, 10);
}

/**
 * Attend que React ait ACCROCHÉ ses écouteurs au champ — piège de mesure connu,
 * documenté dans `mesure-v3-navigateur.mjs` et repayé ici.
 *
 * La présence du nœud dans le DOM ne prouve RIEN : le HTML du serveur le
 * contient déjà, écouteurs absents. Frapper les touches avant l'hydratation
 * produit un envoi VIDE — donc un échec d'authentification qui ressemble à un
 * mauvais mot de passe, alors que le mot de passe n'a jamais été transmis.
 */
async function attendreHydratation(page, selecteur) {
  await page.waitForSelector(selecteur, { state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    },
    selecteur,
    { timeout: 60_000 },
  );
}

mkdirSync(PREUVES, { recursive: true });

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const page = await contexte.newPage();

console.log("");
console.log("═══ MESURE V6-FINANCE — NAVIGATEUR RÉEL, SESSION AUTHENTIFIÉE ═══");
console.log("");

// ---------------------------------------------------------------------------
// Connexion — sans session, tout le reste est NON MESURÉ, pas rouge
// ---------------------------------------------------------------------------
try {
  const mdp = await motDePasse();
  if (mdp === null || mdp === "") throw new Error(`${COMPTE.varMdp} absent de .env`);

  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await attendreHydratation(page, 'input[type="email"]');
  // `pressSequentially` et non `fill` : on FRAPPE les touches, ce qui déclenche
  // les `onChange` de React (motif repris de la mesure V3).
  await page.locator('input[type="email"]').pressSequentially(COMPTE.email);
  await page.locator('input[type="password"]').pressSequentially(mdp);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/patients/, { timeout: 60_000 });
} catch (e) {
  bloque("session", `connexion impossible : ${String(e).slice(0, 110)}`);
  console.log("");
  console.log("─── 0 vert · 0 ROUGE · 1 BLOQUÉ ───");
  console.log("Sans session, /finances redirige : RIEN n'a été observé.");
  console.log("Ouvrir le compte : bash scripts/compte-praticienne.sh");
  await navigateur.close();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// /finances
// ---------------------------------------------------------------------------
// ⚠️ LE BUDGET SE MESURE, IL NE SE DÉCLARE PAS.
// `06-PERF-BUDGET.md` §2 plafonne /finances à UN appel serveur, et §6 est
// catégorique : « un écran dont les trois chiffres ne sont pas écrits est
// réputé HORS BUDGET ». On compte donc les appels de données RÉELLEMENT émis
// pendant le chargement — pas ceux qu'on croit avoir écrits.
//
// Ce qu'on compte : les appels PostgREST (`/rest/v1/…`) et les fonctions Edge.
// Ce qu'on ne compte pas : le HTML, les chunks JS, les fontes — ce sont des
// ressources statiques, pas des allers-retours de données, et §2 parle
// d'« appels ». `auth/v1` est exclu pour la même raison : la session est un
// préalable commun à tous les écrans, pas un coût de celui-ci.
const appels = [];
page.on("request", (r) => {
  const u = r.url();
  if (/\/rest\/v1\//.test(u) || /\/functions\/v1\//.test(u)) {
    appels.push(u.replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
  }
});

// ⚠️ ON REMET LE COMPTEUR À ZÉRO ICI, et pas avant : la page de destination de
// la connexion (/patients) émet ses propres appels, et les compter chargerait
// /finances d'une facture qui n'est pas la sienne.
appels.length = 0;
const t0 = Date.now();
await page.goto(`${BASE}/finances`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
// PREMIER CONTENU : le squelette ou le rail — la preuve que l'écran a répondu
// sans attendre la base (§2 : « les 100 ms ne dépendent d'aucun réseau »).
// On attend que le squelette cède la place : un contrôle mesuré sur un
// squelette mesurerait le squelette.
await page.waitForSelector("text=/FACTURÉ|Aucune séance tarifée/i", { timeout: 60_000 });
const tComplet = Date.now() - t0;

// ⚠️ LE « PREMIER CONTENU » DU CONTRAT EST LE SQUELETTE, PAS LE RAIL.
// §2 le dit : « Les 100 ms de premier contenu ne dépendent d'AUCUN réseau.
// C'est le squelette. » Mesurer jusqu'au rail de navigation mesurerait en
// réalité l'appel `profiles` de la coquille — donc un aller-retour vers Alger,
// et un chiffre qui ne peut structurellement pas tenir dans 100 ms.
// On lit donc le FIRST CONTENTFUL PAINT que le navigateur relève lui-même :
// le premier pixel de contenu réellement peint.
const tPremier = await page.evaluate(() => {
  const e = performance.getEntriesByName("first-contentful-paint")[0];
  return e === undefined ? null : Math.round(e.startTime);
});
await page.waitForTimeout(500);

// ⚠️ LE MODE CHANGE LA LECTURE DU CHIFFRE, ET L'INSTRUMENT LE DIT LUI-MÊME.
// §1 impose `next build && next start` pour un verdict de performance : en
// `next dev`, Next recompile la route et le chiffre décrit le compilateur, pas
// le produit. On détecte donc le mode plutôt que de l'affirmer — un instrument
// qui étiquette « production » un chiffre pris en développement ment plus
// efficacement qu'une absence de mesure.
const enDev = await page.evaluate(() =>
  document.querySelector("script[src*=\"webpack\"], script[src*=\"_next/static/chunks/react-refresh\"]") !== null);
const mode = enDev ? "next dev — NON OPPOSABLE (§1)" : "next start — opposable";
// ⚠️ DEUX FACTURES DISTINCTES, ET LES CONFONDRE ACCUSERAIT LE MAUVAIS ÉCRAN.
//
// La COQUILLE (`AppShell`, `SyntheticDataBanner`, `BandeauSeanceEnCours`,
// `useSessionEcran`) émet ses propres appels sur CHAQUE écran : `profiles`,
// `deployment`, `get_open_consultation`. Ils ne sont pas le coût de /finances —
// ils sont le coût d'être connecté. Les compter contre cet écran rendrait un
// ROUGE que ce lot ne peut pas corriger sans toucher toute l'application
// (règle 10), et masquerait le seul chiffre qui LUI appartient.
//
// Mesuré le 2026-08-21 : la coquille émet 4 à 6 appels par écran. C'est
// exactement la cascade que `06-PERF-BUDGET.md` §3 décrit comme le défaut à
// corriger — dette OUVERTE, antérieure à ce lot, relevée ici plutôt que tue.
const COQUILLE = /\/(profiles|deployment)(\?|$)|rpc\/(get_open_consultation|search_patients)/;
const appelsDonnees = appels.filter((u) => !/\/auth\/v1\//.test(u));
const appelsEcran = appelsDonnees.filter((u) => !COQUILLE.test(u));
const appelsCoquille = appelsDonnees.filter((u) => COQUILLE.test(u));

controle("UN SEUL appel de données pour L'ÉCRAN (PERF §2)",
  appelsEcran.length === 1,
  `${appelsEcran.length} appel(s) : ${appelsEcran.join(" · ") || "aucun"}`);
controle("cet appel est la porte composite",
  appelsEcran.length > 0 && appelsEcran.every((u) => /finance_overview/.test(u)),
  appelsEcran.join(" · ") || "aucun");
console.log(`  relevé | ${"appels de la COQUILLE (dette PERF §3, antérieure)".padEnd(52)} | ${appelsCoquille.length} : ${appelsCoquille.join(" · ") || "aucun"}`);
// ⚠️ RELEVÉ, PAS ENCORE UN VERDICT — ET C'EST DÉLIBÉRÉ.
// Les seuils de §2 (100 ms / 400 ms) n'ont PAS été confrontés à une série de
// mesures en `next start` : les premiers relevés donnaient 549 à 1200 ms pour
// l'écran complet, ce qui pose une vraie question de budget — mais une question
// qui porte sur la COQUILLE et sur la latence Alger↔UE (§5 la nomme : ~180 ms
// par appel depuis le cloud), pas sur cet écran, qui n'émet qu'UN appel.
//
// Transformer ces deux lignes en contrôles PASS/FAIL avant d'avoir tranché
// ferait échouer la porte sur une cause qu'elle n'expose pas, et pousserait le
// prochain agent à « corriger » le mauvais endroit. On RELÈVE, on écrit le
// chiffre, et on laisse la décision à V4 — qui devra de toute façon reprendre
// la cascade de la coquille (`app.dashboard_today`).
console.log(`  relevé | ${"premier contenu (FCP)".padEnd(52)} | ${tPremier ?? "?"} ms · budget §2 : 100 ms · ${mode}`);
console.log(`  relevé | ${"écran complet".padEnd(52)} | ${tComplet} ms · budget §2 : 400 ms · ${mode}`);

const arrivee = new URL(page.url()).pathname;
if (arrivee !== "/finances") {
  bloque("écran /finances", `arrivé sur ${arrivee} — NON OBSERVÉ`);
} else {
  vert("écran /finances rendu", "session authentifiée");

  const vide = await page.locator("text=Aucune séance tarifée").count();

  // ══ Le mot « Recette du jour » a DISPARU ═══════════════════════════════
  // La correction centrale de ce lot. Il désignait un montant FACTURÉ.
  const recette = await page.getByText("Recette du jour", { exact: false }).count();
  controle("« Recette du jour » retiré de l'écran", recette === 0,
    recette === 0 ? "le montant facturé ne s'appelle plus une recette" : `${recette} occurrence(s)`);

  // ══ Le sélecteur de période — groupe radio, 5 options ══════════════════
  const groupe = page.locator('[role="radiogroup"]');
  const options = await groupe.locator('[role="radio"]').count();
  controle("sélecteur de période — 5 options exclusives", options === 5, `${options} option(s)`);

  // Un seul arrêt de tabulation pour tout le groupe : c'est l'option ACTIVE
  // qui le porte, les flèches font le reste.
  const tabbables = await groupe.locator('[role="radio"][tabindex="0"]').count();
  controle("un seul arrêt de tabulation dans le groupe", tabbables === 1, `${tabbables} arrêt(s)`);

  if (vide > 0) {
    bloque("réconciliation à l'écran", "période vide — aucun chiffre à additionner");
    bloque("graphiques", "période vide — non rendus, et c'est le comportement voulu");
  } else {
    // ══ I-1 RELU DANS LE DOM ════════════════════════════════════════════
    // Le checkpoint SQL prouve que la PORTE réconcilie. Ici on prouve que
    // l'ÉCRAN affiche ce que la porte a rendu — service, Zod, formateur et
    // composant compris.
    const facture = montantDepuisTexte(
      await page.locator("text=FACTURÉ").locator("xpath=../p[2]").first().textContent()
        .catch(() => null),
    );
    const decomposition = await page.getByText(/dont .* encaissé · .* en attente/).first()
      .textContent().catch(() => null);

    if (decomposition === null || facture === null) {
      bloque("réconciliation I-1 à l'écran", "montants introuvables dans le DOM");
    } else {
      const nombres = decomposition.match(/-?[\d  \s]+DZD/g) ?? [];
      const enc = montantDepuisTexte(nombres[0] ?? "");
      const att = montantDepuisTexte(nombres[1] ?? "");
      if (enc === null || att === null) {
        bloque("réconciliation I-1 à l'écran", `décomposition illisible : « ${decomposition} »`);
      } else {
        controle("I-1 · facturé = encaissé(assiette) + attente, À L'ÉCRAN",
          facture === enc + att,
          `${facture} = ${enc} + ${att}`);
      }
    }

    // ══ Les quatre indicateurs sont nommés ══════════════════════════════
    for (const mot of ["FACTURÉ", "ENCAISSÉ", "EN ATTENTE", "TAUX D'ENCAISSEMENT"]) {
      const n = await page.getByText(mot, { exact: false }).count();
      controle(`indicateur « ${mot} » présent`, n > 0, `${n} occurrence(s)`);
    }

    // ══ Aucun pourcentage impossible ════════════════════════════════════
    // `prev = 0` doit rendre « — », jamais ∞ %, jamais NaN, jamais +100 %.
    const corps = (await page.locator("body").textContent()) ?? "";
    controle("aucun « Infinity », « NaN » ni « ∞ » à l'écran",
      !/Infinity|NaN|∞/.test(corps), "un ratio sans précédent s'écrit « — »");

    // ══ Chaque graphique a son équivalent textuel ═══════════════════════
    const tableaux = await page.locator("table caption").allTextContents();
    controle("chaque graphique porte un tableau légendé",
      tableaux.length >= 2, `${tableaux.length} tableau(x) : ${tableaux.join(" · ").slice(0, 80)}`);

    // ══ Le journal est REPLIÉ au chargement ═════════════════════════════
    // Son ouverture écrit une trace d'audit : elle doit rester un geste.
    const boutonJournal = page.getByRole("button", { name: /journal des paiements/i }).first();
    const expanded = await boutonJournal.getAttribute("aria-expanded").catch(() => null);
    controle("journal replié au chargement (trace d'audit = un geste)",
      expanded === "false", `aria-expanded=${expanded}`);
  }

  await page.screenshot({ path: path.join(PREUVES, "finances-1440.png"), fullPage: true });

  // ══ Changement de période — l'écran reste dans UN SEUL état ═══════════
  try {
    await page.getByRole("radio", { name: "Aujourd'hui" }).click();
    await page.waitForTimeout(2500);
    const erreurEtVide =
      (await page.locator("text=Réessayer").count()) > 0 &&
      (await page.locator("text=Aucune séance tarifée").count()) > 0;
    controle("erreur et vide ne coexistent jamais (05-UX-CONTRACT §1)",
      !erreurEtVide, "un écran est dans exactement un état");

    const url = new URL(page.url());
    controle("la période est reflétée dans l'URL",
      url.searchParams.get("du") !== null && url.searchParams.get("au") !== null,
      `du=${url.searchParams.get("du")} au=${url.searchParams.get("au")}`);

    await page.screenshot({ path: path.join(PREUVES, "finances-jour-1440.png"), fullPage: true });
  } catch (e) {
    bloque("changement de période", String(e).slice(0, 100));
  }

  // ══ Largeurs — la PAGE ne défile jamais latéralement ══════════════════
  for (const largeur of [1920, 1440, 1280, 1024]) {
    await page.setViewportSize({ width: largeur, height: 900 });
    await page.waitForTimeout(400);
    const deborde = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    controle(`aucun défilement horizontal de page à ${largeur}px`, !deborde,
      deborde ? "la page déborde — un graphique ne se borne pas" : "");
    await page.screenshot({ path: path.join(PREUVES, `finances-${largeur}.png`), fullPage: false });
  }
}

// ---------------------------------------------------------------------------
// LES CINQ ÉTATS, DÉCLENCHÉS — pas seulement écrits
// ---------------------------------------------------------------------------
// ⚠️ `05-UX-CONTRACT.md` §1 : « Un état qu'on ne sait pas déclencher est un état
// qu'on n'a pas écrit. » CONTENU, VIDE et CHARGEMENT s'observent en naviguant.
// ERREUR et HORS LIGNE, non : il faut les PROVOQUER. Sans ce bloc, on livrerait
// deux états dont on ne saurait dire s'ils s'affichent — et c'est précisément
// `/finance` qui a fait naître ce contrat, en montrant une erreur ET un vide en
// même temps.
await page.setViewportSize({ width: 1440, height: 900 });

// ── ERREUR — la porte répond 500. L'erreur doit REMPLACER le contenu.
try {
  await page.route("**/rest/v1/rpc/finance_overview", (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"forcé"}' }));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
  await page.waitForTimeout(2500);

  const aErreur = (await page.getByRole("button", { name: /Réessayer/i }).count()) > 0;
  const aVide = (await page.locator("text=Aucune séance tarifée").count()) > 0;
  const aChiffres = (await page.getByText("FACTURÉ", { exact: false }).count()) > 0;

  controle("ÉTAT ERREUR déclenchable", aErreur, aErreur ? "bloc d'erreur + Réessayer" : "aucun bloc d'erreur");
  // LA RÈGLE QUI MANQUAIT, et qui a fait écrire tout le contrat : si la requête
  // a échoué, on ne SAIT PAS s'il y a des données — donc on n'affiche pas
  // « aucune donnée », et surtout pas des chiffres périmés.
  controle("erreur REMPLACE le contenu (ni vide, ni chiffres)",
    aErreur && !aVide && !aChiffres,
    `vide=${aVide} chiffres=${aChiffres}`);
  await page.screenshot({ path: path.join(PREUVES, "finances-etat-erreur.png"), fullPage: false });
  await page.unroute("**/rest/v1/rpc/finance_overview");
} catch (e) {
  bloque("ÉTAT ERREUR", String(e).slice(0, 100));
}

// ── HORS LIGNE — distinct d'ERREUR (05-UX-CONTRACT §5), bandeau calme.
try {
  // ⚠️ ON NE RECHARGE PAS. Hors ligne, le DOCUMENT lui-même n'arrive pas :
  // React ne démarre jamais, et le navigateur affiche SA page d'erreur — pas la
  // nôtre. On ne mesurerait alors que Chromium. Il faut couper le réseau sous
  // une page DÉJÀ VIVANTE, puis provoquer une lecture : c'est exactement la
  // situation du cabinet, dont le Wi-Fi tombe pendant l'usage (05-UX §5).
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await contexte.setOffline(true);
  await page.getByRole("radio", { name: "Ce mois" }).click().catch(() => {});
  await page.waitForTimeout(4000);
  const corps = (await page.locator("body").textContent()) ?? "";
  const aBandeau = /Connexion perdue|hors ligne/i.test(corps);
  controle("ÉTAT HORS LIGNE déclenchable et DISTINCT d'erreur", aBandeau,
    aBandeau ? "bandeau de reconnexion" : "aucun bandeau hors-ligne");
  await page.screenshot({ path: path.join(PREUVES, "finances-etat-hors-ligne.png"), fullPage: false });
  await contexte.setOffline(false);
} catch (e) {
  bloque("ÉTAT HORS LIGNE", String(e).slice(0, 100));
  await contexte.setOffline(false).catch(() => {});
}

await navigateur.close();

console.log("");
console.log(`─── ${verts} vert · ${rouges} ROUGE · ${bloques} BLOQUÉ ───`);
console.log(`Preuves : ${path.relative(RACINE, PREUVES)}`);
if (rouges > 0) { console.log("V6-FINANCE N'EST PAS VERT : contrôle(s) mesuré(s) non conforme(s)."); process.exit(1); }
if (bloques > 0) { console.log("V6-FINANCE N'EST PAS VERT : contrôle(s) NON MESURÉ(S)."); process.exit(2); }
console.log("Écran /finances conforme.");
process.exit(0);
