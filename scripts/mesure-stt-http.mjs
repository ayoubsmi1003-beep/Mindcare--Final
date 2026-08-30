/**
 * `mesure-stt-http` — LA TRANSCRIPTION, PROUVÉE AVEC DU VRAI AUDIO.
 *
 * ═══ POURQUOI CETTE SONDE, ALORS QUE `mesure-voix-navigateur` EXISTE ═══
 *
 * `mesure-voix-navigateur` conduit un vrai Chromium, et c'est sa force. Mais
 * son micro est factice : il émet un bip, pas de la parole. L'endpointeur
 * classe donc la capture en `faux-reveil` — À RAISON — et JETTE l'audio avant
 * d'appeler la transcription. Ce chemin ne peut structurellement pas prouver
 * que la transcription fonctionne : il s'arrête une étape trop tôt.
 *
 * Ici on prend le problème par l'autre bout : un échantillon de PAROLE réelle
 * (synthétisé, jamais humain — voir `fixtures-voix.mjs`), envoyé à
 * `jarvis-voice-in` exactement comme le navigateur l'envoie (JSON base64), avec
 * un vrai JWT. Ce qui revient est une transcription ou une erreur nommée.
 *
 * ⚠️ CE QU'ELLE NE PROUVE PAS. Ni que le micro du poste capte, ni que « Alexa »
 * est reconnu dans une voix humaine, ni qu'un son sort du haut-parleur. Trois
 * questions distinctes ; les confondre est ce qui a fait chercher la panne du
 * mauvais côté pendant des heures. Elle prouve UNE chose : de l'audio valide
 * entre, du texte sort.
 *
 * Aucun secret imprimé. Compte praticienne du jeu de développement.
 *
 *     node scripts/mesure-stt-http.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureWav } from "./fixtures-voix.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMAIL = "praticien2.dev@invalid.local";
const ORIGINE = process.env.MESURE_ORIGINE ?? "http://localhost:3000";

function lireEnv() {
  const env = {};
  for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

const lignes = [];
let verts = 0;
let rouges = 0;
function controle(nom, ok, detail) {
  lignes.push(`${ok ? "vert " : "ROUGE"} | ${nom.padEnd(38)} | ${detail}`);
  if (ok) verts += 1;
  else rouges += 1;
}

const env = lireEnv();
const base = (env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").replace(/\/$/, "");
const anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
const pw = env["DOCTOR_ACCOUNT_PASSWORD"] ?? "";
if (base === "" || anon === "" || pw === "") {
  console.error("BLOQUÉ — NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / DOCTOR_ACCOUNT_PASSWORD requis dans .env.");
  process.exit(2);
}
const url = `${base}/functions/v1/jarvis-voice-in`;

// ── A · l'échantillon de parole ────────────────────────────────────────────
// Synthétisé et mis en cache hors du dépôt. Le préflight refuse tout audio
// commité, et il a raison : la règle 1 ne fait pas d'exception pour une fixture.
let wav;
try {
  wav = await fixtureWav("reveil-temoin");
  controle("A · échantillon de parole", true, path.basename(wav));
} catch (cause) {
  controle("A · échantillon de parole", false, `${cause.message.slice(0, 80)}`);
  console.log(lignes.join("\n"));
  console.log("\nVERDICT : BLOQUÉ — sans échantillon, rien n'est mesuré.");
  process.exit(2);
}
const audio = readFileSync(wav);

// ── B · connexion ──────────────────────────────────────────────────────────
const repLogin = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: anon },
  body: JSON.stringify({ email: EMAIL, password: pw }),
  signal: AbortSignal.timeout(30_000),
});
let login = null;
try { login = await repLogin.json(); } catch { /* non JSON */ }
const jwt = typeof login?.access_token === "string" ? login.access_token : null;
controle("B · connexion GoTrue", jwt !== null, `status=${repLogin.status}`);
if (jwt === null) {
  console.log(lignes.join("\n"));
  console.log("\nVERDICT : BLOQUÉ — sans jeton, la transcription n'est pas atteignable.");
  process.exit(2);
}

// ── C · sans jeton, la porte refuse ────────────────────────────────────────
const repC = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: anon, Origin: ORIGINE },
  body: JSON.stringify({ audioBase64: "", mimeType: "audio/wav" }),
  signal: AbortSignal.timeout(30_000),
});
let corpsC = null;
try { corpsC = await repC.json(); } catch { /* non JSON */ }
controle(
  "C · sans jeton → refus nommé",
  corpsC?.ok === false,
  `code=${corpsC?.error?.code ?? "?"}`,
);

// ── D · la transcription, pour de vrai ─────────────────────────────────────
const t0 = Date.now();
const repD = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: anon,
    Authorization: `Bearer ${jwt}`,
    Origin: ORIGINE,
  },
  body: JSON.stringify({ audioBase64: audio.toString("base64"), mimeType: "audio/wav" }),
  signal: AbortSignal.timeout(60_000),
});
const ms = Date.now() - t0;
let corpsD = null;
try { corpsD = await repD.json(); } catch { /* non JSON */ }

const texte = typeof corpsD?.data?.texte === "string" ? corpsD.data.texte : null;
if (texte === null) {
  controle(
    "D · transcription",
    false,
    `status=${repD.status} code=${corpsD?.error?.code ?? "?"} — ${String(corpsD?.error?.message ?? "").slice(0, 70)}`,
  );
} else {
  // Le texte prononcé est une phrase anodine SANS donnée patient : l'imprimer
  // est sans risque, et c'est la seule preuve lisible que la chaîne a abouti.
  controle("D · transcription", texte.trim() !== "", `${ms} ms — « ${texte.trim().slice(0, 60)} »`);
}

console.log(lignes.join("\n"));
console.log(`\nVERDICT : ${rouges === 0 ? "VERT" : "ROUGE"} — ${verts} vert(s), ${rouges} rouge(s).`);
process.exit(rouges === 0 ? 0 : 1);
