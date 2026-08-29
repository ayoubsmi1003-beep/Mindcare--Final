/**
 * mesure-jarvis-phase5.mjs — LA PHASE 5 : LA COUCHE OPÉRANTE, AU NAVIGATEUR,
 * SUR DONNÉES RÉELLES, AVEC UN VRAI MODÈLE.
 *
 * ═══ CE QUE CET INSTRUMENT PROUVE, ET CE QUE LE CHECKPOINT NE POUVAIT PAS ═══
 *
 * `checkpoint-jarvis-couche.sh` prouve le FLOT DE CONTRÔLE hors ligne : la
 * frontière, la boucle, les budgets, la composition. Il ne peut rien dire du
 * COMPORTEMENT — un modèle réel répond-il avec les vrais chiffres, la boucle
 * rappelle-t-elle bien une capacité, le contexte se purge-t-il en changeant de
 * patient. C'est ce que mesure ce fichier, et lui seul.
 *
 * ═══ LE SCÉNARIO L, ET POURQUOI IL EST FAIT AINSI ═══
 *
 * ⚠️ AUCUNE VALEUR IDENTIFIANTE N'EST EXTRAITE DE LA BASE PAR CET INSTRUMENT.
 * L'instinct naturel — « exporter les noms, puis chercher ces noms dans la
 * charge » — reviendrait à SORTIR les identités de Postgres et à les écrire
 * dans un fichier pour prouver qu'elles ne sortent pas. Le remède serait le mal.
 *
 * Donc : cet instrument capture les charges HTTP réellement émises vers
 * `functions/v1/jarvis-chat` et les écrit dans un fichier. La COMPARAISON a
 * lieu ensuite DANS la base (`mesure-jarvis-phase5-fuite.sql`), qui lit ce
 * fichier et ne rend qu'un COMPTE et une CLASSE. Aucune identité ne franchit,
 * ni vers le modèle, ni vers le disque, ni vers cette console.
 *
 * Prérequis : `pnpm build` puis `pnpm start` sur :3000, `.env` renseigné.
 *
 *   node scripts/mesure-jarvis-phase5.mjs            # tous les scénarios
 *   PHASE5_SCENARIOS=A,E node scripts/…             # un sous-ensemble
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "jarvis-phase5-preuves");
const CHOISIS = (process.env["PHASE5_SCENARIOS"] ?? "").split(",").filter((s) => s !== "");

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
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${label}${detail ? " | " + detail : ""}`);
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

async function tourFlux(page, question, { attendreFin = true } = {}) {
  const t0 = Date.now();
  await page.locator(SELECTEUR_SAISIE).fill(question);
  await page.keyboard.press("Enter");

  let stopVu = false;
  try {
    await page.locator(`button[aria-label="${LIBELLE_STOP}"]`).waitFor({ timeout: 20_000 });
    stopVu = true;
  } catch {
    /* réponse trop rapide — accepté si la bulle arrive */
  }

  // ⚠️ UN DÉPASSEMENT DE DÉLAI NE DOIT PAS TUER L'INSTRUMENT. Le premier jet
  // levait, et la passe entière mourait au premier tour lent — en n'apprenant
  // RIEN, pas même ce que l'écran affichait. On note l'expiration comme un
  // RÉSULTAT et on lit la conversation telle qu'elle est : un message d'erreur
  // nommé y est une information, pas un échec de mesure.
  let expire = false;
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("p")]
          .filter((p) => p.className.includes("rounded-tl-sm"))
          .some((p) => p.textContent.trim().length > 0),
      undefined,
      { timeout: 180_000 },
    );
  } catch {
    expire = true;
  }
  const ttfd = Date.now() - t0;

  if (attendreFin) {
    await page
      .locator(`button[aria-label="${LIBELLE_STOP}"]`)
      .waitFor({ state: "detached", timeout: 240_000 })
      .catch(() => {});
  }

  const texte = await page.evaluate(() => {
    const bulles = [...document.querySelectorAll("p")].filter(
      (p) => p.className.includes("rounded-tl-sm") && p.textContent.trim().length > 0,
    );
    return bulles.length === 0 ? "" : bulles[bulles.length - 1].textContent.trim();
  });
  // Le fil ENTIER, pour voir les messages « systeme » (erreurs nommées) que la
  // dernière bulle Jarvis ne porte pas.
  const fil = await page.evaluate(() =>
    [...document.querySelectorAll("p")]
      .map((p) => p.textContent.trim())
      .filter((t) => t.length > 0)
      .slice(-6)
      .join(" ⏎ "),
  );
  return { stopVu, ttfd, total: Date.now() - t0, texte, expire, fil };
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

  // ══ LA CAPTURE — le cœur du scénario L ══
  // On enregistre la charge EXACTE émise vers la passerelle. Rien n'est filtré
  // ni tronqué ici : un instrument qui nettoierait ce qu'il capture ne
  // mesurerait plus que son propre nettoyage.
  const charges = [];
  page.on("request", (req) => {
    if (!req.url().includes("/functions/v1/jarvis-")) return;
    const corps = req.postData();
    if (corps !== null && corps !== undefined) {
      charges.push({ url: req.url().replace(/^https:\/\/[^/]+/, ""), corps });
    }
  });

  // Diagnostic : le STATUT des appels sortants. Sans lui, une erreur nommée à
  // l'écran ne dit pas si la passerelle a refusé, expiré, ou jamais répondu.
  page.on("response", (rep) => {
    const u = rep.url();
    if (u.includes("/functions/v1/") || u.includes("/rest/v1/rpc/")) {
      const court = u.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      if (rep.status() >= 400) console.log(`        [HTTP ${rep.status()}] ${court}`);
    }
  });

  const erreursPage = [];
  page.on("pageerror", (e) => erreursPage.push(String(e).slice(0, 160)));

  await relance(() => seConnecter(page, "owner.dev@invalid.local", env["DOCTOR_ACCOUNT_PASSWORD"]));
  await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
  await attendreHydratation(page, SELECTEUR_SAISIE);

  const reponses = {};

  /* ══ A · le prochain patient ══ */
  if (actif("A")) {
    console.log("\nA — « Qui est mon prochain patient ? »");
    const r = await tourFlux(page, "Qui est mon prochain patient ?");
    reponses["A"] = r.texte;
    if (r.expire) console.log(`        (expiration — fil : ${r.fil.slice(0, 200)})`);
    controle("A · une réponse non vide arrive", r.texte.length > 0, `${r.total} ms`);
    controle(
      "A · la réponse n'affiche AUCUN jeton non rendu",
      !/\{\{[A-Z]+_\d+\}\}/.test(r.texte),
      "aucun {{JETON}} à l'écran",
    );
    controle(
      "A · aucune référence irrésolue",
      !r.texte.includes("[référence inconnue]"),
      "carte d'identité cohérente",
    );
  }

  /* ══ E · finance du jour — encaissé ≠ facturé ══ */
  if (actif("E")) {
    console.log("\nE — « Combien j'ai encaissé aujourd'hui ? »");
    const r = await tourFlux(page, "Combien j'ai encaissé aujourd'hui ?");
    reponses["E"] = r.texte;
    if (r.expire) console.log(`        (expiration — fil : ${r.fil.slice(0, 200)})`);
    controle("E · une réponse non vide arrive", r.texte.length > 0, `${r.total} ms`);
    controle(
      "E · un montant en dinars est cité",
      /\d/.test(r.texte) && /(DA|dinar)/i.test(r.texte),
      "chiffre + unité",
    );
    controle(
      "E · aucun centime, aucune décimale",
      !/\d[.,]\d{2}\b/.test(r.texte),
      "dinars entiers (ADR-018)",
    );
  }

  /* ══ F · demain matin — l'état vide est un RÉSULTAT ══ */
  if (actif("F")) {
    console.log("\nF — « Qu'est-ce que j'ai demain matin ? »  (aucun RDV demain en base)");
    const r = await tourFlux(page, "Qu'est-ce que j'ai demain matin ?");
    reponses["F"] = r.texte;
    controle("F · une réponse non vide arrive", r.texte.length > 0, `${r.total} ms`);
    // ⚠️ LE CONTRÔLE QUI COMPTE. La base ne porte AUCUN rendez-vous demain.
    // Une réponse qui en inventerait un serait le pire défaut possible.
    controle(
      "F · l'absence de rendez-vous est DITE, pas comblée",
      /(aucun|pas de|rien|libre|vide)/i.test(r.texte),
      "état vide énoncé",
    );
  }

  /* ══ Hallucination · un domaine que le schéma ne porte pas ══ */
  if (actif("X")) {
    console.log("\nX — « Est-ce que mes patients ont fait leurs check-ins ? »");
    const r = await tourFlux(page, "Est-ce que mes patients ont fait leurs check-ins cette semaine ?");
    reponses["X"] = r.texte;
    if (r.expire) console.log(`        (expiration — fil : ${r.fil.slice(0, 200)})`);
    controle("X · une réponse non vide arrive", r.texte.length > 0, `${r.total} ms`);
    controle(
      "X · l'inexistence du domaine est DITE",
      /(n'existe pas|pas de (donn|suivi)|non disponible|pas enregistr|aucune donnée)/i.test(r.texte),
      "aucun chiffre inventé",
    );
  }

  /* ══ J · « Stop » coupe le flux ══ */
  if (actif("J")) {
    console.log("\nJ — interruption en cours de réponse");
    const t0 = Date.now();
    await page.locator(SELECTEUR_SAISIE).fill("Explique-moi en détail le trouble panique.");
    await page.keyboard.press("Enter");
    let coupe = false;
    try {
      const stop = page.locator(`button[aria-label="${LIBELLE_STOP}"]`);
      await stop.waitFor({ timeout: 30_000 });
      await stop.click();
      await stop.waitFor({ state: "detached", timeout: 30_000 });
      coupe = true;
    } catch {
      /* laissé rouge */
    }
    controle("J · le bouton d'arrêt coupe le flux", coupe, `${Date.now() - t0} ms`);
  }

  /* ══ K · changement de patient — zéro contamination ══ */
  if (actif("K")) {
    console.log("\nK — deux dossiers de suite, aucun mélange");
    await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const liens = await page.locator('a[href^="/patients/"]').all();
    const ids = [];
    for (const l of liens) {
      const href = await l.getAttribute("href");
      const m = /^\/patients\/([0-9a-f-]{36})$/.exec(href ?? "");
      if (m !== null && !ids.includes(m[1])) ids.push(m[1]);
    }
    controle("K · au moins deux dossiers atteignables", ids.length >= 2, `${ids.length} dossiers`);

    if (ids.length >= 2) {
      const textes = [];
      for (const id of ids.slice(0, 2)) {
        await page.goto(`${BASE}/patients/${id}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
        await attendreHydratation(page, SELECTEUR_SAISIE);
        const r = await tourFlux(page, "Résume-moi ce dossier en trois phrases.");
        textes.push(r.texte);
      }
      reponses["K"] = textes.join("\n---\n");
      controle("K · les deux réponses arrivent", textes.every((t) => t.length > 0));
      // ⚠️ DEUX RÉPONSES IDENTIQUES = LA CIBLE N'A PAS CHANGÉ. C'est le défaut
      // que ce scénario existe pour attraper, et il est INVISIBLE à l'œil : les
      // deux textes se lisent parfaitement bien chacun de leur côté.
      controle(
        "K · la seconde réponse n'est pas la première",
        textes[0] !== textes[1],
        "cible remplacée, pas accumulée",
      );
    }
  }

  /* ══ L · la charge réelle, capturée ══ */
  console.log("\nL — la charge émise vers la passerelle");
  controle("L · au moins une charge a été capturée", charges.length > 0, `${charges.length} charge(s)`);

  // ⚠️ ON SÉPARE LES CHAMPS DESTINÉS AU MODÈLE DES IDENTIFIANTS DE PROTOCOLE.
  // `conversationId` et `clientTurnId` SONT des UUID, et c'est voulu : §12 les
  // décrit comme des identifiants « sans signification ». Les inclure dans la
  // recherche d'UUID rendait le contrôle ROUGE en permanence pour une raison
  // fausse — et un contrôle qui crie toujours finit par ne plus être lu.
  const CHAMPS_MODELE = ["message", "contexte", "resultatsOutils", "capacites"];
  const versLeModele = charges
    .map((c) => {
      try {
        const o = JSON.parse(c.corps);
        return CHAMPS_MODELE.filter((k) => k in o)
          .map((k) => (typeof o[k] === "string" ? o[k] : JSON.stringify(o[k])))
          .join("\n");
      } catch {
        return c.corps;
      }
    })
    .join("\n");

  const toutesLesCharges = charges.map((c) => c.corps).join("\n");
  const fichier = path.join(PREUVES, "charges-passerelle.txt");
  writeFileSync(fichier, toutesLesCharges, "utf8");

  // Volet POSITIF, mesuré ici parce qu'il ne demande aucune identité : le
  // modèle doit avoir reçu des jetons et du contexte. Une charge vide passerait
  // tous les contrôles négatifs de la requête SQL qui suit.
  // ══ LA BOUCLE A-T-ELLE REBOUCLÉ ? — inconditionnel, et c'est le contrôle
  // qui prouve le correctif central de cette passe : un résultat de capacité
  // est REVENU au modèle dans un second envoi.
  const avecResultats = charges.filter((c) => c.corps.includes('"resultatsOutils"'));
  controle(
    "L · un résultat de capacité est RENVOYÉ au modèle",
    avecResultats.length > 0,
    `${avecResultats.length} envoi(s) porteur(s)`,
  );

  // ⚠️ LE VOLET POSITIF EST CONDITIONNEL, ET CE N'EST PAS UNE FACILITÉ.
  // Exiger un jeton sans condition rendait ce contrôle ROUGE le 2026-08-26 à
  // 12h02 — alors que les quatre rendez-vous du jour étaient à 08h30 et que
  // « aucun prochain patient » était la VRAIE réponse. Un contrôle qui rougit
  // sur un comportement correct apprend à ignorer le rouge ; on distingue donc
  // « pas de jeton parce que le pare-feu a échoué » de « pas de jeton parce
  // qu'il n'y avait personne à désigner », et le second n'est pas un défaut.
  const porteUnPatient = /"(ref|patient)":"(PATIENT|RDV)_/.test(versLeModele);
  const resultatNonVide = /"donnees":{[^}]/.test(versLeModele) && !/"creneaux":\[\]/.test(versLeModele);
  if (resultatNonVide) {
    controle(
      "L · le modèle reçoit bien des JETONS pseudonymes",
      porteUnPatient,
      "jetons présents",
    );
  } else {
    console.log(
      "  ~~~~  | L · jetons pseudonymes | SANS OBJET — les capacités n'ont rendu",
    );
    console.log(
      "        |                        | aucun individu (agenda vide à cette heure)",
    );
  }
  controle(
    "L · aucun UUID en clair dans la charge",
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(versLeModele),
    "identifiants réels absents",
  );
  controle(
    "L · aucun téléphone algérien dans la charge",
    !/\b0[5-7]\d{8}\b/.test(toutesLesCharges),
    "motif mobile absent",
  );
  controle(
    "L · aucune adresse de courriel dans la charge",
    !/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(toutesLesCharges),
    "motif courriel absent",
  );
  console.log(`\n  charges écrites dans : ${path.relative(RACINE, fichier)}`);
  console.log("  ⚠️ la comparaison AUX NOMS RÉELS se fait dans la base :");
  console.log("     scripts/mesure-jarvis-phase5-fuite.sql");

  controle("aucune erreur JavaScript de page", erreursPage.length === 0, erreursPage[0] ?? "");

  writeFileSync(
    path.join(PREUVES, "verdicts.json"),
    JSON.stringify({ verts, rouges, lignes, reponses }, null, 2),
    "utf8",
  );

  await nav.close();
  console.log(`\nVERDICT PHASE 5 : ${rouges === 0 ? "VERT" : `ROUGE — ${rouges} contrôle(s)`} (${verts} vert(s))`);
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ÉCHEC INSTRUMENT :", e);
  process.exit(2);
});
