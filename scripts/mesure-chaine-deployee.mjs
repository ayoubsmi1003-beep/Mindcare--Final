/**
 * mesure-chaine-deployee — LES FONCTIONS EDGE RÉELLEMENT EN LIGNE, ÉPROUVÉES.
 *
 *   node scripts/mesure-chaine-deployee.mjs
 *
 * Éprouve, contre le projet DÉPLOYÉ et avec un jeton de praticienne réel :
 * `jarvis-voice-in` (Groq Whisper), `jarvis-voice-out` (ElevenLabs) et
 * `jarvis-chat` (OpenRouter/Qwen).
 *
 * ═══ CE QUE CE SCRIPT COUVRE, ET QUE LE NAVIGATEUR NE COUVRE PAS ═══
 *
 * Le micro factice de Chromium émet un BIP. `mesure-voix-navigateur` prouve
 * donc que des octets partent et que la machine à états revient au repos — mais
 * il ne peut PAS prouver qu'une transcription revient, parce qu'un bip ne se
 * transcrit pas. Ici, l'audio envoyé est de la PAROLE : la transcription
 * revient, ou le contrôle est rouge.
 *
 * ⚠️ ON VISE LE PROJET DÉPLOYÉ, PAS UN ÉMULATEUR. C'est tout l'intérêt : le
 * 2026-08-27, le dépôt contenait les correctifs et la production servait encore
 * une version antérieure. Un test qui exécuterait le code local passerait au
 * vert pendant que la praticienne, elle, appelle l'ancienne fonction.
 *
 * Aucun secret imprimé — ni jeton, ni clé, ni transcription intégrale.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureWav } from "./fixtures-voix.mjs";

const RACINE = process.cwd();
const env = {};
for (const l of readFileSync(`${RACINE}/.env`, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}
const URL_SUPABASE = env["NEXT_PUBLIC_SUPABASE_URL"];
const CLE = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

/**
 * L'origine déclarée. ⚠️ ELLE DOIT ÊTRE DANS L'ALLOWLIST DE `_shared/cors.ts`,
 * sinon la requête préalable repart en 403 et le navigateur — pas ce script —
 * bloquerait l'appel. On l'envoie pour que ce test échoue AUSSI quand
 * l'allowlist est mal posée, au lieu de réussir là où le produit échoue.
 */
const ORIGINE = process.env["MESURE_URL"] ?? "http://localhost:3000";

let verts = 0;
let rouges = 0;
const controle = (label, ok, detail = "") => {
  ok ? (verts += 1) : (rouges += 1);
  console.log(`${ok ? "vert  " : "ROUGE "} | ${label.padEnd(46)}${detail ? " | " + detail : ""}`);
};

// ── le jeton ───────────────────────────────────────────────────────────────
const auth = await fetch(`${URL_SUPABASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: CLE, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "praticien2.dev@invalid.local",
    password: env["DOCTOR_ACCOUNT_PASSWORD"],
  }),
});
const session = await auth.json();
controle("connexion praticienne (jeton obtenu)", typeof session.access_token === "string", `HTTP ${auth.status}`);
if (typeof session.access_token !== "string") {
  console.log(`\nVERDICT : ROUGE — sans jeton, rien d'autre n'est mesurable.`);
  process.exit(1);
}
const JETON = session.access_token;

const appeler = async (nom, corps) => {
  const r = await fetch(`${URL_SUPABASE}/functions/v1/${nom}`, {
    method: "POST",
    headers: {
      apikey: CLE,
      Authorization: `Bearer ${JETON}`,
      "Content-Type": "application/json",
      Origin: ORIGINE,
    },
    body: JSON.stringify(corps),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* corps non JSON : le statut reste la seule preuve */
  }
  return { statut: r.status, cors: r.headers.get("access-control-allow-origin"), json };
};

// ── 1 · l'allowlist CORS, sur l'origine que servira le produit ─────────────
{
  const r = await fetch(`${URL_SUPABASE}/functions/v1/jarvis-voice-in`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGINE,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,apikey",
    },
  });
  controle(
    `l'origine ${ORIGINE} est autorisée`,
    r.status === 204 && r.headers.get("access-control-allow-origin") === ORIGINE,
    `préflight HTTP ${r.status}`,
  );
}

// ── 2 · STT : de la PAROLE, pas un bip ─────────────────────────────────────
// La fixture est en WAV 16 kHz ; le navigateur, lui, produit du WebM/Opus. On
// éprouve donc le format que le navigateur ENVOIE RÉELLEMENT, converti ici par
// ffmpeg — sinon ce test validerait un chemin que le produit n'emprunte pas.
const wav = await fixtureWav("reveil-temoin");
// Le transcodage vit HORS du dépôt : un artefact de mesure n'a rien à faire
// dans `scripts/fixtures/`, que git suit.
const webm = join(tmpdir(), "mindcare-mesure-temoin.webm");
let audioBase64 = null;
try {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-f", "webm", webm]);
  audioBase64 = readFileSync(webm).toString("base64");
} catch (e) {
  controle("conversion WebM/Opus (ffmpeg)", false, String(e.message ?? e).slice(0, 80));
}

if (audioBase64 !== null) {
  const r = await appeler("jarvis-voice-in", { audioBase64, mimeType: "audio/webm;codecs=opus" });
  const texte = r.json?.data?.texte ?? r.json?.data?.transcription ?? r.json?.data?.text ?? "";
  controle("jarvis-voice-in répond", r.statut === 200 && r.json?.ok === true, `HTTP ${r.statut}${r.json?.error?.code ? " · " + r.json.error.code : ""}`);
  // ⚠️ ON EXIGE DU TEXTE, PAS UN 200. Groq rendait 200 avec une transcription
  // vide quand le multipart n'avait pas d'extension : un contrôle sur le seul
  // statut aurait certifié la panne.
  controle("une TRANSCRIPTION revient (non vide)", typeof texte === "string" && texte.trim().length > 0, `${texte.trim().length} caractère(s)`);
}

// ── 3 · TTS : un MP3 réellement audible ────────────────────────────────────
{
  // ⚠️ CETTE FONCTION NE REND PAS D'ENVELOPPE JSON EN CAS DE SUCCÈS : elle rend
  // l'audio BRUT, avec son `Content-Type` (voir la fin de son `index.ts`). Une
  // sonde qui ferait `await r.json()` lirait 0 octet et accuserait à tort la
  // synthèse — c'est arrivé en écrivant ce fichier. L'échec, LUI, est du JSON.
  const rep = await fetch(`${URL_SUPABASE}/functions/v1/jarvis-voice-out`, {
    method: "POST",
    headers: {
      apikey: CLE,
      Authorization: `Bearer ${JETON}`,
      "Content-Type": "application/json",
      Origin: ORIGINE,
    },
    body: JSON.stringify({ texte: "Bonjour, ceci est un contrôle de synthèse vocale." }),
  });
  const typeMime = rep.headers.get("content-type") ?? "";
  const octets = Buffer.from(await rep.arrayBuffer());
  controle(
    "jarvis-voice-out répond en audio",
    rep.status === 200 && typeMime.startsWith("audio/"),
    `HTTP ${rep.status} · ${typeMime.slice(0, 40)}`,
  );
  // ⚠️ ON VÉRIFIE LES OCTETS DE TÊTE. ElevenLabs rendait 402 « library voice »
  // avec un corps JSON : un contrôle sur la taille seule aurait vu « des
  // octets » et conclu au succès. `ID3` ou `0xFF 0xFB` = vraie trame MPEG.
  const estMp3 =
    octets.length > 1000 &&
    (octets.subarray(0, 3).toString("latin1") === "ID3" || (octets[0] === 0xff && (octets[1] & 0xe0) === 0xe0));
  controle("l'audio rendu est un MP3 valide", estMp3, `${octets.length} octet(s)`);
}

// ── 4 · Qwen, par la passerelle gouvernée ──────────────────────────────────
{
  const r = await appeler("jarvis-chat", {
    conversationId: crypto.randomUUID(),
    message: "Bonjour Jarvis",
  });
  controle(
    "jarvis-chat répond (OpenRouter/Qwen)",
    r.statut === 200,
    `HTTP ${r.statut}${r.json?.error?.code ? " · " + r.json.error.code : ""}`,
  );
}

console.log(`\nVERDICT : ${rouges === 0 ? "VERT" : "ROUGE"} — ${verts} vert(s), ${rouges} rouge(s).`);
process.exit(rouges === 0 ? 0 : 1);
