/**
 * `mesure-analyse-persistance` — L'ANALYSE DE SÉANCE SURVIT-ELLE À L'ÉCRAN ?
 *
 * ═══ CE QUE CETTE SONDE PROUVE ═══
 *
 * Avant la migration 067, `jarvis-analyze-session` calculait une analyse et la
 * RENDAIT, sans rien écrire : elle vivait dans l'état React. Fermer la
 * consultation la perdait, le dossier n'en gardait rien, et le résumé du cas ne
 * pouvait pas la consommer. Le défaut était invisible depuis l'écran — l'analyse
 * s'affichait parfaitement — et ne se voyait qu'en revenant.
 *
 * Quatre contrôles, dans cet ordre :
 *   A · la porte de lecture existe et répond ;
 *   B · l'analyse est produite ET marquée persistée ;
 *   C · elle se RELIT par une seconde requête, indépendante de la première ;
 *   D · IDEMPOTENCE — relancer sans toucher aux notes ne crée pas de version 2.
 *
 * Le contrôle D est celui qui a le plus de valeur : sans lui, un double-clic
 * ou une relance après coupure réseau empilerait des analyses identiques, et
 * l'historique cesserait de vouloir dire quelque chose.
 *
 * ⚠️ AUCUN CONTENU CLINIQUE N'EST IMPRIMÉ — que des identifiants techniques,
 * des versions et des longueurs. La base visée est synthétique (ADR-016), mais
 * une sonde doit rester exécutable sans risque le jour où elle ne l'est plus.
 *
 *     node scripts/mesure-analyse-persistance.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMAIL = "praticien2.dev@invalid.local";
const ORIGINE = process.env.MESURE_ORIGINE ?? "http://localhost:3000";

const env = {};
for (const l of readFileSync(path.join(RACINE, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
  if (m !== null && m[2].trim() !== "") env[m[1]] = m[2].trim();
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
  lignes.push(`${ok ? "vert " : "ROUGE"} | ${nom.padEnd(44)} | ${detail}`);
  if (!ok) rouges += 1;
}
function fin(code) {
  console.log(lignes.join("\n"));
  console.log(`\nVERDICT : ${rouges === 0 ? "VERT" : "ROUGE"} — ${rouges} rouge(s).`);
  process.exit(code);
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
if (jwt === null) fin(2);

const h = {
  "Content-Type": "application/json",
  apikey: anon,
  Authorization: `Bearer ${jwt}`,
  "Accept-Profile": "app",
  "Content-Profile": "app",
};

/** Une consultation qui porte des notes — sans elle, l'analyse refuse (à raison). */
async function trouverConsultationAvecNotes() {
  const patients = await (
    await fetch(`${base}/rest/v1/rpc/search_patients`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ p_query: null, p_limit: 25, p_offset: 0 }),
    })
  ).json();
  if (!Array.isArray(patients)) return null;
  for (const p of patients) {
    const tl = await (
      await fetch(`${base}/rest/v1/rpc/list_patient_timeline`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          p_id: p.id,
          p_before_at: null,
          p_before_id: null,
          p_limit: 40,
        }),
      })
    ).json();
    if (!Array.isArray(tl)) continue;
    for (const e of tl) {
      // `list_patient_timeline` (047) rend `event_type` / `event_id`.
      if (e.event_type !== "consultation") continue;
      const id = e.event_id ?? null;
      if (id === null) continue;
      const c = await (
        await fetch(`${base}/rest/v1/rpc/get_consultation`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ p_id: id }),
        })
      ).json();
      const ligne = Array.isArray(c) ? c[0] : c;
      if (typeof ligne?.raw_notes === "string" && ligne.raw_notes.trim() !== "") {
        return { consultationId: id, longueurNotes: ligne.raw_notes.length };
      }
    }
  }
  return null;
}

const cible = await trouverConsultationAvecNotes();
if (cible === null) {
  controle("consultation portant des notes", false, "aucune trouvée — rien n'est mesurable");
  fin(2);
}
controle("consultation portant des notes", true, `notes=${cible.longueurNotes} car.`);

// ── A · la porte de lecture répond ────────────────────────────────────────
const repA = await fetch(`${base}/rest/v1/rpc/get_consultation_analysis`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({ p_consultation_id: cible.consultationId }),
});
const avant = await repA.json().catch(() => null);
controle("A · porte get_consultation_analysis", repA.status === 200 && Array.isArray(avant), `status=${repA.status}`);

// ── B · l'analyse est produite ET persistée ───────────────────────────────
async function analyser() {
  const r = await fetch(`${base}/functions/v1/jarvis-analyze-session`, {
    method: "POST",
    headers: { ...h, Origin: ORIGINE },
    body: JSON.stringify({ consultationId: cible.consultationId }),
    signal: AbortSignal.timeout(120_000),
  });
  return await r.json().catch(() => null);
}

const t0 = Date.now();
const un = await analyser();
if (un?.ok !== true) {
  controle("B · analyse produite", false, `code=${un?.error?.code ?? "?"} ${String(un?.error?.message ?? "").slice(0, 60)}`);
  fin(1);
}
controle(
  "B · analyse produite ET persistée",
  un.data.persistee === true && typeof un.data.analyseId === "string",
  `${Date.now() - t0} ms · v${String(un.data.version)} · persistee=${String(un.data.persistee)}`,
);

// ── C · elle se relit par une requête indépendante ────────────────────────
const repC = await fetch(`${base}/rest/v1/rpc/get_consultation_analysis`, {
  method: "POST",
  headers: h,
  body: JSON.stringify({ p_consultation_id: cible.consultationId }),
});
const relue = await repC.json().catch(() => null);
const ligneRelue = Array.isArray(relue) ? relue[0] : null;
const soap = ligneRelue?.content?.noteStructuree ?? null;
controle(
  "C · relue après coup (survit à l'écran)",
  ligneRelue?.id === un.data.analyseId && soap !== null,
  ligneRelue === null || ligneRelue === undefined
    ? "aucune ligne relue"
    : `id concordant=${String(ligneRelue.id === un.data.analyseId)} · SOAP=${String(soap !== null)}`,
);

// ── D · idempotence : mêmes notes, même prompt ⇒ AUCUNE version nouvelle ──
const deux = await analyser();
controle(
  "D · idempotente (pas de doublon au 2e appel)",
  deux?.ok === true && deux.data.analyseId === un.data.analyseId && deux.data.version === un.data.version,
  deux?.ok === true
    ? `v${String(un.data.version)} → v${String(deux.data.version)} · même id=${String(deux.data.analyseId === un.data.analyseId)}`
    : `code=${deux?.error?.code ?? "?"}`,
);

fin(rouges === 0 ? 0 : 1);
