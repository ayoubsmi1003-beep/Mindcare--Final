/**
 * mesure-voix-navigateur — LA CHAÎNE VOCALE DU NAVIGATEUR, EXÉCUTÉE POUR DE VRAI.
 *
 *   pnpm dev                                  (mode DEV obligatoire, voir plus bas)
 *   node scripts/mesure-voix-navigateur.mjs
 *
 * Éprouve, dans un vrai Chromium : getUserMedia → runtime ONNX du mot de réveil
 * → MediaRecorder → finalisation `onstop` → base64 → Edge `jarvis-voice-in`
 * → Groq → transcription, puis le retour de la machine à l'état de veille.
 *
 * ═══ POURQUOI CE SCRIPT EXISTE ═══
 *
 * Le 2026-08-27, DEUX défauts rendaient la voix totalement inopérante, et les
 * deux ont survécu à une suite d'évaluations hors ligne intégralement VERTE :
 *
 *   1. le multipart envoyé à Groq n'avait pas d'extension de fichier → HTTP 400
 *      systématique, donc AUCUNE transcription n'a jamais abouti ;
 *   2. `public/wakeword/ort/` ne contenait pas le chargeur **jsep** du runtime
 *      ONNX → 404 à l'armement, donc le mot de réveil n'a JAMAIS pu s'armer —
 *      pendant que `eval-reveil-pipeline` passait au vert, parce qu'il exécute
 *      l'ONNX sous Node, où le chemin de chargement est tout autre.
 *
 * Aucune de ces deux pannes n'est visible sans navigateur. C'est la raison
 * d'être de ce fichier : il n'ajoute pas un contrôle de plus, il couvre la
 * seule zone que les autres ne peuvent pas atteindre.
 *
 * ⚠️ CE QU'IL NE PROUVE PAS, ET IL FAUT LE DIRE. Le micro factice de Chromium
 * (`--use-fake-device-for-media-stream`) émet un bip, pas de la parole. Ce
 * script ne prouve donc NI que « Alexa » est reconnu dans une voix humaine, NI
 * qu'un son sort réellement du haut-parleur. Ces deux-là exigent la praticienne
 * devant le poste — aucun automate ne les remplace.
 *
 * ⚠️ SERVEUR EN MODE DEV. `log.ts` se tait en production (délibérément : la
 * console d'un poste de cabinet est lisible par quiconque l'ouvre), et ce sont
 * précisément ses lignes que ce script lit pour compter les octets capturés.
 *
 * Aucun secret imprimé. Compte praticienne du jeu de développement.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.MESURE_URL ?? "http://localhost:3000";
const RACINE = process.cwd();

const env = {};
for (const l of readFileSync(`${RACINE}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}

let verts = 0, rouges = 0;
const controle = (label, ok, detail = "") => {
  ok ? verts++ : rouges++;
  console.log(`${ok ? "vert  " : "ROUGE "} | ${label}${detail ? "  | " + detail : ""}`);
};

const navigateur = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const contexte = await navigateur.newContext({ permissions: ["microphone"] });
// ⚠️ LA PERMISSION SE DONNE AUSSI PAR ORIGINE. `newContext({permissions})` ne
// suffit pas ici : le premier `getUserMedia` revenait « accès refusé », et la
// machine à états le rapportait fidèlement. Un test qui échoue sur sa propre
// configuration ferait accuser le code.
await contexte.grantPermissions(["microphone"], { origin: "http://localhost:3000" });
const page = await contexte.newPage();

// Le journal du navigateur — c'est là que vivent les diagnostics ajoutés.
const journal = [];
page.on("console", (m) => journal.push(m.text()));
page.on("pageerror", (e) => journal.push(`PAGEERROR ${e.message}`));

try {
  // ── connexion, en PRATICIENNE ──
  await page.goto(`${BASE}/connexion`, { waitUntil: "domcontentloaded" });
  // ⚠️ ATTENDRE L'HYDRATATION, PAS LA VISIBILITÉ. Un champ visible mais non
  // hydraté accepte la frappe et la perd : React remonte son état au montage,
  // le formulaire se soumet vide, et rien ne part sur le réseau — aucun
  // message d'erreur, aucune requête. Constaté ici même. Même parade que
  // `attendreHydratation` dans mesure-jarvis-navigateur.mjs.
  await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('input[type="email"]');
      return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.locator('input[type="email"]').pressSequentially("praticien2.dev@invalid.local");
  await page.locator('input[type="password"]').pressSequentially(env.DOCTOR_ACCOUNT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(patients|tableauDeBord)/, { timeout: 60_000 });
  controle("connexion praticienne", true, page.url().replace(BASE, ""));

  await page.goto(`${BASE}/jarvis`, { waitUntil: "domcontentloaded" });
  const orbe = page.locator('button[aria-label*="—"]').first();
  await orbe.waitFor({ state: "visible", timeout: 30_000 });

  const etat = async () => (await orbe.getAttribute("aria-label")) ?? "";
  console.log(`\n  état initial : ${await etat()}\n`);

  // ── PATH B : le clic. Le premier clic ARME la voix (charge l'ONNX). ──
  await orbe.click();
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "").includes("—"));
      const l = b?.getAttribute("aria-label") ?? "";
      return l.includes("Dites") || l.includes("écoute") || l.includes("Erreur") || l.includes("moteur");
    },
    undefined,
    { timeout: 120_000 },
  ).catch(() => {});
  const apresArmement = await etat();
  console.log(`  après 1er clic : ${apresArmement}\n`);
  controle("mot de réveil armé (moteur ONNX chargé)", apresArmement.includes("Dites"), apresArmement.slice(0, 110));

  // ── second clic : déclenche l'écoute (chemin manuel, PATH B) ──
  const etats = [apresArmement];
  const noter = async () => {
    const e = await etat();
    if (e !== etats[etats.length - 1]) {
      etats.push(e);
      console.log(`  [${String(Date.now() - debut).padStart(6)} ms] ${e.slice(0, 120)}`);
    }
    return e;
  };
  const debut = Date.now();
  await orbe.click();

  let vuEcoute = false;
  while (Date.now() - debut < 45_000) {
    const e = await noter();
    if (/écoute/i.test(e)) vuEcoute = true;
    // On ne sort qu'APRÈS avoir vu l'écoute puis l'avoir vue se refermer :
    // sortir dès « Dites… » attraperait l'état d'AVANT le clic.
    if (vuEcoute && !/écoute/i.test(e)) break;
    await page.waitForTimeout(200);
  }

  const traversés = etats.join(" || ");
  controle("l'écoute a démarré (chemin clic manuel)", vuEcoute, etats.slice(0, 3).join(" → ").slice(0, 120));
  controle("la capture s'est CLOSE", vuEcoute && !/écoute/i.test(etats[etats.length - 1]), etats[etats.length - 1].slice(0, 90));
  controle("aucun état bloqué en fin de course", !/écoute/i.test(etats[etats.length - 1]), etats[etats.length - 1].slice(0, 90));

  // ── les diagnostics : des octets ont-ils réellement été capturés ? ──
  console.log("\n  ── journal navigateur (diagnostics voix) ──");
  const voix = journal.filter((l) => /jarvis\.voix|jarvis\.reveil|enregistrement/.test(l));
  for (const l of voix) console.log("   ", l.slice(0, 200));
  if (voix.length === 0) console.log("    (aucune ligne — serveur en production ? log.ts se tait alors)");

  const clos = voix.find((l) => l.includes("enregistrementClos"));
  if (clos) {
    const m = /"count":(\d+)/.exec(clos);
    const octets = m ? Number(m[1]) : 0;
    controle("blob audio NON VIDE (le défaut d'origine)", octets > 0, `${octets} octets`);
  } else {
    controle("blob audio NON VIDE (le défaut d'origine)", false, "aucun 'enregistrementClos' journalisé");
  }
} catch (e) {
  controle("exécution du test", false, String(e).slice(0, 200));
} finally {
  await navigateur.close();
}

console.log(`\nVERDICT : ${rouges === 0 ? "VERT" : "ROUGE"} — ${verts} vert(s), ${rouges} rouge(s).`);
process.exit(rouges === 0 ? 0 : 1);
