/**
 * mesure-v3-patients-navigateur.mjs — contrôles navigateur de la clôture V3,
 * patrons `mesure-v3-navigateur.mjs` (sondes DOM, fausse-session bannie) et
 * `mesure-reception.mjs` (verdicts vert/ROUGE nommés).
 *
 *   node scripts/mesure-v3-patients-navigateur.mjs           # phase 1
 *   node scripts/mesure-v3-patients-navigateur.mjs --phase2  # fraîcheur modifiée
 *
 * Entre les DEUX phases, le protocole de clôture applique la mutation de
 * fraîcheur (RDV de DEMAIN, UUID fixe c1000000-…a202, INSERT rejouable) :
 * `resume.a_jour` est recalculé EN BASE au prochain passage.
 *
 * Rôles : …a2 UNIQUEMENT (fenêtre ADR-016 ouverte). …a3 reste INCONNECTABLE —
 * sa preuve combine l'impersonation SQL déjà verte (checkpoint C5/C6) et le
 * témoin positif de composition sous …a2 ; la réserve est NOMMÉE dans STATE.
 * Aucun secret n'est imprimé ; aucune donnée Tier-0 ne sort (tout appel
 * réseau vise le projet Supabase du cabinet, comme le navigateur).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "v3-preuves");
const PHASE2 = process.argv.includes("--phase2");
const DEPUIS_C6 =
  process.argv.includes("--depuis-c6") || process.argv.includes("--phase2");
const DEPUIS_C4 =
  process.argv.includes("--depuis-c4") ||
  process.argv.includes("--phase2") ||
  DEPUIS_C6;

const B2 = "00000000-0000-0000-0000-0000000000b2"; // fixture T1 (résumé v1)
let ID_CREE = process.env["MC_ID_CREE"] ?? ""; // dossier créé au contrôle 1

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
  await page.locator('input[type="email"]').pressSequentially("praticien2.dev@invalid.local");
  await page.locator('input[type="password"]').pressSequentially(env["DOCTOR_ACCOUNT_PASSWORD"] ?? "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/patients/, { timeout: 60_000 });
}

async function ouvrirFiche(page, id) {
  await page.goto(`${BASE}/patients/${id}`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-label="Aujourd\'hui"]').waitFor({ timeout: 30_000 });
}

/** Coupe TOUTE fonction Edge : chemin client réel d'une panne fournisseur. */
async function couperFonctions(page) {
  await page.route(/\/functions\/v1\//, async (route) => route.abort());
}

const SONDE_CLAVIER = async (page) => {
  const arrets = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const a = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const st = getComputedStyle(el);
      return {
        libelle: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 26),
        focusVisible: st.outlineStyle !== "none" && (parseFloat(st.outlineWidth) || 0) > 0,
      };
    });
    if (a !== null) arrets.push(a);
  }
  return arrets;
};

async function main() {
  const env = lireEnv();
  mkdirSync(PREUVES, { recursive: true });

  const nav = await chromium.launch();
  const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await seConnecter(page, env);

  /* ══ PHASE 1 ═══════════════════════════════════════════════════════════ */
  if (!PHASE2) {
    // Reprise depuis C4 : l'identifiant du dossier créé par une exécution
    // antérieure est relu des preuves — AUCUN dossier supplémentaire n'est créé.
    if (DEPUIS_C4) {
      const fichierId = path.join(PREUVES, "mc-id-cree.txt");
      if (existsSync(fichierId)) ID_CREE = readFileSync(fichierId, "utf8").trim();
    }
    // ── Contrôle 1 · création UI → redirection fiche + P-nnnx ────────────
    const suffixe = Date.now().toString().slice(-6);
    const nomDoublon = `Cloture${suffixe}`;
    if (!DEPUIS_C4) {
    await page.goto(`${BASE}/patients/nouveau`, { waitUntil: "domcontentloaded" });
    await attendreHydratation(page, "form input");
    const pliable = page.getByRole("button", { name: "Informations complémentaires" });
    if ((await pliable.getAttribute("aria-expanded")) === "false") await pliable.click();
    await page.getByLabel("Prénom", { exact: true }).fill("Sonde");
    await page.getByLabel("Nom", { exact: true }).fill(nomDoublon);
    await page.getByLabel("Téléphone", { exact: true }).fill("05 11 22 33 44");
    await page.getByLabel("Date de naissance").fill("1994-03-03");
    await page.getByRole("button", { name: "Créer le dossier" }).click();
    await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    ID_CREE = page.url().match(/[0-9a-f-]{36}$/)[0];
    const numeroCree = (await page.getByText(/^P-\d{4}$/).first().textContent({ timeout: 30_000 })) ?? "";
    controle(
      "C1 · création : trio requis → fiche + numéro P-nnnx",
      /^P-\d{4}$/.test(numeroCree.trim()),
      `numéro=${numeroCree.trim()} · id=${ID_CREE}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c1-creation-fiche.png") });

    // ── Contrôle 2 · doublon fort : panneau + case obligatoire ───────────
    await page.goto(`${BASE}/patients/nouveau`, { waitUntil: "domcontentloaded" });
    await attendreHydratation(page, "form input");
    const pliable2 = page.getByRole("button", { name: "Informations complémentaires" });
    if ((await pliable2.getAttribute("aria-expanded")) === "false") await pliable2.click();
    await page.getByLabel("Prénom", { exact: true }).fill("Sonde");
    await page.getByLabel("Nom", { exact: true }).fill(nomDoublon);
    await page.getByLabel("Téléphone", { exact: true }).fill("05 11 22 33 44");
    await page.getByLabel("Date de naissance").fill("1994-03-03");
    // Le panneau peut rester INERTE (défaut suspecté) : on capture son état
    // réel après le débounce + aller-retour, sans faire tomber la session.
    await page.waitForTimeout(4000);
    const panneauTexte = await page
      .locator("section")
      .filter({ hasText: "Patients similaires" })
      .first()
      .innerText();
    // ⚠️ Le titre du PanneauInfo est rendu en CSS `uppercase` : innerText rend
    // des CAPITALES. La comparaison est insensible à la casse — l'intention du
    // contrôle (voir la bannière de match fort) ne change pas. (Instrument
    // corrigé le 2026-08-24 : le contrôle ne pouvait jamais passer contre un
    // titre en capitales — famille « l'instrument avant le produit », V8 §4.)
    const banniereForte = panneauTexte
      .toLowerCase()
      .includes("ce dossier semble correspondre");
    const caseVisible = (await page.locator('form input[type="checkbox"]').count()) > 0;
    let desactiveAvant = false;
    let actifApres = false;
    if (caseVisible) {
      const boutonCreer = page.getByRole("button", { name: "Créer le dossier" });
      desactiveAvant = await boutonCreer.isDisabled();
      await page.locator('form input[type="checkbox"]').check();
      actifApres = !(await boutonCreer.isDisabled());
      await page.locator('form input[type="checkbox"]').uncheck();
    }
    controle(
      "C2 · doublon fort : panneau actif + « Créer malgré tout » obligatoire",
      banniereForte && caseVisible && desactiveAvant && actifApres,
      `bannière=${banniereForte} · case=${caseVisible} · bloqué-sans-case=${desactiveAvant} · débloqué=${actifApres}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c2-doublon-fort.png") });
    await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });

    // ── Contrôle 3 · bandeau Aujourd'hui fidèle + action dominante ───────
    await ouvrirFiche(page, B2);
    const demarrerB2 = await page.locator("header").getByText("Démarrer la séance").count();
    const bandeauB2 = await page.locator('[aria-label="Aujourd\'hui"]').innerText();
    controle(
      "C3a · b2 (RDV du jour posé) : action dominante Démarrer la séance",
      demarrerB2 > 0 && !bandeauB2.includes("Aucun rendez-vous"),
      `bandeau=« ${bandeauB2.replace(/\s+/g, " ").slice(0, 80)} »`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c3a-bandeau-rdv-du-jour.png") });

    await ouvrirFiche(page, ID_CREE);
    const nouveauCree = await page.locator("header").getByText("Nouveau rendez-vous").count();
    const bandeauCree = await page.locator('[aria-label="Aujourd\'hui"]').innerText();
    controle(
      "C3b · dossier sans RDV : action dominante Nouveau rendez-vous",
      nouveauCree > 0 && bandeauCree.includes("Aucun rendez-vous aujourd'hui"),
      `bandeau=« ${bandeauCree.replace(/\s+/g, " ").slice(0, 80)} »`,
    );

    } // ── fin DEPUIS_C4 : les contrôles 1→3 ne rejouent pas leurs écritures ─

    // ── Contrôle 4a · résumé affiché : sections, Pourquoi ?, À jour ──────
    if (!DEPUIS_C6) {
    await ouvrirFiche(page, B2);
    const enBref = await page.getByText("En bref").count();
    const evolution = await page.getByText("Évolution récente").count();
    const aJour = await page.getByText("À jour", { exact: true }).count();
    controle(
      "C4a · résumé : sections rendues + fraîcheur « À jour »",
      enBref > 0 && evolution > 0 && aJour > 0,
      `en_bref=${enBref > 0} évolution=${evolution > 0} à_jour=${aJour > 0}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c4a-resume-a-jour.png") });
    await page
      .getByRole("button", { name: "Pourquoi ?", exact: true })
      .first()
      .click();
    const sourcesVisibles = await page.getByText("Sources", { exact: false }).first().isVisible();
    // Navigation vers l'onglet porteur : les cibles de sources portent le
    // libellé de l'onglet (« Clinique », « Échelles · Clinique », …).
    let navigationOk = false;
    try {
      await page
        .getByRole("button")
        .filter({ hasText: "Clinique" })
        .last()
        .click({ timeout: 5000 });
      await page.waitForTimeout(400);
      const actif = await page.locator('[role="tab"][aria-selected="true"]').innerText();
      navigationOk = actif.includes("Clinique");
    } catch { navigationOk = false; }
    controle(
      "C4b · « Pourquoi ? » ouvre les sources et navigue vers l’onglet porteur",
      sourcesVisibles && navigationOk,
      `sources=${sourcesVisibles} · navigation=${navigationOk}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c4b-pourquoi-sources.png") });

    // ── Contrôle 5a · fonction coupée, dossier SANS résumé → repli honnête ─
    await couperFonctions(page);
    await ouvrirFiche(page, ID_CREE);
    await page.getByRole("button", { name: "Générer le résumé" }).click();
    let pointSituation = false;
    try {
      await page.locator('[aria-label="Point de situation du dossier"]').waitFor({ timeout: 20_000 });
      pointSituation = true;
    } catch { pointSituation = false; }
    const sousTitre = pointSituation
      ? await page.locator('[aria-label="Point de situation du dossier"]').innerText()
      : "";
    controle(
      "C5a · coupure sans résumé : Point de situation « données directes »",
      pointSituation && sousTitre.includes("ce n'est pas un résumé IA"),
      `visible=${pointSituation}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c5a-point-de-situation.png") });

    // ── Contrôle additionnel · espace de travail utilisable SANS IA ──────
    const ongletsAttendus = ["Chronologie", "Clinique", "Traitements", "Rendez-vous", "Documents"];
    let ongletsOk = true;
    const detailsOnglets = [];
    for (const nom of ongletsAttendus) {
      try {
        await page.locator('[role="tab"]').filter({ hasText: nom }).click();
        await page.waitForTimeout(700);
        const panneau = await page.locator('[role="tabpanel"]').innerText();
        const crash = panneau.includes("Une erreur inattendue");
        if (crash) ongletsOk = false;
        detailsOnglets.push(`${nom}:${crash ? "CRASH" : "ok"}`);
      } catch {
        ongletsOk = false;
        detailsOnglets.push(`${nom}:ABSENT`);
      }
    }
    const identiteOk = (await page.getByText("TEST-0002").count()) > 0 || ID_CREE.length === 36;
    controle(
      "AI-offline · workspace pleinement navigable fonctions coupées",
      ongletsOk,
      detailsOnglets.join(" · "),
    );
    await page.unroute(/\/functions\/v1\//);

    } // ── fin DEPUIS_C6 : C4/C5 + AI-offline ne rejouent pas ──────────────

    // ── Contrôle 6 · contamination Jarvis A→B + refus ADR-023 ────────────
    await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
    await attendreHydratation(page, "#recherche-patients");
    await page.locator(`main a[href="/patients/${B2}"]`).first().click(); // navigation CLIENT
    await page.locator('[aria-label="Aujourd\'hui"]').waitFor({ timeout: 30_000 });
    const nomA = (await page.locator("header h1").innerText()).trim();
    await page.keyboard.press("Control+k");
    await page.locator('aside[aria-label="Jarvis"]').waitFor({ timeout: 15_000 });
    const puceA = await page.locator('aside[aria-label="Jarvis"]').innerText();
    const puceExacteA = puceA.includes("Patient actif") && puceA.includes(nomA.split("\n")[0]);
    await page.keyboard.press("Control+k"); // refermer
    await page.goBack(); // navigation CLIENT vers la liste — cleanup attendu
    await page.waitForTimeout(600);
    await page.locator(`main a[href="/patients/${ID_CREE}"]`).first().click();
    await page.locator('[aria-label="Aujourd\'hui"]').waitFor({ timeout: 30_000 });
    const nomB = (await page.locator("header h1").innerText()).trim();
    await page.keyboard.press("Control+k");
    await page.locator('aside[aria-label="Jarvis"]').waitFor({ timeout: 15_000 });
    const puceB = await page.locator('aside[aria-label="Jarvis"]').innerText();
    const contamination = puceB.includes(nomA);
    controle(
      "C6a · changement de dossier : contexte précédent effacé, puce exacte",
      puceExacteA && !contamination,
      `puce A exacte=${puceExacteA} · « ${nomA.slice(0, 20)} » résiduel=${contamination}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c6-contexte-b.png") });

    // Question interdite — VRAI chemin Jarvis (fonctions rétablies).
    await page
      .locator('aside[aria-label="Jarvis"] input:not([disabled])')
      .last()
      .fill("Karim est-il dépressif ?");
    await page.keyboard.press("Enter");
    let refusTexte = null;
    try {
      const cible = page.getByText(/Je ne conclus pas sur une (personne|patiente ou un patient) nommée/);
      await cible.first().waitFor({ timeout: 120_000 });
      refusTexte = (await cible.first().textContent()) ?? "";
    } catch {
      refusTexte = null;
    }
    controle(
      "C6b · « Karim est-il dépressif ? » → refus ADR-023",
      refusTexte !== null,
      refusTexte === null
        ? "réponse absente hors délai"
        : `refus rendu (« ${refusTexte.slice(0, 60)}… ») — libellé passerelle ≠ constante i18n : divergence NOMMÉE`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c6-refus-adr023.png") });
    await page.keyboard.press("Control+k");

    // ── Contrôle 7 · composition pilotée par le workspace (témoin …a2) ───
    await ouvrirFiche(page, B2);
    const ongletsTexte = await page.locator('[role="tab"]').allInnerTexts();
    const compositionComplete =
      ongletsTexte.length === 6 &&
      ongletsTexte.some((t) => t.includes("Chronologie")) &&
      ongletsTexte.some((t) => t.includes("Clinique")) &&
      ongletsTexte.some((t) => t.includes("Traitements"));
    controle(
      "C7 · témoin positif : onglets COMPOSÉS depuis le workspace (…a2)",
      compositionComplete,
      `onglets=[${ongletsTexte.map((t) => t.trim()).join(" · ")}]`,
    );

    // ── Contrôle 8 · 1280 px, clavier, mouvement réduit ───────────────────
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    const debord = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: (() => {
        const m = document.querySelector("main");
        return m ? m.scrollWidth - m.clientWidth : -999;
      })(),
      coupable: (() => {
        const m = document.querySelector("main");
        if (m === null) return "aucun";
        const droite = m.getBoundingClientRect().right;
        for (const el of m.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.right > droite + 1 && r.width > 40) {
            return `${el.tagName} w=${Math.round(r.width)} > ${Math.round(droite)} · classes=${String(el.className).slice(0, 70)}`;
          }
        }
        return "aucun élément au-delà de <main>";
      })(),
    }));
    controle(
      "C8a · 1280 px : zéro débordement horizontal",
      debord.doc <= 1 && debord.main <= 1,
      `doc=${debord.doc}px · main=${debord.main}px · coupable: ${debord.coupable}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c8-1280.png") });
    const arrets = await SONDE_CLAVIER(page);
    const sansFocus = arrets.filter((a) => !a.focusVisible).length;
    controle(
      "C8b · parcours clavier complet, focus toujours visible",
      arrets.length >= 10 && sansFocus === 0,
      `${arrets.length} arrêts · ${sansFocus} sans anneau`,
    );
  }

  /* ══ PHASE 2 ═══════════════════════════════════════════════════════════ */
  if (PHASE2) {
    // Mutation de fraîcheur APPLIQUÉE entre les phases (RDV de demain).
    await ouvrirFiche(page, B2);
    const modifie = await page.getByText("Données modifiées depuis ce résumé").count();
    const actualiser = await page.getByRole("button", { name: "Actualiser", exact: true }).count();
    controle(
      "C4c · source modifiée : fraîcheur bascule + « Actualiser » visible",
      modifie > 0 && actualiser > 0,
      `badge=${modifie > 0} · bouton=${actualiser > 0}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c4c-modifie-actualiser.png") });

    // ── Contrôle 5b · Actualiser sous coupure : ANCIEN résumé conservé ───
    await couperFonctions(page);
    await page.getByRole("button", { name: "Actualiser", exact: true }).first().click();
    await page.waitForTimeout(2500);
    const ancienConserve = (await page.getByText("En bref").count()) > 0;
    const pasDeCrash = !(await page.evaluate(() => document.body.innerText.includes("Une erreur inattendue")));
    const utilisable = (await page.locator('[role="tab"]').count()) >= 5;
    controle(
      "C5b · coupure pendant Actualiser : ancien résumé conservé, page utilisable",
      ancienConserve && pasDeCrash && utilisable,
      `ancien=${ancienConserve} · crash=${!pasDeCrash} · onglets=${utilisable}`,
    );
    await page.screenshot({ path: path.join(PREUVES, "c5b-ancien-conserve.png") });
    await page.unroute(/\/functions\/v1\//);

    // ── Mouvement réduit (contrôle 8c), contexte réduit dédié ─────────────
    const ctxR = await nav.newContext({ reducedMotion: "reduce", viewport: { width: 1920, height: 1080 } });
    const pageR = await ctxR.newPage();
    try {
      await seConnecter(pageR, env);
      await ouvrirFiche(pageR, B2);
      await pageR.waitForTimeout(800);
      const animations = await pageR.evaluate(() => document.getAnimations().length);
      controle("C8c · prefers-reduced-motion : rien ne bouge", animations === 0, `${animations} animation(s)`);
    } catch (e) {
      controle("C8c · prefers-reduced-motion : rien ne bouge", false, String(e).slice(0, 80));
    }
    await ctxR.close();
  }

  writeFileSync(path.join(PREUVES, "mc-id-cree.txt"), ID_CREE);

  const fichierRapport = path.join(PREUVES, "rapport-navigateur.json");
  let precedent = {};
  if (existsSync(fichierRapport)) {
    try { precedent = JSON.parse(readFileSync(fichierRapport, "utf8")); } catch { precedent = {}; }
  }
  const rapport = {
    ...precedent,
    date: new Date().toISOString(),
    [`phase${PHASE2 ? 2 : 1}`]: { resultats: lignes, verts, rouges },
  };
  writeFileSync(fichierRapport, JSON.stringify(rapport, null, 2));

  console.log("");
  console.log(`MESURE NAVIGATEUR V3 ${PHASE2 ? "PHASE 2" : "PHASE 1"} — ${verts} verts · ${rouges} ROUGE`);
  console.log(`preuves : ${PREUVES}`);
  await nav.close();
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
