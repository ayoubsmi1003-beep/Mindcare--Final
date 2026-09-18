#!/usr/bin/env node
/**
 * qa-autz-probe-temp — AUTORISATION LUE EN LECTURE SEULE. TEMPORAIRE.
 *
 * ⚠️ ZÉRO écriture, ZÉRO modèle. Deux sessions réelles (praticienne `owner` et
 * assistante `assistant`) interrogent les MÊMES portes de lecture ; on compare
 * ce que chacune obtient. La RLS décide — ce script ne fait que constater.
 *
 * Aucun identifiant patient n'est imprimé : uniquement des NOMBRES et des codes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.MC_BASE ?? "http://127.0.0.1:3000";
const H = { "Content-Type": "application/json" };

const env = {};
for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
}

async function session(email, mdp) {
  const r = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: mdp }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => null);
  return { ok: r.status === 200 && j?.ok === true, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "" };
}

async function rpc(cookie, name, args) {
  const r = await fetch(`${BASE}/api/db/rpc`, {
    method: "POST",
    headers: { ...H, Cookie: cookie },
    body: JSON.stringify({ name, args }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => null);
  const lignes = Array.isArray(j?.data) ? j.data.length : null;
  return { http: r.status, ok: j?.ok === true, lignes, code: j?.error?.code ?? null };
}

const medecin = await session("owner.dev@invalid.local", env["DEV_ACCOUNT_PASSWORD"] ?? "");
const assistante = await session("assistante.dev@invalid.local", env["ASSISTANT_ACCOUNT_PASSWORD"] ?? "");
console.log(`SESSIONS — praticienne(owner)=${medecin.ok} · assistante=${assistante.ok}\n`);

const SONDES = [
  ["search_patients (annuaire)", "search_patients", { p_query: null, p_limit: 100, p_offset: 0 }],
  ["list_agenda (agenda 16-18/09)", "list_agenda", { p_from: "2026-09-16T00:00:00+01:00", p_to: "2026-09-18T00:00:00+01:00" }],
  ["day_revenue (recette du jour)", "day_revenue", { p_day: "2026-09-16" }],
  ["dashboard_today (jour)", "dashboard_today", { p_day: "2026-09-16" }],
  ["list_day_payments (paiements)", "list_day_payments", { p_day: "2026-09-16" }],
  // Lecture d'un DOSSIER précis — la question d'autorisation la plus tranchante.
  ["get_patient (dossier PATIENT_A)", "get_patient", { p_id: "a1000000-0000-4000-8000-000000001001" }],
  ["get_patient_treatments (traitements)", "get_patient_treatments", { p_patient_id: "a1000000-0000-4000-8000-000000001001" }],
];

console.log("porte                       | praticienne            | assistante             | note");
for (const [libelle, nom, args] of SONDES) {
  const a = await rpc(medecin.cookie, nom, args);
  const b = await rpc(assistante.cookie, nom, args);
  const f = (x) => `http=${x.http} ok=${x.ok} n=${x.lignes ?? "-"} ${x.code ?? ""}`.trim().padEnd(22);
  console.log(`${libelle.padEnd(27)}| ${f(a)}| ${f(b)}| `);
}

/**
 * DIFF CHAMP À CHAMP sur `get_patient` — la seule question qui tranche : si
 * l'assistante obtient la MÊME valeur que la praticienne sur un champ CLINIQUE,
 * la porte n'est pas cloisonnée ; si elle obtient moins/masqué, elle l'est.
 * Aucune valeur n'est imprimée : seuls les NOMS de champs et « identique ou non ».
 */
async function getPatientBrut(cookie) {
  const r = await fetch(`${BASE}/api/db/rpc`, {
    method: "POST",
    headers: { ...H, Cookie: cookie },
    body: JSON.stringify({ name: "get_patient", args: { p_id: "a1000000-0000-4000-8000-000000001001" } }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => null);
  return Array.isArray(j?.data) ? j.data[0] : null;
}

const pa = await getPatientBrut(medecin.cookie);
const pb = await getPatientBrut(assistante.cookie);
console.log("\nDIFF `get_patient` — praticienne vs assistante");
if (pa === null || pb === null) {
  console.log(`  praticienne=${pa === null ? "vide" : "1 ligne"} · assistante=${pb === null ? "vide" : "1 ligne"}`);
} else {
  const cles = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
  const identiques = [];
  const differents = [];
  const absents = [];
  for (const k of cles) {
    const va = pa[k];
    const vb = pb[k];
    if (!(k in pb)) absents.push(k);
    else if (JSON.stringify(va) !== JSON.stringify(vb)) differents.push(k);
    else identiques.push(k);
  }
  console.log(`  champs identiques (${identiques.length}): ${identiques.join(", ")}`);
  console.log(`  champs DIFFÉRENTS (${differents.length}): ${differents.join(", ") || "—"}`);
  console.log(`  champs ABSENTS côté assistante (${absents.length}): ${absents.join(", ") || "—"}`);
}
// Valeur de contrôle finance — le fait de vérité de E1, sans modèle.
const rev = await rpc(medecin.cookie, "day_revenue", { p_day: "2026-09-16" });
console.log(`\nE1 — recette du jour (fait de vérité, sans modèle) : ligne=${rev.lignes}`);
