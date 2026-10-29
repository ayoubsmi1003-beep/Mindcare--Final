#!/usr/bin/env node
/**
 * mesure-statistiques — l'écran /statistiques dans un vrai Chromium.
 *
 *   BASE=http://localhost:3100 node scripts/mesure-statistiques.mjs
 *
 * Trois vérités, et trois seulement :
 *   · VERT    — mesuré, conforme ;
 *   · ROUGE   — mesuré, non conforme ;
 *   · BLOQUÉ  — non mesuré. Un écran qui redirige vers /connexion n'est ni vert
 *               ni rouge : il n'a pas été regardé.
 *
 * ⚠️ CE SCRIPT NE SE CONNECTE QU'À UNE BASE JETABLE. Les identifiants sont lus
 * dans l'environnement, jamais écrits ici ; aucun nom de patient n'est imprimé.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "analyse-preuves");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3100";
const EMAIL = process.env["MESURE_EMAIL"] ?? "owner.dev@invalid.local";
const MOTDEPASSE = process.env["MESURE_MOTDEPASSE"] ?? "";

const RESOLUTIONS = [
  { nom: "1920x1080", width: 1920, height: 1080 },
  { nom: "1440x900", width: 1440, height: 900 },
  { nom: "1366x768", width: 1366, height: 768 },
];

let verts = 0;
let rouges = 0;
let bloques = 0;

function vert(label, detail = "") { console.log(`  vert   | ${label.padEnd(50)} | ${detail}`); verts += 1; }
function rouge(label, detail = "") { console.log(`  ROUGE  | ${label.padEnd(50)} | ${detail}`); rouges += 1; }
function bloque(label, detail = "") { console.log(`  BLOQUÉ | ${label.padEnd(50)} | ${detail}`); bloques += 1; }

function controle(label, condition, detail = "") {
  if (condition === null || condition === undefined) bloque(label, `${detail} (valeur absente)`);
  else if (condition) vert(label, detail);
  else rouge(label, detail);
}

async function main() {
  if (MOTDEPASSE === "") {
    console.error("MESURE_MOTDEPASSE est requis (base jetable uniquement).");
    process.exit(2);
  }
  mkdirSync(PREUVES, { recursive: true });

  const navigateur = await chromium.launch();
  try {
    for (const r of RESOLUTIONS) {
      const contexte = await navigateur.newContext({ viewport: { width: r.width, height: r.height } });
      const page = await contexte.newPage();
      // Ce poste compile chaque route en `next dev` : `/patients` a mesuré
      // 246 s au premier accès. Les délais par défaut de Playwright (30 s)
      // décriraient le compilateur, pas l'écran.
      page.setDefaultTimeout(180_000);
      page.setDefaultNavigationTimeout(180_000);
      const erreurs = [];
      page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text()); });
      page.on("pageerror", (e) => erreurs.push(String(e)));

      await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector('input[type="password"]', { timeout: 30_000 });
      await page.waitForTimeout(1200);
      await page.fill('input[type="text"]', EMAIL);
      await page.fill('input[type="password"]', MOTDEPASSE);
      await page.click('button[type="submit"], form button');
      // ⚠️ ON N'ATTEND PAS LA REDIRECTION VERS /patients. En `next dev`, la
      // première compilation de cette route a mesuré 246 s sur ce poste ; elle
      // n'a rien à voir avec l'écran mesuré. On attend la RÉPONSE de connexion.
      const reponse = await page
        .waitForResponse((r) => r.url().includes("/api/auth/sign-in"), { timeout: 240_000 })
        .catch(() => null);
      if (reponse === null || reponse.status() !== 200) {
        const txt = await page.evaluate(() => document.body.innerText.slice(0, 400));
        throw new Error(`connexion refusée : ${txt}`);
      }

      await page.goto(`${BASE}/statistiques?du=2026-09-30&au=2026-10-29`, { waitUntil: "domcontentloaded" });
      // Les 401 de l'écran de connexion (avant session) ne concernent pas cet
      // écran : on ne mesure que ce qui se passe APRÈS l'ouverture de session.
      erreurs.length = 0;
      const titre = page.getByRole("heading", { name: "Activité dans le temps" });
      const rendu = await titre.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
      if (!rendu) {
        bloque(`${r.nom} — l'écran n'a pas rendu`);
        await page.screenshot({ path: path.join(PREUVES, `${r.nom}-bloque.png`) });
        await contexte.close();
        continue;
      }

      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(PREUVES, `${r.nom}-haut.png`) });
      // La page défile DANS `.analyse-scene` : `fullPage` ne verrait que la
      // fenêtre. On fait défiler le conteneur, puis on capture le bas.
      await page.evaluate(() => {
        const zone = document.querySelector(".analyse-scene");
        zone?.scrollTo({ top: 99_999 });
      });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(PREUVES, `${r.nom}-bas.png`) });
      await page.evaluate(() => {
        const zone = document.querySelector(".analyse-scene");
        zone?.scrollTo({ top: 0 });
      });
      await page.waitForTimeout(300);
      await page.getByRole("heading", { name: "Échelles cliniques" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(PREUVES, `${r.nom}-milieu.png`) });

      if (r.nom === "1920x1080") {
        // Le tiroir de détail : seule surface qui nomme une patiente, et elle
        // ne doit s'ouvrir que sur un geste.
        await page.evaluate(() => {
          const zone = document.querySelector(".analyse-scene");
          zone?.scrollTo({ top: 0 });
        });
        await page.waitForTimeout(400);
        await page.getByRole("button", { name: /Séances/ }).first().click();
        const tiroir = page.getByRole("dialog");
        const ouvert = await tiroir.waitFor({ timeout: 60_000 }).then(() => true).catch(() => false);
        controle(`${r.nom} — le détail s'ouvre sur un geste`, ouvert, "");
        if (ouvert) {
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(PREUVES, `${r.nom}-detail.png`) });
          const lignes = await tiroir.locator("li").count();
          controle(`${r.nom} — le détail rend des lignes`, lignes > 0, `${lignes} lignes`);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
        }
      }

      // 1 · Pas de débordement horizontal du document.
      const largeur = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vue: window.innerWidth }));
      controle(`${r.nom} — aucun débordement horizontal`, largeur.doc <= largeur.vue + 1, `${largeur.doc} / ${largeur.vue}`);

      // 2 · Aucun texte tronqué par overflow hidden sur les titres de panneau.
      const tronques = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll("h2").forEach((h) => {
          if (h.scrollWidth > h.clientWidth + 2) out.push(h.textContent);
        });
        return out;
      });
      controle(`${r.nom} — titres de panneau non tronqués`, tronques.length === 0, tronques.join(" · "));

      // 3 · Les six panneaux attendus sont présents.
      const panneaux = await page.evaluate(() => {
        const titres = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent ?? "");
        return ["Activité dans le temps", "Statuts des rendez-vous", "Nouveaux et retours",
                "Rythme de la semaine", "Moments de la journée", "Échelles cliniques",
                "Diagnostics documentés", "Qualité du dossier", "Traitements"]
          .filter((t) => !titres.some((x) => x.includes(t)));
      });
      controle(`${r.nom} — tous les panneaux sont rendus`, panneaux.length === 0, panneaux.join(" · "));

      // 4 · Aucune erreur console.
      controle(`${r.nom} — console silencieuse`, erreurs.length === 0, erreurs.slice(0, 2).join(" | "));

      console.log(`  → ${path.join(PREUVES, `${r.nom}-haut.png`)}`);
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }

  console.log(`\nverts ${verts} · rouges ${rouges} · bloqués ${bloques}`);
  if (rouges > 0) process.exit(1);
  if (bloques > 0) process.exit(3);
}

await main();
