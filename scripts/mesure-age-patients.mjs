/**
 * `mesure-age-patients` — L'ÂGE ARRIVE-T-IL DE LA PORTE, ET EST-IL JUSTE ?
 *
 * La liste des patients n'affichait pas l'âge, et le composant n'y était pour
 * rien : `app.search_patients` ne renvoyait que `birth_date` (corrigé en 066).
 * Cette sonde vérifie les deux moitiés de la correction :
 *   · la colonne `age` existe bien dans la réponse de la porte ;
 *   · sa valeur correspond à la date de naissance, y compris autour de
 *     l'anniversaire — l'âge est recalculé ici À TITRE DE CONTRÔLE seulement,
 *     jamais pour être affiché (voir `PatientListItem.age`).
 *
 * ⚠️ AUCUNE DONNÉE PATIENT N'EST IMPRIMÉE — ni nom, ni date de naissance, ni
 * numéro de dossier. Seuls des COMPTES et des écarts sortent d'ici. La base
 * visée est synthétique (ADR-016), mais la sonde doit rester exécutable sans
 * risque le jour où elle ne le sera plus.
 *
 *     node scripts/mesure-age-patients.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMAIL = "praticien2.dev@invalid.local";

const env = {};
for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m && m[2].trim() !== "") env[m[1]] = m[2].trim();
}
const base = (env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").replace(/\/$/, "");
const anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
const pw = env["DOCTOR_ACCOUNT_PASSWORD"] ?? "";
if (base === "" || anon === "" || pw === "") {
  console.error("BLOQUÉ — URL / ANON_KEY / DOCTOR_ACCOUNT_PASSWORD requis dans .env.");
  process.exit(2);
}

const lignes = [];
let rouges = 0;
function controle(nom, ok, detail) {
  lignes.push(`${ok ? "vert " : "ROUGE"} | ${nom.padEnd(40)} | ${detail}`);
  if (!ok) rouges += 1;
}

const repLogin = await fetch(`${base}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: anon },
  body: JSON.stringify({ email: EMAIL, password: pw }),
  signal: AbortSignal.timeout(30_000),
});
const login = await repLogin.json().catch(() => null);
const jwt = typeof login?.access_token === "string" ? login.access_token : null;
controle("connexion GoTrue", jwt !== null, `status=${repLogin.status}`);
if (jwt === null) {
  console.log(lignes.join("\n"));
  process.exit(2);
}

const rep = await fetch(`${base}/rest/v1/rpc/search_patients`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: anon,
    Authorization: `Bearer ${jwt}`,
    "Accept-Profile": "app",
    "Content-Profile": "app",
  },
  body: JSON.stringify({ p_query: null, p_limit: 100, p_offset: 0 }),
  signal: AbortSignal.timeout(30_000),
});
const rows = await rep.json().catch(() => null);
if (!Array.isArray(rows)) {
  controle("appel search_patients", false, `status=${rep.status} ${String(rows?.message ?? "").slice(0, 60)}`);
  console.log(lignes.join("\n"));
  process.exit(1);
}
controle("appel search_patients", true, `${rows.length} ligne(s) visible(s)`);

// La colonne doit EXISTER, même à null : son absence signifierait que 066
// n'est pas appliquée, ou que le cache de schéma de PostgREST est périmé.
const sansColonne = rows.filter((r) => !("age" in r)).length;
controle("colonne `age` présente", rows.length === 0 || sansColonne === 0, `${sansColonne} ligne(s) sans la clé`);

/** Âge en années révolues — CONTRÔLE seulement ; l'écran, lui, lit la porte. */
function ageAttendu(iso) {
  const n = new Date(`${iso}T00:00:00Z`);
  const a = new Date();
  let ans = a.getUTCFullYear() - n.getUTCFullYear();
  const m = a.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && a.getUTCDate() < n.getUTCDate())) ans -= 1;
  return ans;
}

let compares = 0;
let ecarts = 0;
let nulsCoherents = 0;
for (const r of rows) {
  if (r.birth_date === null || r.birth_date === undefined) {
    if (r.age === null) nulsCoherents += 1;
    else ecarts += 1; // âge sans date de naissance : une valeur inventée
    continue;
  }
  compares += 1;
  if (r.age !== ageAttendu(r.birth_date)) ecarts += 1;
}
controle("âge cohérent avec la naissance", ecarts === 0, `${compares} comparé(s), ${ecarts} écart(s), ${nulsCoherents} sans date`);

console.log(lignes.join("\n"));
console.log(`\nVERDICT : ${rouges === 0 ? "VERT" : "ROUGE"} — ${rouges} rouge(s).`);
process.exit(rouges === 0 ? 0 : 1);
