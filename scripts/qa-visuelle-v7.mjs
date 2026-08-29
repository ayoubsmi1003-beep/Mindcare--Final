/**
 * QA VISUELLE V7 — capture chaque écran aux trois largeurs cibles.
 *
 * Ce script ne juge rien : il PRODUIT LES PREUVES. Le jugement se fait en
 * regardant les images, ce qui est précisément l'étape que les refontes
 * précédentes ont sautée — un `tsc --noEmit` vert ne dit rien de ce qui est
 * affiché, et quatre tentatives ont livré du vert sur une interface inchangée.
 *
 * Usage :
 *   node scripts/qa-visuelle-v7.mjs [--dossier <nom>] [--role praticienne|assistante]
 *
 * Les captures atterrissent dans `checkpoints/v7-preuves/<dossier>/`.
 *
 * ⚠️ LES CAPTURES CONTIENNENT DES NOMS DE DOSSIER, ET ELLES SONT COMMITÉES.
 * `checkpoints/` est suivi par git — c'est la convention du dépôt pour les
 * preuves de checkpoint. Ces images ne sont donc PAS ignorées : elles ne sont
 * acceptables que parce que la base de développement est synthétique
 * (ADR-016). **Ne jamais lancer ce script contre une base réelle**, et ne
 * jamais téléverser les images ailleurs que dans ce dépôt.
 */

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";

function argv(nom, defaut) {
  const i = process.argv.indexOf(nom);
  return i === -1 ? defaut : (process.argv[i + 1] ?? defaut);
}

const DOSSIER = argv("--dossier", "apres");
const ROLE = argv("--role", "praticienne");
const SORTIE = path.join(RACINE, "checkpoints", "v7-preuves", DOSSIER);

/** Comptes de développement synthétiques (ADR-016). Jamais de compte réel. */
const COMPTES = {
  praticienne: { email: "praticien2.dev@invalid.local", varMdp: "DOCTOR_ACCOUNT_PASSWORD" },
  assistante: { email: "dev@invalid.local", varMdp: "DEV_ACCOUNT_PASSWORD" },
};

const LARGEURS = [
  { nom: "1920", width: 1920, height: 1080 },
  { nom: "1366", width: 1366, height: 768 },
  { nom: "1024", width: 1024, height: 768 },
];

/**
 * Les écrans, dans l'ordre où on les regarde. `attendre` est un sélecteur qui
 * prouve que l'écran a fini d'arriver — sans lui, on photographie un squelette
 * et on croit avoir vu la page.
 */
const ECRANS_PRATICIENNE = [
  { nom: "01-tableauDeBord", url: "/tableauDeBord" },
  { nom: "02-patients", url: "/patients" },
  { nom: "03-patients-nouveau", url: "/patients/nouveau" },
  { nom: "04-agenda", url: "/agenda" },
  { nom: "05-agenda-nouveau", url: "/agenda/nouveau" },
  { nom: "06-finances", url: "/finances" },
  { nom: "07-documents", url: "/documents" },
  { nom: "08-jarvis", url: "/jarvis" },
  { nom: "09-parametres", url: "/parametres/documents" },
];

const ECRANS_ASSISTANTE = [
  { nom: "20-cockpit", url: "/tableauDeBord" },
  { nom: "21-agenda", url: "/agenda" },
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

async function seConnecter(page, env, compte) {
  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, 'input[type="email"]');
  await page.locator('input[type="email"]').pressSequentially(compte.email);
  await page.locator('input[type="password"]').pressSequentially(env[compte.varMdp] ?? "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 60_000 });
}

/**
 * Le défaut le plus coûteux d'une capture d'écran d'application : photographier
 * un état de chargement en croyant photographier l'écran. On attend donc que
 * plus aucun squelette (`aria-busy`) ne soit affiché, puis un temps de repos.
 */
async function attendreEcranStable(page) {
  await page
    .waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0, {
      timeout: 20_000,
    })
    .catch(() => {});
  await page.waitForTimeout(700);
}

/**
 * Un débordement horizontal est un défaut de composition, pas un détail.
 *
 * ⚠️ MESURER `documentElement.scrollWidth` DONNE UN FAUX POSITIF, et il a
 * coûté une enquête. La grille de l'agenda défile horizontalement DANS son
 * conteneur : elle est donc plus large que la fenêtre, légitimement, et
 * visuellement clippée. `getBoundingClientRect` et `scrollWidth` ignorent le
 * clipping d'un ancêtre — le document était annoncé à 1192 px pour 1024
 * alors que rien ne dépassait à l'écran.
 *
 * Le seul test honnête est le COMPORTEMENT : la page peut-elle être défilée
 * horizontalement ? On tente de la défiler et on regarde si elle a bougé.
 */
async function mesurerDebordement(page) {
  return page.evaluate(() => {
    const avant = window.scrollX;
    window.scrollTo(9999, window.scrollY);
    const apres = window.scrollX;
    window.scrollTo(avant, window.scrollY);
    return { defile: apres > avant, decalage: apres - avant };
  });
}

async function main() {
  const env = lireEnv();
  const compte = COMPTES[ROLE];
  if (compte === undefined) throw new Error(`Rôle inconnu : ${ROLE}`);
  const ecrans = ROLE === "assistante" ? ECRANS_ASSISTANTE : ECRANS_PRATICIENNE;

  mkdirSync(SORTIE, { recursive: true });
  const navigateur = await chromium.launch();
  const defauts = [];

  for (const taille of LARGEURS) {
    const contexte = await navigateur.newContext({
      viewport: { width: taille.width, height: taille.height },
      deviceScaleFactor: 1,
      locale: "fr-FR",
    });
    const page = await contexte.newPage();
    const erreursConsole = [];
    page.on("console", (m) => {
      if (m.type() === "error") erreursConsole.push(m.text().slice(0, 200));
    });
    page.on("pageerror", (e) => erreursConsole.push(`pageerror: ${String(e).slice(0, 200)}`));

    await seConnecter(page, env, compte);

    for (const ecran of ecrans) {
      await page.goto(`${BASE}${ecran.url}`, { waitUntil: "domcontentloaded" });
      await attendreEcranStable(page);

      const { defile, decalage } = await mesurerDebordement(page);
      if (defile) {
        defauts.push(
          `DEBORDEMENT ${ecran.nom} @${taille.nom} : la page défile de ${decalage}px horizontalement`,
        );
      }

      await page.screenshot({
        path: path.join(SORTIE, `${ecran.nom}@${taille.nom}.png`),
        fullPage: false,
      });
      process.stdout.write(`  ${ecran.nom}@${taille.nom}\n`);
    }

    /*
      LES DEUX ÉCRANS QU'AUCUNE URL FIXE N'ATTEINT.
      La fiche patient et le rendez-vous vivent derrière un identifiant, et la
      fiche est la surface la plus dense du produit — donc celle qu'une refonte
      a le plus de chances d'abîmer. On y arrive comme la praticienne : en
      cliquant, plutôt qu'en fabriquant une URL qui pourrait ne rien prouver.
    */
    if (ROLE !== "assistante") {
      await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
      await attendreEcranStable(page);
      const premier = page.locator('main a[href^="/patients/"]').first();
      if ((await premier.count()) > 0) {
        await premier.click();
        await attendreEcranStable(page);
        const { defile } = await mesurerDebordement(page);
        if (defile) defauts.push(`DEBORDEMENT 10-fiche-patient @${taille.nom}`);
        await page.screenshot({ path: path.join(SORTIE, `10-fiche-patient@${taille.nom}.png`) });
        process.stdout.write(`  10-fiche-patient@${taille.nom}\n`);
      } else {
        process.stdout.write(`  10-fiche-patient@${taille.nom} — aucun dossier cliquable\n`);
      }

      await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
      await attendreEcranStable(page);
      const rdv = page.locator('main a[href^="/agenda/"]').first();
      if ((await rdv.count()) > 0) {
        await rdv.click();
        await attendreEcranStable(page);
        const { defile } = await mesurerDebordement(page);
        if (defile) defauts.push(`DEBORDEMENT 11-rendez-vous @${taille.nom}`);
        await page.screenshot({ path: path.join(SORTIE, `11-rendez-vous@${taille.nom}.png`) });
        process.stdout.write(`  11-rendez-vous@${taille.nom}\n`);
      }
    }

    if (erreursConsole.length > 0) {
      for (const e of [...new Set(erreursConsole)].slice(0, 8)) {
        defauts.push(`CONSOLE @${taille.nom} : ${e}`);
      }
    }
    await contexte.close();
  }

  await navigateur.close();

  console.log(`\ncaptures : ${SORTIE}`);
  if (defauts.length === 0) {
    console.log("aucun débordement, aucune erreur console.");
  } else {
    console.log(`\n${defauts.length} DÉFAUT(S) :`);
    for (const d of defauts) console.log(`  - ${d}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
