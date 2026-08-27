/**
 * `fixtures-voix` — LES ÉCHANTILLONS DE PAROLE DES MESURES, FABRIQUÉS À LA DEMANDE.
 *
 * ═══ POURQUOI RIEN N'EST COMMITÉ ═══
 *
 * Le contrôle 3 de `scripts/preflight.sh` refuse TOUT `.wav`, `.webm` ou `.ogg`
 * dans le dépôt, et il a raison : le jour où quelqu'un dépose « juste un petit
 * enregistrement pour tester », c'est une voix de patiente qui part dans git,
 * de façon irréversible et pour toujours. La règle 1 de `CLAUDE.md` ne fait pas
 * d'exception pour les fixtures.
 *
 * Une première version de ces mesures avait committé deux `.wav` sous
 * `scripts/fixtures/`. Le préflight les a refusés — la garde a fonctionné, et
 * la bonne réponse était de fabriquer les échantillons, pas d'exempter le
 * dossier.
 *
 * Les fichiers sont donc SYNTHÉTISÉS par ElevenLabs, écrits dans le dossier
 * temporaire du système, et mis en cache d'une exécution à l'autre. Rien ne
 * touche le dépôt, et une installation propre les reproduit à l'identique.
 *
 * ⚠️ AUCUNE VOIX HUMAINE, JAMAIS. Ce qui est prononcé ici — le mot de réveil et
 * une phrase anodine — ne contient AUCUNE donnée patient. C'est la condition
 * pour que ces fichiers puissent seulement exister.
 *
 * ⚠️ CE QUE LA SYNTHÈSE NE REMPLACE PAS. Une voix de synthèse dans un fichier
 * n'est pas une voix humaine dans une pièce : pas de réverbération, pas de
 * bruit de fond, pas d'accent, pas de distance au micro. Ces échantillons
 * prouvent que la CHAÎNE fonctionne, jamais le taux de réussite au cabinet.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DOSSIER = join(tmpdir(), "mindcare-fixtures-voix");

/**
 * Les deux échantillons, et pourquoi chacun existe.
 *
 * Le témoin n'est pas un ornement : sans une phrase SANS le mot de réveil, une
 * mesure ne distingue pas un détecteur juste d'un détecteur qui dit oui à tout.
 */
export const FIXTURES = {
  "reveil-alexa": "Alexa",
  "reveil-temoin": "Bonjour docteur, comment allez-vous aujourd'hui ?",
};

function lireEnv() {
  const env = {};
  for (const l of readFileSync(`${process.cwd()}/.env`, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

/**
 * Appelle ElevenLabs et écrit le MP3.
 *
 * ⚠️ REPLI SUR `curl`, ET CE N'EST PAS DE LA SUPERSTITION. Depuis ce poste, le
 * `fetch` de Node atteint Supabase, OpenRouter et Groq sans broncher mais
 * échoue une fois sur deux sur `api.elevenlabs.io` :
 *
 *     ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT), 10 000 ms
 *
 * pendant que `curl` sur la MÊME machine et la MÊME URL répond en 0,5 s. C'est
 * la sélection d'adresse d'undici — pas le réseau, pas la clé, pas l'API. Sans
 * ce repli, une mesure verte deviendrait rouge au hasard, et on chercherait le
 * défaut dans la voix. `curl` est livré avec Windows 10+ comme avec macOS et
 * Linux ; ce script exige déjà `ffmpeg`, la dépendance ajoutée est mince.
 */
async function synthetiser(env, texte, mp3) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${env["ELEVENLABS_VOICE_ID"]}`;
  const corps = JSON.stringify({ text: texte, model_id: env["ELEVENLABS_TTS_MODEL"] });

  try {
    const reponse = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": env["ELEVENLABS_API_KEY"], "Content-Type": "application/json" },
      body: corps,
    });
    if (!reponse.ok) {
      // Un refus HTTP est une VRAIE réponse : clé invalide, voix payante (402),
      // quota épuisé. Le repli ne le corrigerait pas et le masquerait.
      throw new Error(`ElevenLabs a refusé la synthèse : HTTP ${reponse.status}`);
    }
    writeFileSync(mp3, Buffer.from(await reponse.arrayBuffer()));
    return;
  } catch (cause) {
    if (!String(cause?.message ?? cause).includes("fetch failed")) throw cause;
  }

  const code = execFileSync("curl", [
    "-s", "-o", mp3, "-w", "%{http_code}", "--max-time", "60",
    "-X", "POST", url,
    "-H", `xi-api-key: ${env["ELEVENLABS_API_KEY"]}`,
    "-H", "Content-Type: application/json",
    "-d", corps,
  ]).toString().trim();
  if (code !== "200") {
    throw new Error(`ElevenLabs a refusé la synthèse (repli curl) : HTTP ${code}`);
  }
}

/**
 * Rend le chemin d'un WAV 16 kHz mono contenant la phrase demandée, en le
 * fabriquant si nécessaire.
 *
 * ⚠️ LE SILENCE DE TÊTE N'EST PAS DU REMPLISSAGE. Il faut 76 trames mel pour le
 * premier embedding, puis 8 par embedding suivant : 76 + 15×8 = 196 trames
 * avant le tout premier score, soit ~2 s d'audio. Un échantillon qui commence
 * par le mot ne produirait AUCUN score au moment où le mot est prononcé, et la
 * mesure conclurait « non reconnu » sur une chaîne parfaitement saine.
 */
export async function fixtureWav(nom) {
  mkdirSync(DOSSIER, { recursive: true });
  const wav = join(DOSSIER, `${nom}.wav`);
  if (existsSync(wav)) return wav;

  const texte = FIXTURES[nom];
  if (texte === undefined) throw new Error(`fixture inconnue : ${nom}`);

  const env = lireEnv();
  const mp3 = join(DOSSIER, `${nom}.mp3`);
  await synthetiser(env, texte, mp3);

  // 2 s de bruit rose très faible en tête (voir ci-dessus), 1 s en queue, puis
  // 16 kHz mono PCM — le format que Chromium sait rejouer comme micro factice.
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-t", "2", "-i", "anoisesrc=r=16000:c=pink:a=0.002",
    "-i", mp3,
    "-f", "lavfi", "-t", "1", "-i", "anoisesrc=r=16000:c=pink:a=0.002",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[o]",
    "-map", "[o]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    wav,
  ]);
  return wav;
}
