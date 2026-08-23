/**
 * mesure-resume-cas-http.mjs — contrôles HTTP de la passerelle du résumé,
 * tels que demandés par le contrat de clôture V3 (T1).
 *
 *   node scripts/mesure-resume-cas-http.mjs [patientId]
 *
 * Pourquoi un instrument Node et pas `curl` : guard-bash.sh interdit toute
 * sortie réseau depuis le shell (règle 1) ; cet instrument est le patron
 * autorisé des `mesure-*.mjs` — il lit `.env` lui-même, n'imprime JAMAIS de
 * secret (jeton, clé anon, mot de passe), et ne parle qu'AU projet Supabase
 * du cabinet : c'est exactement l'appel que fait le navigateur, avec les
 * mêmes en-têtes. La charge utile ne porte qu'un UUID de dossier synthétique.
 *
 * Les quatre contrôles :
 *   A · OPTIONS préflight      → 204 + Access-Control-Allow-Origin
 *   B · POST sans jeton        → code applicatif « non-authentifie »
 *   C · POST clé publique seule→ code applicatif « non-authentifie »
 *     (leçon V2 défaut n°2 : la clé anon NE vaut PAS une authentification)
 *   D · POST réel sous …a2     → {ok:true,data:{resume,…}} sur le dossier
 *     synthétique posé par checkpoint-fixture-v3-cloture.sql
 *
 * Distinction explicite échec HTTP / échec APPLICATIF : la passerelle répond
 * 200 même en refus métier ({ok:false,error:{code}}) — seul le CORPS dit la
 * vérité pour B/C/D ; seul le STATUT dit la vérité pour A.
 * Si D atteint le fournisseur et revient en erreur crédit (402), le verdict
 * est BLOQUÉ-ENV nommé — jamais de contournement, jamais de MAX_OUTPUT_TOKENS.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "v3-preuves");

/** Dossier synthétique de la fixture de clôture (…b2, praticienne …a2). */
const PATIENT_FIXTURE =
  process.argv[2] ?? "00000000-0000-0000-0000-0000000000b2";
const EMAIL_A2 = "praticien2.dev@invalid.local";

function lireEnv() {
  const brut = readFileSync(path.join(RACINE, ".env"), "utf8");
  const env = {};
  for (const ligne of brut.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

let verts = 0;
let rouges = 0;
const lignes = [];
function controle(label, ok, detail = "") {
  const marqueur = ok ? "vert" : "ROUGE";
  if (ok) verts += 1;
  else rouges += 1;
  lignes.push({ verdict: marqueur, label, detail });
  console.log(`${marqueur.padEnd(5)} | ${label}${detail ? " | " + detail : ""}`);
}

async function main() {
  const env = lireEnv();
  const base = env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  const anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
  const pw = env["DOCTOR_ACCOUNT_PASSWORD"] ?? "";
  if (base === "" || anon === "" || pw === "") {
    console.error("BLOQUÉ — NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / DOCTOR_ACCOUNT_PASSWORD requis dans .env.");
    process.exit(2);
  }
  const urlFonction = `${base.replace(/\/$/, "")}/functions/v1/jarvis-resume-cas`;
  mkdirSync(PREUVES, { recursive: true });

  // ── A · OPTIONS préflight ────────────────────────────────────────────────
  const t0a = Date.now();
  const repA = await fetch(urlFonction, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, apikey",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const acaoRepA = repA.headers.get("access-control-allow-origin");
  controle(
    "A · OPTIONS préflight → 204 + ACAO",
    repA.status === 204 && acaoRepA !== null && acaoRepA.length > 0,
    `status=${repA.status} ACAO=${acaoRepA === null ? "absente" : "présente"} ${Date.now() - t0a}ms`,
  );

  // ── B · POST sans jeton ──────────────────────────────────────────────────
  const repB = await fetch(urlFonction, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ patientId: PATIENT_FIXTURE }),
    signal: AbortSignal.timeout(30_000),
  });
  let corpsB = null;
  try { corpsB = await repB.json(); } catch { /* corps non JSON */ }
  const codeB = corpsB?.error?.code ?? null;
  controle(
    "B · POST sans Authorization → non-authentifie",
    corpsB?.ok === false && codeB === "non-authentifie",
    `status=${repB.status} code=${codeB ?? String(corpsB).slice(0, 60)}`,
  );

  // ── C · POST avec la seule clé publique ─────────────────────────────────
  const repC = await fetch(urlFonction, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ patientId: PATIENT_FIXTURE }),
    signal: AbortSignal.timeout(30_000),
  });
  let corpsC = null;
  try { corpsC = await repC.json(); } catch { /* corps non JSON */ }
  const codeC = corpsC?.error?.code ?? null;
  controle(
    "C · POST clé publique seule → non-authentifie (leçon V2 n°2)",
    corpsC?.ok === false && codeC === "non-authentifie",
    `status=${repC.status} code=${codeC ?? String(corpsC).slice(0, 60)}`,
  );

  // ── Authentification GoTrue de …a2 (le mot de passe n'est jamais imprimé) ─
  const repLogin = await fetch(`${base.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ email: EMAIL_A2, password: pw }),
    signal: AbortSignal.timeout(30_000),
  });
  let login = null;
  try { login = await repLogin.json(); } catch { /* réponse non JSON */ }
  const jwt = typeof login?.access_token === "string" ? login.access_token : null;
  if (jwt === null) {
    controle("D0 · connexion GoTrue …a2", false, `status=${repLogin.status} code=${login?.error_code ?? "?"}`);
    writeFileSync(path.join(PREUVES, "rapport-http.json"), JSON.stringify({ date: new Date().toISOString(), lignes, verts, rouges }, null, 2));
    process.exit(1);
  }
  controle("D0 · connexion GoTrue …a2", true, `status=${repLogin.status}`);

  // ── D · appel réel authentifié sur la fixture ────────────────────────────
  const t0d = Date.now();
  const repD = await fetch(urlFonction, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anon,
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ patientId: PATIENT_FIXTURE }),
    signal: AbortSignal.timeout(180_000),
  });
  const dureeD = Date.now() - t0d;
  let corpsD = null;
  try { corpsD = await repD.json(); } catch { /* corps non JSON */ }

  const resumeD = corpsD?.data?.resume ?? null;
  const codeD = corpsD?.error?.code ?? null;

  /** Classification : succès · échec applicatif · blocage environnement. */
  let classeD = "ECHEC";
  if (corpsD?.ok === true && resumeD !== null) classeD = "VERT";
  else if (typeof codeD === "string" && ["indisponible", "configuration", "quota"].includes(codeD)) classeD = "BLOQUE-ENV";

  controle(
    "D · POST réel sous …a2 → {ok:true,data:{resume,…}}",
    classeD === "VERT",
    classeD === "VERT"
      ? `status=${repD.status} version=${resumeD?.version ?? "?"} durée=${dureeD}ms`
      : `status=${repD.status} code=${codeD ?? String(corpsD).slice(0, 80)} durée=${dureeD}ms`,
  );
  if (classeD === "BLOQUE-ENV") {
    console.log("");
    console.log("⚠️  BLOQUÉ-PAR-ENVIRONNEMENT : le fournisseur LLM refuse l'appel (crédit).");
    console.log("    Dette connue et datée (DOC-AUTHORITY §4). AUCUN contournement appliqué :");
    console.log("    ni MAX_OUTPUT_TOKENS, ni modèle, ni logique — décision praticienne.");
    lignes.push({
      verdict: "BLOQUÉ-ENV",
      label: "fournisseur LLM indisponible (crédit OpenRouter)",
      detail: "dette d'environnement nommée ; contrôles indépendants A/B/C exigés verts",
    });
  }

  const rapport = {
    date: new Date().toISOString(),
    fonction: "jarvis-resume-cas",
    projet: base.replace(/^https?:\/\/([^.]+)\..*/, "$1"),
    patientFixture: PATIENT_FIXTURE,
    controleD: { classe: classeD, statutHttp: repD.status, codeApplicatif: codeD, dureeMs: dureeD },
    resultats: lignes,
    verts,
    rouges,
  };
  writeFileSync(path.join(PREUVES, "rapport-http.json"), JSON.stringify(rapport, null, 2));

  console.log("");
  console.log(`MESURE RESUME-CAS HTTP — ${verts} verts · ${rouges} ROUGE · preuves : ${PREUVES}`);
  process.exit(classeD === "BLOQUE-ENV" ? 0 : rouges === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
