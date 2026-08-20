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
await page.goto(`${BASE}/finances`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 60_000 });
// On attend que le squelette cède la place : un contrôle mesuré sur un
// squelette mesurerait le squelette.
await page.waitForSelector("text=/FACTURÉ|Aucune séance tarifée/i", { timeout: 60_000 });
await page.waitForTimeout(500);

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

await navigateur.close();

console.log("");
console.log(`─── ${verts} vert · ${rouges} ROUGE · ${bloques} BLOQUÉ ───`);
console.log(`Preuves : ${path.relative(RACINE, PREUVES)}`);
if (rouges > 0) { console.log("V6-FINANCE N'EST PAS VERT : contrôle(s) mesuré(s) non conforme(s)."); process.exit(1); }
if (bloques > 0) { console.log("V6-FINANCE N'EST PAS VERT : contrôle(s) NON MESURÉ(S)."); process.exit(2); }
console.log("Écran /finances conforme.");
process.exit(0);
