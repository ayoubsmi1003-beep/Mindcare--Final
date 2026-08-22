#!/usr/bin/env node
/**
 * mesure-v8-documents — l'écran /documents dans un vrai Chromium, en session.
 *
 *   MESURE_COMPTE=praticienne node scripts/mesure-v8-documents.mjs
 *
 * ⚠️ IL NE REMPLACE NI `checkpoint-v8-documents.sh`, NI `mesure-v3-navigateur.mjs`.
 * Le checkpoint SQL prouve que la PORTE rend un certificat propre. Il ne prouve
 * pas que l'ÉCRAN affiche ce que la porte a rendu, ni combien d'allers-retours
 * il coûte. Entre les deux il y a un service, un composant et une feuille de
 * style — trois endroits où un certificat juste peut devenir un écran faux.
 *
 * ⚠️ TROIS VERDICTS. `vert` mesuré conforme · `ROUGE` mesuré non conforme ·
 * `BLOQUÉ` NON MESURÉ. Un écran qui redirige vers /connexion n'est ni vert ni
 * rouge : il n'a pas été regardé. C'est le faux rouge documenté le 2026-08-20,
 * et il ne se refait pas ici.
 *
 * ⚠️ EN `next start`, JAMAIS EN `next dev`. §1 du budget l'impose : en
 * développement, Next recompile la route et le chiffre décrit le compilateur.
 * L'instrument DÉTECTE le mode plutôt que de l'affirmer.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "v8-preuves");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";

const COMPTE =
  process.env["MESURE_COMPTE"] === "praticienne"
    ? { email: "praticien2.dev@invalid.local", varMdp: "DOCTOR_ACCOUNT_PASSWORD" }
    : { email: "owner.dev@invalid.local", varMdp: "DEV_ACCOUNT_PASSWORD" };

let verts = 0;
let rouges = 0;
let bloques = 0;

function vert(l, d = "") { console.log(`  vert   | ${l.padEnd(54)} | ${d}`); verts += 1; }
function rouge(l, d = "") { console.log(`  ROUGE  | ${l.padEnd(54)} | ${d}`); rouges += 1; }
function bloque(l, d = "") { console.log(`  BLOQUÉ | ${l.padEnd(54)} | ${d}`); bloques += 1; }

/**
 * ⚠️ UN CONTRÔLE DONT LA CONDITION EST `null`/`undefined` N'EST PAS VERT.
 * Une valeur absente n'a rien prouvé. Sans cette branche, un sélecteur qui ne
 * trouve rien rendrait `undefined === undefined` et passerait pour un succès.
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

async function motDePasse() {
  const { readFileSync } = await import("node:fs");
  const contenu = readFileSync(path.join(RACINE, ".env"), "utf8");
  const ligne = contenu.split(/\r?\n/).find((l) => l.startsWith(`${COMPTE.varMdp}=`));
  return ligne === undefined ? null : ligne.slice(COMPTE.varMdp.length + 1).trim();
}

/**
 * Attend que React ait ACCROCHÉ ses écouteurs — piège de mesure déjà payé deux
 * fois dans ce dépôt. La présence du nœud ne prouve rien : le HTML du serveur
 * le contient déjà, écouteurs absents, et frapper avant l'hydratation produit
 * un envoi VIDE qui ressemble à un mauvais mot de passe.
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
console.log("═══ MESURE V8-DOCUMENTS — NAVIGATEUR RÉEL, SESSION AUTHENTIFIÉE ═══");
console.log("");

try {
  const mdp = await motDePasse();
  if (mdp === null || mdp === "") throw new Error(`${COMPTE.varMdp} absent de .env`);

  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await attendreHydratation(page, 'input[type="email"]');
  await page.locator('input[type="email"]').pressSequentially(COMPTE.email);
  await page.locator('input[type="password"]').pressSequentially(mdp);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/patients/, { timeout: 60_000 });
} catch (e) {
  bloque("session", `connexion impossible : ${String(e).slice(0, 110)}`);
  console.log("");
  console.log("─── 0 vert · 0 ROUGE · 1 BLOQUÉ ───");
  console.log("Sans session, /documents redirige : RIEN n'a été observé.");
  console.log("Ouvrir le compte : bash scripts/compte-praticienne.sh");
  await navigateur.close();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Un dossier RÉEL, pris dans la liste — jamais un identifiant inventé
// ---------------------------------------------------------------------------
// ⚠️ Règle 8 : aucune donnée fictive. On ne fabrique pas un uuid de patient
// pour mesurer ; on prend le premier dossier que la RLS rend visible à ce
// compte. S'il n'y en a aucun, la mesure est BLOQUÉE — pas rouge.
let patientId = null;
try {
  await page.waitForSelector('a[href^="/patients/"]', { timeout: 20_000 });
  const href = await page.locator('a[href^="/patients/"]').first().getAttribute("href");
  patientId = href === null ? null : href.split("/").pop();
} catch {
  patientId = null;
}

if (patientId === null) {
  bloque("dossier de mesure", "aucun patient visible pour ce compte — RIEN n'a été mesuré");
  console.log("");
  console.log(`─── ${verts} vert · ${rouges} ROUGE · ${bloques} BLOQUÉ ───`);
  await navigateur.close();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Le budget : DEUX appels, et il se MESURE
// ---------------------------------------------------------------------------
// `06-PERF-BUDGET.md:44` — Documents : 2 appels · 100 ms · 500 ms. §6 est
// catégorique : « un écran dont les trois chiffres ne sont pas écrits est
// réputé HORS BUDGET ». On compte donc les appels RÉELLEMENT émis.
//
// ⚠️ DEUX FACTURES DISTINCTES, comme en V6. La coquille (`AppShell`,
// `useSessionEcran`, la bannière de données synthétiques) émet ses propres
// appels sur CHAQUE écran : c'est le coût d'être connecté, pas celui de cet
// écran. Les confondre rendrait un ROUGE que ce lot ne peut pas corriger sans
// toucher toute l'application (règle 10), et masquerait le seul chiffre qui lui
// appartient. Dette PERF §3, OUVERTE et antérieure.
const appels = [];
page.on("request", (r) => {
  const u = r.url();
  if (/\/rest\/v1\//.test(u) || /\/functions\/v1\//.test(u)) {
    appels.push(u.replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
  }
});

const COQUILLE = /\/(profiles|deployment)(\?|$)|rpc\/(get_open_consultation|search_patients)/;
const donnees = () => appels.filter((u) => !/\/auth\/v1\//.test(u));
const ecran = () => donnees().filter((u) => !COQUILLE.test(u));
const coquille = () => donnees().filter((u) => COQUILLE.test(u));

// ── A · /documents SANS dossier : l'écran ne doit RIEN lire ────────────────
// C'est la règle 6 mesurée, pas déclarée : ouvrir l'écran ne doit produire
// aucune lecture de dossier, donc aucune ligne d'audit.
appels.length = 0;
await page.goto(`${BASE}/documents`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
await page.waitForTimeout(2000);
controle("sans dossier : AUCUNE lecture de dossier (règle 6)",
  ecran().length === 0,
  `${ecran().length} appel(s) : ${ecran().join(" · ") || "aucun"}`);
await page.screenshot({ path: path.join(PREUVES, "documents-sans-dossier.png") });

// ── B · /documents?patient=… : deux appels, et lesquels ────────────────────
appels.length = 0;
// ⚠️ DÉFAUT D'INSTRUMENT, CORRIGÉ : la première version attendait 3 000 ms en
// dur puis relevait le temps écoulé. Elle mesurait donc SON PROPRE SLEEP —
// 3 339 ms annoncés contre un budget de 500 ms, pour un écran qui répondait
// bien avant. Un instrument qui mesure sa propre attente accuse le produit.
//
// On attend maintenant la FIN RÉELLE du chargement : le panneau de liste a
// cédé la place à l'un de ses trois aboutissements — un tableau, l'état vide,
// ou une erreur. Le squelette ne compte pas : mesurer sur un squelette
// mesurerait le squelette.
const t0 = Date.now();
await page.goto(`${BASE}/documents?patient=${patientId}`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
await page.waitForFunction(
  () => {
    const t = document.body.textContent ?? "";
    return (
      document.querySelector("table") !== null ||
      /Aucun document émis/.test(t) ||
      /n'a pas pu être lue|délai/i.test(t)
    );
  },
  undefined,
  { timeout: 60_000 },
);
const tComplet = Date.now() - t0;
// Laisse retomber les appels tardifs avant de les compter, SANS que cette
// attente entre dans le chiffre ci-dessus.
await page.waitForTimeout(2000);

const tPremier = await page.evaluate(() => {
  const e = performance.getEntriesByName("first-contentful-paint")[0];
  return e === undefined ? null : Math.round(e.startTime);
});

// ⚠️ LE MODE SE DÉTECTE SUR UN SIGNAL MESURÉ, PAS DEVINÉ — DEUX FOIS PLUTÔT
// QU'UNE. La 1re version cherchait `script[src*="webpack"]` : Next émet
// `webpack-<hash>.js` EN PRODUCTION AUSSI, donc tout relevé était annoncé
// « next dev — NON OPPOSABLE ». La 2e cherchait `react-refresh` : ce chunk
// n'existe pas comme `<script src>` séparé en App Router, donc tout relevé
// était annoncé « next start » — l'erreur inverse, et la pire des deux :
// elle aurait fait passer un chiffre de développement pour un chiffre opposable.
//
// Les balises ont donc été LUES sur les deux serveurs (2026-08-22) :
//   production : /_next/static/chunks/main-app-<hash>.js
//   développement : /_next/static/chunks/main-app.js?v=<timestamp>
//                   + /_next/static/chunks/app-pages-internals.js
// `app-pages-internals` n'apparaît QU'EN développement : c'est le signal.
const enDev = await page.evaluate(
  () => document.querySelector('script[src*="app-pages-internals"]') !== null,
);
const mode = enDev ? "next dev — NON OPPOSABLE (§1)" : "next start — opposable";

controle("DEUX appels de données au plus pour L'ÉCRAN (PERF:44)",
  ecran().length <= 2,
  `${ecran().length} appel(s) : ${ecran().join(" · ") || "aucun"}`);
controle("ce sont bien get_patient et list_patient_documents",
  ecran().length > 0 && ecran().every((u) => /rpc\/(get_patient|list_patient_documents)/.test(u)),
  ecran().join(" · ") || "aucun");
console.log(`  relevé | ${"appels de la COQUILLE (dette PERF §3, antérieure)".padEnd(54)} | ${coquille().length} : ${coquille().join(" · ") || "aucun"}`);
console.log(`  relevé | ${"premier contenu (FCP)".padEnd(54)} | ${tPremier ?? "?"} ms · budget : 100 ms · ${mode}`);
console.log(`  relevé | ${"écran complet".padEnd(54)} | ${tComplet} ms · budget : 500 ms · ${mode}`);

const arrivee = new URL(page.url()).pathname;
if (arrivee !== "/documents") {
  bloque("écran /documents", `arrivé sur ${arrivee} — NON OBSERVÉ`);
} else {
  // La page ne défile pas horizontalement : une feuille A5 large de 148 mm
  // dans une colonne étroite est le cas exact où ça arrive.
  const debordement = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  controle("aucun débordement horizontal à 1440×900", debordement <= 0, `${debordement} px`);

  await page.screenshot({ path: path.join(PREUVES, "documents-dossier.png") });
}

// ---------------------------------------------------------------------------
// Les cinq états — DÉCLENCHÉS, pas décrits
// ---------------------------------------------------------------------------
// `?etat=` est inerte en production (garde NODE_ENV) : en `next start` ces
// contrôles sont donc BLOQUÉS, pas rouges. C'est la vérité de l'instrument, et
// la masquer ferait croire à une couverture qu'on n'a pas.
// ⚠️ EN PRODUCTION, CES QUATRE CONTRÔLES SONT NON MESURÉS, PAS ROUGES.
// `?etat=` porte un garde `NODE_ENV !== "production"` — délibéré : un
// paramètre d'URL qui vide l'écran serait, en cabinet, un moyen de faire croire
// à une praticienne qu'un dossier n'a aucun certificat. Le déclencheur ne peut
// donc être éprouvé qu'en `next dev`, et le dire est la seule façon honnête de
// rendre compte : une première version les annonçait ROUGE, ce qui accusait le
// produit d'un défaut qui était une PRÉCAUTION.
//
// Les motifs sont volontairement SERRÉS. Un motif large (`/·/`) matcherait
// n'importe quelle page et fabriquerait des verts qui ne prouvent rien —
// l'écran vide passerait pour un état « chargement » déclenché.
for (const [cle, attendu] of [
  ["chargement", /Chargement/i],
  ["vide", /Aucun document émis pour ce patient/i],
  ["erreur", /La liste des documents de ce dossier n'a pas pu être lue/i],
  ["horsligne", /Hors ligne|Connexion perdue/i],
]) {
  if (!enDev) {
    bloque(`état « ${cle} » déclenchable`, "?etat= inerte en production (garde NODE_ENV) — NON MESURÉ");
    continue;
  }
  try {
    await page.goto(`${BASE}/documents?patient=${patientId}&etat=${cle}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
    await page.waitForTimeout(2500);
    const corps = (await page.locator("body").textContent()) ?? "";
    const vu = attendu.test(corps);
    controle(`état « ${cle} » déclenchable à la demande`, vu, vu ? "" : "motif absent du DOM");
    await page.screenshot({ path: path.join(PREUVES, `documents-etat-${cle}.png`) });
  } catch (e) {
    bloque(`état « ${cle} »`, String(e).slice(0, 90));
  }
}

// ---------------------------------------------------------------------------
// La feuille, en mode IMPRESSION
// ---------------------------------------------------------------------------
// ⚠️ CE CONTRÔLE NE REMPLACE PAS LE TIRAGE PAPIER. Il prouve que la coquille
// disparaît et que la feuille reste — pas que les marges sont justes. Les
// marges sont une HYPOTHÈSE tant qu'un certificat imprimé n'a pas été posé à
// côté d'un de ceux de la praticienne.
try {
  await page.goto(`${BASE}/documents?patient=${patientId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
  await page.waitForTimeout(3000);
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(500);

  const railVisible = await page
    .locator("nav[aria-label]")
    .first()
    .isVisible()
    .catch(() => null);
  controle("à l'impression, le rail de navigation disparaît",
    railVisible === false,
    railVisible === null ? "rail introuvable" : `visible=${railVisible}`);

  await page.screenshot({ path: path.join(PREUVES, "documents-impression.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
} catch (e) {
  bloque("mode impression", String(e).slice(0, 90));
  await page.emulateMedia({ media: "screen" }).catch(() => {});
}

await navigateur.close();

console.log("");
console.log(`─── ${verts} vert · ${rouges} ROUGE · ${bloques} BLOQUÉ ───`);
console.log(`Preuves : ${path.relative(RACINE, PREUVES)}`);
if (rouges > 0) { console.log("V8-DOCUMENTS N'EST PAS VERT : contrôle(s) mesuré(s) non conforme(s)."); process.exit(1); }
if (bloques > 0) { console.log("V8-DOCUMENTS : contrôle(s) NON MESURÉ(S) — ce n'est pas un vert."); process.exit(2); }
console.log("Écran /documents conforme aux contrôles mesurables.");
process.exit(0);
