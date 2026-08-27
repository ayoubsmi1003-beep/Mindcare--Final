/**
 * mesure-reveil-navigateur — « ALEXA » PRONONCÉ DANS UN VRAI NAVIGATEUR.
 *
 *   pnpm dev                                     (mode DEV obligatoire)
 *   node scripts/mesure-reveil-navigateur.mjs
 *
 * ═══ LA ZONE QUE PERSONNE NE COUVRAIT ═══
 *
 * Il existait deux instruments, et un trou entre les deux :
 *
 *   `eval-reveil-pipeline`      la chaîne ONNX, sous Node. Ne touche NI le
 *                               micro, NI l'AudioContext, NI le WASM du
 *                               navigateur.
 *   `mesure-voix-navigateur`    le navigateur — mais avec le micro factice de
 *                               Chromium, qui émet un BIP. Un bip ne réveille
 *                               rien, donc ce script n'a jamais pu constater un
 *                               réveil : il vérifiait l'ARMEMENT et s'arrêtait là.
 *
 * Entre les deux vivait le défaut du 2026-08-27 : le mel recevait 1280
 * échantillons au lieu de 1280+480, rendait 5 trames au lieu de 8, et l'axe du
 * temps se dilatait de 1,6×. La chaîne ONNX tournait — donc Node était vert.
 * Le moteur s'armait — donc le navigateur était vert. Et « Alexa » n'était pas
 * reconnu, parce que PERSONNE NE LE DISAIT NULLE PART.
 *
 * Ce script le dit. `--use-file-for-fake-audio-capture` fait lire à Chromium un
 * VRAI enregistrement de parole à travers le VRAI `getUserMedia` : le flux
 * traverse le rééchantillonnage de l'AudioContext, le `ScriptProcessorNode` et
 * l'ONNX en WASM, exactement comme la voix de la praticienne.
 *
 * ⚠️ CE QU'IL NE PROUVE TOUJOURS PAS. La fixture est une voix de SYNTHÈSE, pas
 * la voix de la praticienne, et elle n'a traversé ni la pièce ni le micro du
 * poste. Ce script prouve que la CHAÎNE reconnaît le mot de bout en bout dans
 * le navigateur ; il ne prouve pas le taux de réussite sur une voix humaine
 * dans une pièce réelle. Cette dernière mesure exige quelqu'un devant le poste,
 * et aucun automate ne la remplace. C'est écrit ici pour que personne ne lise
 * ce vert comme plus large qu'il n'est.
 *
 * ═══ LE CONTRÔLE NÉGATIF EST AUSSI IMPORTANT QUE LE POSITIF ═══
 *
 * Un détecteur qui réveille sur tout serait « vert » sur la seule fixture
 * « Alexa ». La seconde passe joue une phrase SANS le mot : elle doit NE PAS
 * réveiller. Sans elle, ce script certifierait un seuil tombé à zéro.
 *
 * Aucun secret imprimé. Compte praticienne du jeu de développement.
 */
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

import { fixtureWav } from "./fixtures-voix.mjs";

const BASE = process.env["MESURE_URL"] ?? "http://localhost:3000";
const RACINE = process.cwd();

const env = {};
for (const l of readFileSync(`${RACINE}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}

let verts = 0;
let rouges = 0;
const controle = (label, ok, detail = "") => {
  ok ? (verts += 1) : (rouges += 1);
  console.log(`${ok ? "vert  " : "ROUGE "} | ${label.padEnd(52)}${detail ? " | " + detail : ""}`);
};

/**
 * Une passe complète : un navigateur neuf dont le micro EST le fichier donné.
 *
 * ⚠️ UN NAVIGATEUR PAR FIXTURE, ET C'EST VOULU. Le fichier de capture se choisit
 * au LANCEMENT de Chromium ; le changer en cours de route est impossible. Deux
 * passes coûtent deux démarrages, et c'est le prix d'un contrôle négatif réel.
 */
async function passe(nomFixture, attenduReveil) {
  // Fabriquée à la demande, hors du dépôt — voir `fixtures-voix.mjs` : aucun
  // fichier audio ne doit exister sous git (préflight, contrôle 3).
  const wav = await fixtureWav(nomFixture);
  const navigateur = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      // La ligne qui fait tout : le micro factice ne bipe plus, il PARLE.
      `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const contexte = await navigateur.newContext({ permissions: ["microphone"] });
  await contexte.grantPermissions(["microphone"], { origin: BASE });
  const page = await contexte.newPage();
  // Compilation à froid de Next : la première route d'une session peut mettre
  // bien plus de 30 s. Un délai par défaut trop court ferait accuser le
  // détecteur d'un échec qui appartient au serveur de développement.
  page.setDefaultNavigationTimeout(180_000);

  const journal = [];
  page.on("console", (m) => journal.push(m.text()));
  page.on("pageerror", (e) => journal.push(`PAGEERROR ${e.message}`));

  try {
    await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 60_000 });
    // Attendre l'HYDRATATION, pas la visibilité — voir mesure-voix-navigateur.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[type="email"]');
        return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
      },
      undefined,
      { timeout: 60_000 },
    );
    await page.locator('input[type="email"]').pressSequentially("praticien2.dev@invalid.local");
    await page.locator('input[type="password"]').pressSequentially(env["DOCTOR_ACCOUNT_PASSWORD"]);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60_000 });

    await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
    const orbe = page.locator('button[aria-label*="—"]').first();
    await orbe.waitFor({ state: "visible", timeout: 30_000 });

    // Premier clic : ARME le détecteur (charge les trois ONNX).
    await orbe.click();
    await page
      .waitForFunction(
        () => {
          const b = [...document.querySelectorAll("button")].find((x) =>
            (x.getAttribute("aria-label") ?? "").includes("—"),
          );
          const l = b?.getAttribute("aria-label") ?? "";
          return l.includes("Dites") || l.includes("Erreur") || l.includes("moteur");
        },
        undefined,
        { timeout: 120_000 },
      )
      .catch(() => {});
    const arme = (await orbe.getAttribute("aria-label")) ?? "";
    controle(`[${nomFixture}] mot de réveil armé`, arme.includes("Dites"), arme.slice(0, 70));
    if (!arme.includes("Dites")) {
      await navigateur.close();
      return;
    }

    // ── L'ATTENTE. La fixture tourne en boucle ; on écoute le journal. ──
    const debut = Date.now();
    let detecte = false;
    while (Date.now() - debut < 40_000) {
      if (journal.some((l) => l.includes("reveil.detecte"))) {
        detecte = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    const ms = Date.now() - debut;

    // Le diagnostic sert AUSSI quand tout va bien : un réveil obtenu avec
    // 90 % de trames jetées est un réveil qu'on aura de la chance de revoir.
    const ligne = journal.filter((l) => /reveil\./.test(l)).slice(-6);

    if (attenduReveil) {
      controle(`[${nomFixture}] « Alexa » RÉVEILLE Jarvis`, detecte, detecte ? `en ${ms} ms` : `rien en ${ms} ms`);
    } else {
      controle(`[${nomFixture}] une phrase SANS le mot ne réveille pas`, !detecte, detecte ? `RÉVEIL À TORT en ${ms} ms` : `silence pendant ${ms} ms`);
    }
    for (const l of ligne) console.log(`       · ${l.slice(0, 150)}`);
  } catch (e) {
    controle(`[${nomFixture}] exécution`, false, String(e).slice(0, 160));
  } finally {
    await navigateur.close();
  }
}

console.log(`\n  Mot de réveil ALEXA — mesuré dans Chromium, sur de la parole réelle.\n`);
await passe("reveil-alexa", true);
console.log();
await passe("reveil-temoin", false);

console.log(`\nVERDICT : ${rouges === 0 ? "VERT" : "ROUGE"} — ${verts} vert(s), ${rouges} rouge(s).`);
process.exit(rouges === 0 ? 0 : 1);
