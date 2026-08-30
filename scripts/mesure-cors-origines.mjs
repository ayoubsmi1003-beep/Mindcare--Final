/**
 * `mesure-cors-origines` — QUELLES ORIGINES LES FONCTIONS EN LIGNE ACCEPTENT-ELLES ?
 *
 * ═══ POURQUOI CETTE SONDE EXISTE ═══
 *
 * La cause la plus coûteuse de ce dépôt est structurellement invisible depuis
 * le code applicatif : quand une origine n'est pas dans l'allowlist, le
 * navigateur bloque la requête AVANT toute exécution, et refuse par conception
 * de dire à JavaScript pourquoi. L'écran affiche « indisponible », ce qui est
 * vrai et n'apprend rien. Aucun `catch` ne peut nommer cette cause.
 *
 * Une requête préalable `OPTIONS` envoyée hors navigateur, elle, N'EST PAS
 * SOUMISE À CETTE RÈGLE : on lit la réponse telle qu'elle est. C'est le seul
 * moyen de transformer « ça ne marche pas » en un fait daté.
 *
 * ⚠️ CE QUE CETTE SONDE NE PROUVE PAS. Elle prouve qu'une origine est acceptée
 * ou refusée. Elle ne prouve NI que la transcription fonctionne, NI que le son
 * sort du haut-parleur — ce sont trois questions distinctes, et les confondre
 * est exactement ce qui a fait chercher la panne du mauvais côté.
 *
 * Aucun secret n'est imprimé. Aucun corps n'est envoyé, aucun JWT : une requête
 * préalable ne porte ni l'un ni l'autre.
 *
 *     node scripts/mesure-cors-origines.mjs
 *     node scripts/mesure-cors-origines.mjs http://localhost:3005
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FONCTIONS = [
  "jarvis-chat",
  "jarvis-analyze-session",
  "jarvis-resume-cas",
  "jarvis-voice-in",
  "jarvis-voice-out",
];

function lireEnv() {
  const brut = readFileSync(path.join(RACINE, ".env"), "utf8");
  const env = {};
  for (const ligne of brut.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ligne);
    if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

const env = lireEnv();
const base = env["NEXT_PUBLIC_SUPABASE_URL"];
if (base === undefined) {
  console.error("BLOQUÉ — NEXT_PUBLIC_SUPABASE_URL absente de .env. Rien n'a été mesuré.");
  process.exit(2);
}

// Les origines candidates : celle du poste, celles vers lesquelles Next.js
// glisse quand le port est pris, et toute origine passée en argument.
const origines = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  ...process.argv.slice(2),
];

console.log(`PROJET   ${new URL(base).host}`);
console.log(`ATTENDU  204 + Access-Control-Allow-Origin pour une origine autorisée,`);
console.log(`         403 sans en-tête pour une origine qui ne l'est pas.\n`);

let autorisees = 0;
for (const origine of origines) {
  const lignes = [];
  for (const f of FONCTIONS) {
    let verdict;
    try {
      const r = await fetch(`${base}/functions/v1/${f}`, {
        method: "OPTIONS",
        headers: {
          Origin: origine,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      });
      const permis = r.headers.get("access-control-allow-origin");
      verdict = permis === origine ? `${r.status} autorisée` : `${r.status} REFUSÉE`;
      if (permis === origine) autorisees += 1;
    } catch (cause) {
      // Injoignable ≠ refusée : ne pas confondre une panne de réseau avec un
      // verdict d'allowlist, sous peine de rediagnostiquer à faux.
      verdict = `INJOIGNABLE (${cause.name})`;
    }
    lignes.push(`    ${f.padEnd(24)} ${verdict}`);
  }
  console.log(`  ${origine}`);
  console.log(lignes.join("\n"));
  console.log("");
}

if (autorisees === 0) {
  console.log("VERDICT : ROUGE — aucune origine testée n'est acceptée.");
  console.log("  CORS_ORIGINS n'est probablement pas posée sur le projet. Poser");
  console.log("  l'origine réellement servie, puis relancer cette sonde :");
  console.log("      bash scripts/deploy-edge.sh --secrets");
  process.exit(1);
}
console.log(`VERDICT : VERT — ${autorisees} couple(s) origine×fonction acceptés.`);
