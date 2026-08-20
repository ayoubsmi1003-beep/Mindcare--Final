/**
 * mesure-v3-navigateur — les contrôles de V3 qu'un `grep` ne peut pas rendre.
 *
 *   node scripts/mesure-v3-navigateur.mjs
 *
 * Prérequis : un serveur sur :3000, et un compte connectable
 * (`bash scripts/dev-account.sh`, fenêtre ADR-016).
 *
 * Quatre choses se constatent DANS un rendu réel, et nulle part ailleurs :
 *   1. le CONTRASTE effectif d'un texte sur le fond qu'il a VRAIMENT ;
 *   2. le fait qu'aucune valeur ne repose sur un dégradé ;
 *   3. le fait que `prefers-reduced-motion` éteint réellement le mouvement ;
 *   4. le fait que le MOBILIER de V3 est bien là — rail, orbe, en-tête héros.
 *
 * ── POURQUOI CE SCRIPT NE FAIT PAS CONFIANCE AU CSS QU'IL LIT ──────────────
 *
 * Un composant peut déclarer `color: var(--on-brand)` et se retrouver sur un
 * fond hérité de trois ancêtres plus haut. Le contraste ne se lit donc pas dans
 * une feuille de style : il se calcule entre la couleur CALCULÉE d'un texte et
 * le fond COMPOSÉ derrière lui — en remontant les ancêtres jusqu'au premier
 * fond opaque, et en composant les couches semi-transparentes rencontrées.
 * C'est exactement l'écart qui a fait tomber le jeton de blanc atténué de cette
 * session : mesuré sur un ancêtre, il passait ; mesuré là où il s'affichait, non.
 *
 * ── LE DÉGRADÉ EST TRAITÉ À PART, ET PLUS SÉVÈREMENT ──────────────────────
 *
 * Sous un dégradé, il n'y a pas UN contraste mais un intervalle : le fond varie
 * d'un bout du texte à l'autre. Un ratio moyen n'y veut rien dire. La règle
 * appliquée est donc binaire et volontairement dure — sur un fond dégradé, le
 * texte doit être BLANC PUR, sans quoi c'est rouge. C'est la conclusion du
 * calcul écrit dans `tokens.css`.
 *
 * ── TROIS FAUX VERTS QUE CE SCRIPT A LUI-MÊME PRODUITS ────────────────────
 *
 * Écrits ici parce qu'ils se reproduiront autrement :
 *   1. sans session, les écrans redirigent : il mesurait la page de connexion
 *      quatre fois et rendait « vert » pour quatre écrans jamais vus ;
 *   2. `/agenda` et `/finances` NE redirigent PAS — ils rendent leur squelette
 *      et gardent leur adresse. Vérifier l'URL ne suffisait donc pas ;
 *   3. d'où l'exigence de MOBILIER : sans rail affiché, l'écran est NON OBSERVÉ.
 * Un instrument qui rend vert sans avoir observé fabrique une preuve.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const PREUVES = path.join(RACINE, "checkpoints", "v3-preuves");

/**
 * Les écrans, avec le chemin d'ARRIVÉE attendu.
 *
 * `/` est une redirection PAR CONSTRUCTION (16 lignes vers `/patients`) : son
 * arrivée attendue n'est donc pas son adresse. Sans cette distinction, le
 * contrôle de redirection le déclarerait « non observé » alors qu'il fait
 * exactement ce qu'on lui demande.
 */
const ECRANS = [
  { chemin: "/connexion", arrivee: "/connexion", session: false },
  { chemin: "/", arrivee: "/patients", session: true },
  { chemin: "/patients", arrivee: "/patients", session: true },
  { chemin: "/agenda", arrivee: "/agenda", session: true },
  { chemin: "/finances", arrivee: "/finances", session: true },
  { chemin: "/agenda/nouveau", arrivee: "/agenda/nouveau", session: true },
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

/**
 * Attend que React ait ACCROCHÉ ses écouteurs au champ — piège de mesure connu.
 * La présence du nœud dans le DOM ne prouve rien : le HTML du serveur le
 * contient déjà, écouteurs absents. Remplir avant produit un envoi VIDE, donc
 * un « 400 validation_failed » qui s'affiche « erreur inattendue ».
 */
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
  // `pressSequentially` et non `fill` : on FRAPPE les touches, ce qui déclenche
  // les `onChange` de React. `fill` pose la valeur d'un coup et peut la poser
  // avant que React n'écoute.
  await page.locator('input[type="email"]').pressSequentially("owner.dev@invalid.local");
  await page.locator('input[type="password"]').pressSequentially(env["DEV_ACCOUNT_PASSWORD"] ?? "");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/patients/, { timeout: 60_000 });
}

/** Le calcul de contraste, injecté dans la page. Aucune dépendance. */
const SONDE = () => {
  const luminance = (r, g, b) => {
    const f = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const parse = (couleur) => {
    const m = couleur.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };

  const composer = (dessus, dessous) => ({
    r: dessus.r * dessus.a + dessous.r * (1 - dessus.a),
    g: dessus.g * dessus.a + dessous.g * (1 - dessus.a),
    b: dessus.b * dessus.a + dessous.b * (1 - dessus.a),
    a: 1,
  });

  const fondEffectif = (el) => {
    const couches = [];
    let n = el;
    while (n && n !== document.documentElement.parentNode) {
      const st = getComputedStyle(n);
      if (st.backgroundImage && st.backgroundImage.includes("gradient")) {
        return { degrade: true, couleur: null };
      }
      const bg = parse(st.backgroundColor);
      if (bg && bg.a > 0) {
        if (bg.a >= 0.999) {
          let base = bg;
          for (let i = couches.length - 1; i >= 0; i--) base = composer(couches[i], base);
          return { degrade: false, couleur: base };
        }
        couches.push(bg);
      }
      n = n.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = couches.length - 1; i >= 0; i--) base = composer(couches[i], base);
    return { degrade: false, couleur: base };
  };

  const resultats = [];
  for (const el of document.querySelectorAll("body *")) {
    const texte = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (texte === "") continue;

    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || parseFloat(st.opacity) < 0.1) continue;
    const boite = el.getBoundingClientRect();
    if (boite.width === 0 || boite.height === 0) continue;

    const avant = parse(st.color);
    if (!avant) continue;

    const taille = parseFloat(st.fontSize);
    const graisse = parseInt(st.fontWeight, 10) || 400;
    // WCAG : « grand texte » = ≥ 24px, ou ≥ 18.66px en gras. Plancher 3:1.
    const grand = taille >= 24 || (taille >= 18.66 && graisse >= 700);
    const plancher = grand ? 3 : 4.5;

    const fond = fondEffectif(el);
    const extrait = texte.slice(0, 42);

    if (fond.degrade) {
      const blancPur = avant.r >= 254 && avant.g >= 254 && avant.b >= 254 && avant.a >= 0.999;
      resultats.push({ texte: extrait, surDegrade: true, ok: blancPur, couleur: st.color, taille });
      continue;
    }

    const cAvant = avant.a >= 0.999 ? avant : composer(avant, fond.couleur);
    const l1 = luminance(cAvant.r, cAvant.g, cAvant.b);
    const l2 = luminance(fond.couleur.r, fond.couleur.g, fond.couleur.b);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    resultats.push({
      texte: extrait,
      surDegrade: false,
      ok: ratio >= plancher,
      ratio: Math.round(ratio * 100) / 100,
      plancher,
      couleur: st.color,
      taille,
    });
  }
  return resultats;
};

/**
 * LE MOBILIER DE V3, constaté et non déduit.
 *
 * Rend ce qui est RÉELLEMENT rendu : le rail et son fond, l'entrée active,
 * l'orbe Jarvis, l'en-tête héros et son dégradé, les fontes effectivement
 * appliquées. C'est la preuve que « le design existe dans le navigateur »,
 * distincte de « la page a chargé ».
 */
const SONDE_MOBILIER = () => {
  const rail = document.querySelector("nav[aria-label]");
  const actif = document.querySelector('nav a[aria-current="page"]');
  const heros = document.querySelector("header");
  const st = (el) => (el ? getComputedStyle(el) : null);

  const sr = st(rail);
  const sh = st(heros);
  const corps = getComputedStyle(document.body);

  // L'orbe : le seul objet qui porte `--grad-orb`.
  let orbe = null;
  for (const el of document.querySelectorAll("span,div,button")) {
    const bi = getComputedStyle(el).backgroundImage;
    if (bi && bi.includes("radial-gradient")) {
      orbe = { trouve: true, image: bi.slice(0, 60) };
      break;
    }
  }

  return {
    rail: rail
      ? {
          present: true,
          fond: sr.backgroundImage.slice(0, 70),
          ombre: sr.boxShadow.slice(0, 40),
          largeur: Math.round(rail.getBoundingClientRect().width),
          entrees: rail.querySelectorAll("a,div[aria-disabled]").length,
          bientot: rail.textContent.split("bientôt").length - 1,
        }
      : { present: false },
    actif: actif
      ? { present: true, libelle: actif.textContent.trim().slice(0, 24), ombre: st(actif).boxShadow.slice(0, 40) }
      : { present: false },
    orbe: orbe ?? { trouve: false },
    heros: heros
      ? { present: true, fond: sh.backgroundImage.slice(0, 70), rayon: sh.borderRadius }
      : { present: false },
    fondPage: corps.backgroundColor,
    fonteUi: corps.fontFamily.slice(0, 60),
  };
};

/** Compte les animations/transitions non nulles — contrôle reduced-motion. */
const SONDE_MOUVEMENT = () => {
  let vivantes = 0;
  const exemples = [];
  for (const el of document.querySelectorAll("body *")) {
    const st = getComputedStyle(el);
    const dureeA = parseFloat(st.animationDuration) || 0;
    const dureeT = parseFloat(st.transitionDuration) || 0;
    if (dureeA > 0.001 || dureeT > 0.001) {
      vivantes += 1;
      if (exemples.length < 3) exemples.push(`${el.tagName}.${el.className}`.slice(0, 60));
    }
  }
  return { vivantes, exemples };
};


/**
 * LE PARCOURS CLAVIER DU RAIL — mesuré, plus « vérifié à l'œil ».
 *
 * Deux choses, et la seconde est celle qu'on oublie :
 *   1. l'ORDRE de tabulation suit l'ordre visuel du rail ;
 *   2. chaque arrêt porte un focus RÉELLEMENT VISIBLE.
 *
 * Le point 2 est un piège propre à V3 : l'anneau de focus par défaut est
 * `--action-600`, c'est-à-dire la marque elle-même. Posé sur le rail — qui EST
 * la marque — il devient invisible. La classe `.sur-marque` bascule l'anneau en
 * blanc pour cette raison ; sans mesure, sa disparition ne se verrait jamais,
 * puisqu'un focus invisible ne se voit pas.
 */
const SONDE_CLAVIER = async (page) => {
  const arrets = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    const a = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const st = getComputedStyle(el);
      const dansRail = el.closest("nav[aria-label]") !== null;
      const largeur = parseFloat(st.outlineWidth) || 0;
      return {
        dansRail,
        libelle: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 28),
        focusVisible: st.outlineStyle !== "none" && largeur > 0,
        couleur: st.outlineColor,
      };
    });
    if (a === null) continue;
    arrets.push(a);
    if (arrets.filter((x) => x.dansRail).length > 0 && !a.dansRail) break;
  }
  const rail = arrets.filter((a) => a.dansRail);
  return {
    arretsRail: rail.length,
    sansFocusVisible: rail.filter((a) => !a.focusVisible).length,
    premier: rail[0]?.libelle ?? "aucun",
    couleur: rail[0]?.couleur ?? "-",
  };
};

/* ═══════════════════════════════════════════════════════════════════════════ */

if (!existsSync(PREUVES)) mkdirSync(PREUVES, { recursive: true });

const env = lireEnv();
if (!env["DEV_ACCOUNT_PASSWORD"]) {
  console.error("BLOQUÉ — DEV_ACCOUNT_PASSWORD absent de .env. Aucune session possible.");
  process.exit(2);
}

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

// Une SEULE session, réutilisée : se reconnecter à chaque écran multiplierait
// les lignes d'audit `app.search_patients` sans rien mesurer de plus.
let sessionOuverte = false;
try {
  await seConnecter(page, env);
  sessionOuverte = true;
} catch (e) {
  console.error(`BLOQUÉ — connexion impossible : ${String(e).slice(0, 160)}`);
}

const rapport = [];
for (const ecran of ECRANS) {
  if (ecran.session && !sessionOuverte) {
    rapport.push({ chemin: ecran.chemin, nonObserve: "session absente" });
    continue;
  }
  try {
    await page.goto(`${BASE}${ecran.chemin}`, { waitUntil: "networkidle" });
    // ⚠️ ATTENDRE LE RAIL, PAS UNE DURÉE. Un `waitForTimeout` généreux reste un
    // pari sur la vitesse de la machine : sous charge, la sonde tombe sur le
    // squelette de chargement — qui ne rend qu'un `<main>` nu, sans coquille —
    // et conclut « rail absent » sur un produit intact. Mesuré ici même le
    // 2026-08-20 sur le rail replié : `present:false`, alors que la capture
    // prise 200 ms plus tard montrait le rail au complet.
    if (ecran.session) {
      await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 30_000 });
    }
    await page.waitForTimeout(600);

    const arrivee = new URL(page.url()).pathname;
    if (arrivee !== ecran.arrivee) {
      rapport.push({ chemin: ecran.chemin, nonObserve: `arrivé sur ${arrivee}` });
      continue;
    }

    // Le mobilier AVANT le contraste : un écran sans rail n'a pas été rendu,
    // et mesurer son contraste donnerait un vert qui ne veut rien dire.
    const mobilier = await page.evaluate(SONDE_MOBILIER);
    if (ecran.session && !mobilier.rail.present) {
      rapport.push({ chemin: ecran.chemin, nonObserve: "squelette — rail absent" });
      continue;
    }

    const resultats = await page.evaluate(SONDE);
    const fichier = path.join(PREUVES, `${ecran.arrivee.replace(/\//g, "_") || "_racine"}.png`);
    await page.screenshot({ path: fichier, fullPage: false });

    rapport.push({
      chemin: ecran.chemin,
      arrivee,
      total: resultats.length,
      echecs: resultats.filter((x) => !x.ok),
      mobilier,
      preuve: path.relative(RACINE, fichier),
    });
  } catch (e) {
    rapport.push({ chemin: ecran.chemin, erreur: String(e).slice(0, 140) });
  }
}

// ── Mouvement réduit, sur un écran AUTHENTIFIÉ (le rail est ce qui anime) ──
const ctxR = await nav.newContext({ reducedMotion: "reduce", viewport: { width: 1920, height: 1080 } });
const pageR = await ctxR.newPage();
let mouvement = { vivantes: -1, exemples: ["non mesuré"] };
try {
  await seConnecter(pageR, env);
  await pageR.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await pageR.waitForSelector("nav[aria-label]", { state: "visible", timeout: 30_000 });
  await pageR.waitForTimeout(600);
  mouvement = await pageR.evaluate(SONDE_MOUVEMENT);
} catch (e) {
  mouvement = { vivantes: -1, exemples: [String(e).slice(0, 60)] };
}
await ctxR.close();

// ── Le rail REPLIÉ, sous la rupture tablet — §3 enfin tenu ────────────────
const ctxC = await nav.newContext({ viewport: { width: 900, height: 1000 } });
const pageC = await ctxC.newPage();
let repli = { mesure: false };
try {
  await seConnecter(pageC, env);
  await pageC.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await pageC.waitForSelector("nav[aria-label]", { state: "visible", timeout: 30_000 });
  await pageC.waitForTimeout(600);
  const m = await pageC.evaluate(SONDE_MOBILIER);
  await pageC.screenshot({ path: path.join(PREUVES, "_rail-replie-900px.png") });
  repli = { mesure: true, largeur: m.rail.largeur, present: m.rail.present };
} catch (e) {
  repli = { mesure: false, erreur: String(e).slice(0, 80) };
}
await ctxC.close();

// ── Parcours clavier, sur un écran authentifié en pleine largeur ──────────
let clavier = { arretsRail: 0, sansFocusVisible: -1, premier: "non mesuré", couleur: "-" };
try {
  await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await page.waitForSelector("nav[aria-label]", { state: "visible", timeout: 30_000 });
  clavier = await SONDE_CLAVIER(page);
} catch (e) {
  clavier = { arretsRail: 0, sansFocusVisible: -1, premier: String(e).slice(0, 50), couleur: "-" };
}

await ctx.close();
await nav.close();

/* ── Verdict ─────────────────────────────────────────────────────────────── */

console.log("═══ MESURE V3 — NAVIGATEUR RÉEL, SESSION AUTHENTIFIÉE ═══\n");
let totalEchecs = 0;
let nonObserves = 0;

for (const e of rapport) {
  if (e.erreur) {
    console.log(`  ERREUR  ${e.chemin} — ${e.erreur}`);
    totalEchecs += 1;
    continue;
  }
  if (e.nonObserve) {
    console.log(`  BLOQUÉ  ${e.chemin.padEnd(18)} NON OBSERVÉ — ${e.nonObserve}`);
    nonObserves += 1;
    continue;
  }
  const n = e.echecs.length;
  totalEchecs += n;
  console.log(
    `  ${n === 0 ? "vert  " : "ROUGE "}  ${e.chemin.padEnd(18)} ${String(e.total).padStart(3)} textes · ${n} sous le plancher   → ${e.preuve}`,
  );
  for (const f of e.echecs.slice(0, 6)) {
    const detail = f.surDegrade
      ? `SUR DÉGRADÉ, couleur ${f.couleur} (blanc pur exigé)`
      : `${f.ratio}:1 < ${f.plancher}:1 · ${f.couleur} · ${f.taille}px`;
    console.log(`            « ${f.texte} » → ${detail}`);
  }
}

console.log("\n── Mobilier V3 réellement rendu ────────────────────────────────");
const avecMobilier = rapport.find((r) => r.mobilier && r.mobilier.rail.present);
if (avecMobilier) {
  const m = avecMobilier.mobilier;
  console.log(`  rail        présent · ${m.rail.largeur}px · ${m.rail.entrees} entrées · ${m.rail.bientot} « bientôt »`);
  console.log(`  rail fond   ${m.rail.fond}`);
  console.log(`  actif       ${m.actif.present ? `« ${m.actif.libelle} » · lueur ${m.actif.ombre !== "none" ? "oui" : "NON"}` : "ABSENT"}`);
  console.log(`  orbe Jarvis ${m.orbe.trouve ? m.orbe.image : "ABSENT"}`);
  console.log(`  héros       ${m.heros.present ? `${m.heros.fond} · rayon ${m.heros.rayon}` : "absent"}`);
  console.log(`  fond page   ${m.fondPage}`);
  console.log(`  fonte UI    ${m.fonteUi}`);
} else {
  console.log("  AUCUN écran authentifié rendu — mobilier non constaté.");
}
console.log(
  `  repli <1024 ${repli.mesure ? `rail ${repli.largeur}px (attendu ~72)` : `non mesuré ${repli.erreur ?? ""}`}`,
);

console.log(
  `\n  ${mouvement.vivantes === 0 ? "vert  " : "ROUGE "}  prefers-reduced-motion · ${mouvement.vivantes} animation(s) vivante(s)`,
);
if (mouvement.vivantes > 0) console.log(`            ex. ${mouvement.exemples.join(" · ")}`);

const clavierOk = clavier.arretsRail > 0 && clavier.sansFocusVisible === 0;
console.log(
  `  ${clavierOk ? "vert  " : "ROUGE "}  parcours clavier du rail · ${clavier.arretsRail} arrêts · ${clavier.sansFocusVisible} sans focus visible`,
);
console.log(`            premier arrêt « ${clavier.premier} » · anneau ${clavier.couleur}`);

const empreinte = createHash("sha256")
  .update(JSON.stringify(rapport.map((r) => [r.chemin, r.total ?? null, (r.echecs ?? []).length])))
  .digest("hex")
  .slice(0, 16);
writeFileSync(
  path.join(PREUVES, "rapport.json"),
  JSON.stringify({ empreinte, rapport, mouvement, repli, clavier }, null, 2),
);

console.log(
  `\n═══ ${totalEchecs} échec(s) de contraste · ${nonObserves} écran(s) NON OBSERVÉ(S) · empreinte ${empreinte} ═══`,
);
if (nonObserves > 0) {
  console.log("  Un écran non observé n'est NI vert NI rouge. `bash scripts/dev-account.sh`.");
}
// La porte échoue fermée : un écran non observé empêche le vert, au même titre
// qu'un échec mesuré.
process.exit(totalEchecs === 0 && mouvement.vivantes === 0 && nonObserves === 0 && clavierOk ? 0 : 1);
