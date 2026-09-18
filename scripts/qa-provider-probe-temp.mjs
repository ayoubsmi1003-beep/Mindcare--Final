#!/usr/bin/env node
/**
 * qa-provider-probe-temp — classe la panne du fournisseur LLM. TEMPORAIRE.
 *
 * ⚠️ AUCUNE DONNÉE PATIENT. Envoie une seule chaîne de test (« ping ») au
 * fournisseur configuré, avec le modèle exact que l'application résout, et
 * rapporte : statut HTTP, corps d'erreur du FOURNISSEUR (qui ne contient aucune
 * donnée du cabinet), latence. La clé n'est jamais imprimée.
 *
 * Distingue : modèle inexistant (404) · crédits (402) · clé (401) ·
 * transitoire (429/5xx) · succès.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}
const modele = env["OPENROUTER_MODEL"] ?? env["LLM_MODEL"] ?? "(aucun)";
const cle = env["OPENROUTER_API_KEY"] ?? "";
console.log(`PROBE — modèle résolu : ${modele}`);
console.log(`PROBE — clé ${cle === "" ? "ABSENTE" : `présente (${cle.length} car.)`}`);
if (cle === "") process.exit(2);

const t = Date.now();
const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
  body: JSON.stringify({
    model: modele,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 4,
  }),
  signal: AbortSignal.timeout(60_000),
});
const texte = await r.text();
console.log(`PROBE — HTTP ${r.status} en ${Date.now() - t} ms`);
console.log(`PROBE — corps (fournisseur, aucune donnée patient) : ${texte.slice(0, 600)}`);
