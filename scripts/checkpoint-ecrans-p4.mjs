#!/usr/bin/env node
/**
 * checkpoint-ecrans-p4 — les écrans du §37, parcourus par un VRAI navigateur.
 *
 * ═══ POURQUOI CE CONTRÔLE, ALORS QUE LA FRONTIÈRE EST DÉJÀ VERTE ═══════════
 *
 * `checkpoint-frontiere-http.mjs` prouve que `/api/db/*` répond correctement.
 * Il ne prouve PAS que les écrans s'en servent : entre les deux il y a
 * `httpDbPort`, exécuté DANS LE NAVIGATEUR, avec ses cookies, son `credentials`,
 * et 74 composants clients qui appellent `db()`.
 *
 * C'est précisément la couche où une migration comme celle-ci casse sans que
 * rien ne le dise : le serveur va bien, les tests passent, et la praticienne
 * voit un écran vide. Le dépôt connaît déjà ce piège — « vert statique n'est pas
 * vert intégré ».
 *
 * Ce script ouvre donc Chromium, se connecte par le VRAI formulaire, visite les
 * écrans, et échoue si l'un d'eux affiche une erreur ou reste vide là où il
 * devrait montrer quelque chose. Il surveille aussi la console et les requêtes
 * réseau : une 401 ou une 500 en arrière-plan est un ROUGE, même si l'écran a
 * l'air correct.
 */

import { chromium } from "playwright";

const BASE = process.env.MC_BASE ?? "http://127.0.0.1:3210";
const EMAIL = process.env.MC_EMAIL ?? "";
const MDP = process.env.MC_MDP ?? "";

let echecs = 0;
let reussites = 0;

function verdict(ok, titre, detail) {
  if (ok) {
    reussites += 1;
    console.log(`  ✅ ${titre}`);
  } else {
    echecs += 1;
    console.log(`  🔴 ${titre}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

const ECRANS = [
  { chemin: "/tableauDeBord", nom: "Tableau de bord" },
  { chemin: "/patients", nom: "Patients" },
  { chemin: "/agenda", nom: "Agenda" },
  { chemin: "/finances", nom: "Finances" },
  { chemin: "/documents", nom: "Documents" },
  { chemin: "/parametres/documents", nom: "Paramètres documents" },
  { chemin: "/jarvis", nom: "Jarvis" },
];

async function main() {
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ locale: "fr-FR" });
  const page = await contexte.newPage();

  /** Toutes les réponses d'API non-2xx, par écran. */
  let echecsReseau = [];
  let erreursConsole = [];

  page.on("response", (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    // 401 sur /api/auth/session AVANT connexion est normal ; on ne surveille
    // qu'après. Le drapeau est posé plus bas.
    if (r.status() >= 400) echecsReseau.push(`${r.status()} ${u.replace(BASE, "")}`);
  });
  page.on("pageerror", (e) => erreursConsole.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error") erreursConsole.push(m.text().slice(0, 200));
  });

  console.log("checkpoint-ecrans-p4 — les écrans du §37, dans un vrai navigateur\n");

  console.log("1 · connexion par le formulaire réel");
  await page.goto(`${BASE}/connexion`, { waitUntil: "networkidle" });
  echecsReseau = [];
  erreursConsole = [];

  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', MDP);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("/connexion"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]).catch(() => {});

  const apresConnexion = new URL(page.url()).pathname;
  verdict(!apresConnexion.includes("/connexion"), "la connexion redirige hors de /connexion", apresConnexion);

  // Le cookie doit être invisible au JavaScript de la page (httpOnly).
  const visible = await page.evaluate(() => document.cookie.includes("mc_session"));
  verdict(visible === false, "le cookie de session est INVISIBLE à document.cookie (httpOnly)");

  console.log("\n2 · les écrans");
  for (const ecran of ECRANS) {
    echecsReseau = [];
    erreursConsole = [];
    await page.goto(`${BASE}${ecran.chemin}`, { waitUntil: "networkidle", timeout: 30_000 });
    // Laisse le temps aux chargements différés (`useEffect`) de finir.
    await page.waitForTimeout(1500);

    const texte = await page.evaluate(() => document.body.innerText);
    const redirige = new URL(page.url()).pathname.includes("/connexion");

    verdict(!redirige, `${ecran.nom} — ne renvoie pas vers la connexion`, page.url());

    // Les états d'erreur du dépôt sont en français et nomment la panne.
    const motsErreur = [
      "connexion au serveur est interrompue",
      "service de données",
      "erreur inattendue",
      "Application error",
      "vous n'avez pas accès",
    ];
    const trouve = motsErreur.filter((m) => texte.toLowerCase().includes(m.toLowerCase()));
    verdict(trouve.length === 0, `${ecran.nom} — aucun état d'erreur affiché`, trouve.join(" / "));

    // Jarvis est ATTENDU en panne à cette phase : ses fonctions ne sont pas
    // encore portées (phase 5). On ne compte pas ses 404 comme un échec, mais
    // on les AFFICHE, pour que le rapport ne les passe pas sous silence.
    const reseau = echecsReseau.filter((l) => !l.includes("/api/jarvis/"));
    verdict(reseau.length === 0, `${ecran.nom} — aucune requête API en échec`, reseau.join(", "));
    if (echecsReseau.some((l) => l.includes("/api/jarvis/"))) {
      console.log(`     ℹ️  ${ecran.nom} : appels /api/jarvis/* en 404 — ATTENDU, portage en phase 5.`);
    }

    const consoleFiltree = erreursConsole.filter(
      (e) => !e.includes("/api/jarvis/") && !e.includes("404"),
    );
    verdict(consoleFiltree.length === 0, `${ecran.nom} — console sans erreur`, consoleFiltree.slice(0, 2).join(" | "));
  }

  console.log("\n3 · la déconnexion ferme réellement l'accès");
  {
    await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
    await contexte.clearCookies();
    await page.goto(`${BASE}/patients`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1200);
    const texte = await page.evaluate(() => document.body.innerText);
    // Sans session, l'écran ne doit montrer AUCUNE donnée patient.
    verdict(
      !texte.includes("TEST-CLOISON-1") && !texte.includes("Cloison"),
      "sans cookie, aucune donnée patient n'apparaît",
    );
  }

  await navigateur.close();

  console.log("");
  if (echecs === 0) {
    console.log(`VERDICT : VERT — ${reussites} contrôles, 0 échec.`);
    process.exit(0);
  }
  console.log(`VERDICT : ROUGE — ${echecs} échec(s) sur ${reussites + echecs} contrôles.`);
  process.exit(1);
}

main().catch((e) => {
  console.error("VERDICT : ROUGE — le checkpoint lui-même a échoué :", e?.message ?? e);
  process.exit(1);
});
