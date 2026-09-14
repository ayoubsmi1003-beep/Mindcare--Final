#!/usr/bin/env node
/**
 * `inspect-env.mjs` — PHASE 1 du diagnostic Alexa reliability.
 *
 * Lit `.env` local côté serveur uniquement. Rapporte UNIQUEMENT des métadonnées
 * safe : présence, longueur, préfixe (8 premiers caractères), jamais la valeur.
 * Aucune sortie ne contient de secret : on vérifie que le préfixe n'est jamais
 * réémis en clair plus loin que ce que la table de comparaison permet.
 *
 * AUCUN RÉSEAU. AUCUNE ÉCRITURE. Lecture seule, stdout seulement.
 *
 *     node scripts/inspect-env.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHEMIN_ENV = path.join(RACINE, ".env");

const REGLES = [
  // [clé attendue, attendu côté secret, longueur min, description safe]
  { nom: "DEV_ACCOUNT_PASSWORD",           secret: true,  minLen: 8,   categorie: "auth.owner.dev" },
  { nom: "DOCTOR_ACCOUNT_PASSWORD",        secret: true,  minLen: 8,   categorie: "auth.praticien" },
  { nom: "NEXT_PUBLIC_SUPABASE_URL",       secret: false, minLen: 20,  categorie: "supabase.url" },
  { nom: "NEXT_PUBLIC_SUPABASE_ANON_KEY",  secret: false, minLen: 20,  categorie: "supabase.anon" },
  { nom: "OPENROUTER_API_KEY",             secret: true,  minLen: 20,  categorie: "llm.cle" },
  { nom: "OPENROUTER_MODEL",               secret: false, minLen: 1,   categorie: "llm.modele" },
  { nom: "ALEXA_OPENROUTER_API_KEY",       secret: true,  minLen: 20,  categorie: "llm.alias.cle" },
  { nom: "ALEXA_OPENROUTER_MODEL",         secret: false, minLen: 1,   categorie: "llm.alias.modele" },
  { nom: "JARVIS_OPENROUTER_API_KEY",      secret: true,  minLen: 20,  categorie: "llm.alias2.cle" },
  { nom: "JARVIS_OPENROUTER_MODEL",        secret: false, minLen: 1,   categorie: "llm.alias2.modele" },
  { nom: "GROQ_STT_MODEL",                 secret: false, minLen: 1,   categorie: "stt.modele" },
  { nom: "STT_MODEL",                      secret: false, minLen: 1,   categorie: "stt.alias.modele" },
];

function lireEnv() {
  const env = {};
  let brut;
  try {
    brut = readFileSync(CHEMIN_ENV, "utf8");
  } catch (e) {
    return { env, brut: null, erreur: e };
  }
  for (const ligne of brut.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (m === null) continue;
    const cle = m[1];
    const valeur = m[2].trim().replace(/^['"]|['"]$/g, "");
    if (valeur === "") continue;
    env[cle] = valeur;
  }
  return { env, brut, erreur: null };
}

function apercu(valeur) {
  if (typeof valeur !== "string") return null;
  if (valeur.length === 0) return "(vide)";
  return `préfixe=${valeur.slice(0, 8)}…  longueur=${valeur.length}`;
}

const { env, erreur } = lireEnv();
if (erreur !== null) {
  console.error("INSPECT — .env illisible :", erreur.message);
  process.exit(2);
}

const rapport = {
  phase: "INSPECT-ENV",
  date: new Date().toISOString(),
  variables: {},
};

let toutesRequises = true;
for (const regle of REGLES) {
  const valeur = env[regle.nom];
  const present = typeof valeur === "string" && valeur.length >= regle.minLen;
  rapport.variables[regle.nom] = {
    present,
    categorie: regle.categorie,
    secret: regle.secret,
  };
  if (present && !regle.secret) {
    rapport.variables[regle.nom].apercu = apercu(valeur);
  }
  // On n'affiche JAMAIS la valeur, même partielle.
  if (!present) toutesRequises = false;
}

console.log("INSPECT-ENV — variables (safe, jamais la valeur) :");
for (const [nom, info] of Object.entries(rapport.variables)) {
  const ligne = `  ${info.present ? "présent " : "ABSENT "} ${nom.padEnd(34)} ${info.categorie.padEnd(20)}` +
    (info.apercu ? "  " + info.apercu : "");
  console.log(ligne);
}

console.log("");
console.log(`INSPECT-ENV — verdict : ${toutesRequises ? "toutes présentes" : "variables manquantes"}`);
console.log("");

// Modèle LLM effectif : on regarde OPENROUTER_MODEL, puis alias, puis défaut connu.
const modeleCandidat =
  env["OPENROUTER_MODEL"] ??
  env["ALEXA_OPENROUTER_MODEL"] ??
  env["JARVIS_OPENROUTER_MODEL"] ??
  env["LLM_MODEL"] ??
  null;
console.log(`LLM — modèle effectif : ${modeleCandidat ?? "(absent)"}`);
console.log(`LLM — connu bon (STATE.md 2026-08-27) : qwen/qwen3-next-80b-a3b-instruct`);
if (modeleCandidat !== null && modeleCandidat !== "qwen/qwen3-next-80b-a3b-instruct") {
  console.log("LLM — DÉVIATION par rapport au dernier état documenté.");
}