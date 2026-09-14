#!/usr/bin/env node
/**
 * `mesure-alexa-repro.mjs` — SONDE DE REPRODUCTION DE L'ÉCHEC ALEXA, STACK LOCALE.
 *
 * v2 (phase 5.5) — la v1 visait les Edge Functions Supabase (`/functions/v1/…`,
 * GoTrue). La phase 6 a retiré Supabase : l'application parle à
 * `http://127.0.0.1:3000/api/…` avec un cookie `httpOnly` posé par
 * `POST /api/auth/sign-in`. Cette version rejoue le chemin réel du navigateur.
 *
 * Compte de mesure : `owner.dev@invalid.local` + `DEV_ACCOUNT_PASSWORD` de
 * `.env` — jamais imprimé, jamais journalisé, jamais persisté. Seules des
 * métadonnées safe sortent : statuts, codes nommés, durées, longueurs.
 *
 * AUCUN CONTENU CLINIQUE N'EST IMPRIMÉ — que des codes, des versions, des
 * durées. Aucune écriture hors `audit` normal des portes et du carnet Jarvis
 * (effet de bord normal des appels, comme au navigateur).
 *
 *     node scripts/mesure-alexa-repro.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "jarvis-phase5-5-preuves");
const BASE = process.env.MESURE_BASE ?? "http://127.0.0.1:3000";
const EMAIL_COMPTE = "owner.dev@invalid.local";

const lignes = [];
function ligne(verdict, label, detail = "") {
  lignes.push({ verdict, label, detail });
  console.log(`${verdict.padEnd(5)} | ${label}${detail ? " | " + detail : ""}`);
}

/** `.env` lu en local uniquement — les valeurs ne sortent JAMAIS. */
function lireEnv() {
  const env = {};
  for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  mkdirSync(PREUVES, { recursive: true });
  const env = lireEnv();
  const mdp = env["DEV_ACCOUNT_PASSWORD"] ?? "";
  const modele = env["OPENROUTER_MODEL"] ?? "(absent)";

  ligne("info", "0 · modèle effectif (nom seul)", modele);
  if (mdp === "") {
    ligne("ROUGE", "0 · DEV_ACCOUNT_PASSWORD absent de .env", "sonde bloquée");
    return;
  }
  ligne("vert", "0 · DEV_ACCOUNT_PASSWORD présent", "valeur jamais affichée");

  // ── 1 · santé ──
  let sante = null;
  try {
    const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(15_000) });
    sante = await r.json().catch(() => null);
    ligne(r.status === 200 && sante?.ok === true ? "vert" : "ROUGE", "1 · /api/health", `status=${r.status}`);
  } catch (e) {
    ligne("ROUGE", "1 · /api/health", `injoignable: ${e instanceof Error ? e.message : "?"}`);
    return;
  }

  // ── 2 · sign-in owner.dev ──
  const tLogin = Date.now();
  const repLogin = await fetch(`${BASE}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL_COMPTE, password: mdp }),
    signal: AbortSignal.timeout(30_000),
  });
  const corpsLogin = await repLogin.json().catch(() => null);
  const setCookie = repLogin.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  const connecte = corpsLogin?.ok === true && cookie !== "";
  ligne(
    connecte ? "vert" : "ROUGE",
    "2 · sign-in owner.dev",
    `status=${repLogin.status} code=${corpsLogin?.ok === true ? "ok" : String(corpsLogin?.code ?? "?")} en ${Date.now() - tLogin} ms`,
  );
  if (!connecte) return;
  const H = { "Content-Type": "application/json", Cookie: cookie };

  const rpc = async (name, args) => {
    const r = await fetch(`${BASE}/api/db/rpc`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name, args }),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: r.status, corps: await r.json().catch(() => null) };
  };

  // ── 3 · RLS + portes : search_patients ──
  const repS = await rpc("search_patients", { p_query: "", p_limit: 5, p_offset: 0 });
  const patients = repS.corps?.ok === true ? repS.corps.data : null;
  ligne(
    Array.isArray(patients) ? "vert" : "ROUGE",
    "3 · search_patients (RLS + porte)",
    `status=${repS.status} dossiers=${Array.isArray(patients) ? patients.length : String(repS.corps?.code ?? "?")}`,
  );
  if (!Array.isArray(patients)) return;

  // ── 4 · consultation portant des notes ──
  let cible = null;
  let longueurNotes = 0;
  for (const p of patients.slice(0, 5)) {
    const tl = await rpc("list_patient_timeline", {
      p_id: p.id,
      p_before_at: null,
      p_before_id: null,
      p_limit: 40,
    });
    const evenements = tl.corps?.ok === true ? tl.corps.data : null;
    if (!Array.isArray(evenements)) continue;
    for (const e of evenements) {
      if (e.event_type !== "consultation") continue;
      const id = e.event_id ?? null;
      if (id === null) continue;
      const c = await rpc("get_consultation", { p_id: id });
      const consultation = Array.isArray(c.corps?.data) ? c.corps.data[0] : c.corps?.data;
      if (typeof consultation?.raw_notes === "string" && consultation.raw_notes.trim() !== "") {
        cible = id;
        longueurNotes = consultation.raw_notes.length;
        break;
      }
    }
    if (cible !== null) break;
  }
  ligne(
    cible !== null ? "vert" : "ROUGE",
    "4 · consultation cible portant des notes",
    cible === null ? "aucune trouvée parmi les 5 premiers dossiers" : `notes=${longueurNotes} car.`,
  );

  // ── 5 · chat connaissance (chemin sans dossier) ──
  const tC = Date.now();
  const repC = await fetch(`${BASE}/api/jarvis/jarvis-chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      message: "Quelle est la différence entre anxiété généralisée et trouble panique ?",
      conversationId: crypto.randomUUID(),
      clientTurnId: crypto.randomUUID(),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const corpsC = await repC.json().catch(() => null);
  const okC = corpsC?.ok === true;
  ligne(
    okC ? "vert" : "ROUGE",
    "5 · jarvis-chat (connaissance)",
    `http=${repC.status} chemin=${String(corpsC?.data?.chemin ?? corpsC?.error?.code ?? "?")} en ${Date.now() - tC} ms`,
  );
  if (!okC) {
    ligne("info", "5a · erreur chat", `code=${String(corpsC?.error?.code ?? "?")}`.slice(0, 120));
  }

  // ── 6 · analyse de séance (la surface du message observé) ──
  if (cible !== null) {
    const tA = Date.now();
    const repA = await fetch(`${BASE}/api/jarvis/jarvis-analyze-session`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ consultationId: cible }),
      signal: AbortSignal.timeout(180_000),
    });
    const corpsA = await repA.json().catch(() => null);
    const okA = corpsA?.ok === true;
    ligne(
      okA ? "vert" : "ROUGE",
      "6 · jarvis-analyze-session",
      `http=${repA.status} code=${okA ? "ok" : String(corpsA?.error?.code ?? "?")} persistee=${String(corpsA?.data?.persistee ?? "—")} v=${String(corpsA?.data?.version ?? "—")} en ${Date.now() - tA} ms`,
    );
    if (!okA) {
      ligne("info", "6a · erreur analyse", `code=${String(corpsA?.error?.code ?? "?")}`.slice(0, 120));
    }
  }

  const rapport = {
    phase: "MESURE-ALEXA-REPRO-LOCALE",
    date: new Date().toISOString(),
    modele,
    lignes,
  };
  writeFileSync(path.join(PREUVES, "verdict.json"), JSON.stringify(rapport, null, 2));
  console.log("");
  console.log(`MESURE-ALEXA-REPRO — preuves : ${PREUVES}`);
}

main().catch((err) => {
  console.error("SONDE EN ERREUR :", err instanceof Error ? err.message : String(err));
  process.exit(2);
});