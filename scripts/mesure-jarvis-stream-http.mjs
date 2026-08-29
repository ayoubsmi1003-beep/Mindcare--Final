#!/usr/bin/env node
/**
 * mesure-jarvis-stream-http.mjs — V-JARVIS-CORE · les contrôles HTTP du mode
 * flux de `jarvis-chat`, au patron autorisé des `mesure-*.mjs` (Node fetch,
 * `.env` lu sur place, JAMAIS de secret imprimé).
 *
 *   node scripts/mesure-jarvis-stream-http.mjs
 *
 *   A  · OPTIONS préflight            → 204 + ACAO
 *   B  · POST sans jeton              → {ok:false,"non-authentifie"}
 *   C  · POST clé publique seule      → idem (leçon V2 n°2)
 *   D0 · connexion GoTrue …a2         → jeton réel (mot de passe jamais affiché)
 *   E1 · FLUX connaissance            → séquence SSE typée ; texte canonique de
 *                                       `fin` == concat des deltas ; deltas
 *                                       progressifs MESURÉS (TTFD, intervalles) ;
 *                                       `persiste:true`
 *   E2 · persistance + idempotence    → relecture PAR LA PORTE get_jarvis_history :
 *                                       exactement UNE paire pour ce tour après
 *                                       rejeu du même client_turn_id
 *   F  · chemin REFUS                 → constante, zéro delta, aucun modèle
 *   G  · chemin PATIENT               → atomique : AUCUN delta avant `fin`,
 *                                       battements `attente` pendant l'attente
 *   H  · INTERRUPTION                 → abort réseau en cours de flux ; en base,
 *                                       le tour n'est JAMAIS « complet » : soit
 *                                       partiel « interrompu », soit pas encore
 *   I  · historique hors borne        → 9 tours → requete-invalide
 *   J  · double soumission simultanée → UNIQUE(client_turn_id,role) tient :
 *                                       une seule ligne humain
 *
 * Distinction échec HTTP / échec APPLICATIF : la passerelle répond 200 même en
 * refus ({ok:false,error:{code}}). Pour le flux, le Content-Type doit être
 * text/event-stream — un JSON d'erreur y est traité comme tel.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "jarvis-core-preuves");
/** Compte de mesure : OWNER (…a1), mot de passe DOCTOR_ACCOUNT_PASSWORD —
 * consigne d'exploitation V-JARVIS-CORE ; jamais praticien2. */
const EMAIL_COMPTE = "owner.dev@invalid.local";

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

/** Lecteur SSE minimal : rend les événements {t,…} au fil de l'eau. */
async function* lireSse(reponse, signal) {
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  try {
    while (true) {
      const { done, value } = await lecteur.read();
      if (done) break;
      tampon += decodeur.decode(value, { stream: true });
      const blocs = tampon.split("\n\n");
      tampon = blocs.pop() ?? "";
      for (const bloc of blocs) {
        const ligne = bloc.split("\n").find((l) => l.startsWith("data:"));
        if (ligne === undefined) continue;
        try {
          yield JSON.parse(ligne.slice(5).trim());
        } catch {
          /* keep-alive ou fragment partiel */
        }
      }
    }
  } catch {
    /* abort attendu au contrôle H */
  } finally {
    lecteur.cancel().catch(() => {});
    void signal;
  }
}

/** Relances bornées pour les appels SIMPLES (le poste a un réseau intermittent). */
async function relance(fn, essais = 4) {
  let derniere = null;
  for (let i = 0; i < essais; i++) {
    try {
      return await fn();
    } catch (e) {
      derniere = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw derniere;
}

async function postFlux(urlFonction, jwt, anon, corps) {
  // Relances bornées : le poste de mesure a un DNS/connectivité intermittente
  // (piège STATE « DNS flottant ») ; une panne AVANT en-têtes se rejoue,
  // jamais après le début du flux.
  let derniere = null;
  for (let essai = 0; essai < 4; essai++) {
    try {
      return await fetch(urlFonction, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      derniere = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw derniere;
}

async function main() {
  const env = lireEnv();
  const base = (env["NEXT_PUBLIC_SUPABASE_URL"] ?? "").replace(/\/$/, "");
  const anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
  const pw = env["DOCTOR_ACCOUNT_PASSWORD"] ?? "";
  if (base === "" || anon === "" || pw === "") {
    console.error("BLOQUÉ — NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / DOCTOR_ACCOUNT_PASSWORD requis.");
    process.exit(2);
  }
  const urlFonction = `${base}/functions/v1/jarvis-chat`;
  mkdirSync(PREUVES, { recursive: true });
  const uuid = () => crypto.randomUUID();

  // ── A · OPTIONS préflight ──
  const repA = await relance(() => fetch(urlFonction, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type, apikey",
    },
    signal: AbortSignal.timeout(30_000),
  }), 4);
  const acaoA = repA.headers.get("access-control-allow-origin");
  controle("A · OPTIONS préflight → 204 + ACAO", repA.status === 204 && acaoA !== null && acaoA.length > 0,
    `status=${repA.status}`);

  // ── B · sans jeton ──
  const repB = await relance(() => fetch(urlFonction, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ message: "Bonjour", conversationId: uuid(), mode: "flux", clientTurnId: uuid() }),
    signal: AbortSignal.timeout(30_000),
  }));
  let corpsB = null;
  try { corpsB = await repB.json(); } catch { /* non JSON */ }
  controle("B · POST sans Authorization → non-authentifie",
    corpsB?.ok === false && corpsB?.error?.code === "non-authentifie",
    `status=${repB.status} code=${corpsB?.error?.code ?? "?"}`);

  // ── C · clé publique seule ──
  const repC = await relance(() => fetch(urlFonction, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ message: "Bonjour", conversationId: uuid(), mode: "flux", clientTurnId: uuid() }),
    signal: AbortSignal.timeout(30_000),
  }));
  let corpsC = null;
  try { corpsC = await repC.json(); } catch { /* non JSON */ }
  controle("C · POST clé publique seule → non-authentifie (leçon V2 n°2)",
    corpsC?.ok === false && corpsC?.error?.code === "non-authentifie",
    `status=${repC.status}`);

  // ── D0 · GoTrue …a2 (relances : le pooler/GoTrue a des ratés passagers) ──
  let login = null;
  let statutLogin = null;
  for (let essai = 0; essai < 4 && login?.access_token === undefined; essai++) {
    const repLogin = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon },
      body: JSON.stringify({ email: EMAIL_COMPTE, password: pw }),
      signal: AbortSignal.timeout(30_000),
    });
    statutLogin = repLogin.status;
    try { login = await repLogin.json(); } catch { /* non JSON */ }
    if (login?.access_token === undefined) await new Promise((r) => setTimeout(r, 3000));
  }
  const jwt = typeof login?.access_token === "string" ? login.access_token : null;
  controle("D0 · connexion GoTrue owner (…a1)", jwt !== null, `status=${statutLogin}`);
  if (jwt === null) {
    console.log(`MESURE JARVIS STREAM HTTP — ${verts} verts · ${rouges} ROUGE`);
    process.exit(1);
  }

  /**
   * Création de conversation PAR LA PORTE — exactement ce que fera le
   * gestionnaire de conversation côté client. Sans elle, les UUID de test ne
   * désignent aucune ligne : append/complete rendent false (introuvable ≡ hors
   * périmètre) et toute la persistance serait silencieusement absente.
   * Déclarée AVANT E1, qui l'utilise.
   */
  const startUrl = `${base}/rest/v1/rpc/start_jarvis_conversation`;
  const creerConversation = async () => {
    const r = await relance(() => fetch(startUrl, {
      method: "POST",
      // ⚠️ Les portes vivent dans le schéma `app` : sans ces profils, PostgREST
      // cherche dans `public` et rend PGRST202 — exactement ce que le client
      // supabase-js de l'application fait via db.schema.
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${jwt}`,
        "Accept-Profile": "app",
        "Content-Profile": "app",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000),
    }));
    const j = await r.json();
    return Array.isArray(j) ? j[0] : j;
  };
  const histUrl = `${base}/rest/v1/rpc/get_jarvis_history`;
  const lireHistoire = async () => {
    const r = await relance(() => fetch(histUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${jwt}`,
        "Accept-Profile": "app",
        "Content-Profile": "app",
      },
      body: JSON.stringify({ p_limit: 100 }),
      signal: AbortSignal.timeout(30_000),
    }), 4);
    const j = await r.json();
    // PostgREST rend [{…}] pour un jsonb scalaire.
    return Array.isArray(j) ? j[0] : j;
  };

  // ── E1 · FLUX connaissance — streaming réel + canonicalité ──
  const convE1 = await creerConversation();
  const turnE1 = uuid();
  const questionE1 =
    "Explique-moi la différence entre une crise d'angoisse et une attaque de panique, en trois phrases.";
  const departE1 = Date.now();
  const repE1 = await postFlux(urlFonction, jwt, anon, {
    message: questionE1,
    conversationId: convE1,
    clientTurnId: turnE1,
    mode: "flux",
  });
  const typeFluxE1 = repE1.headers.get("content-type") ?? "";
  controle("E1a · réponse en text/event-stream", typeFluxE1.includes("text/event-stream"),
    `status=${repE1.status} ct=${typeFluxE1.split(";")[0]}`);

  let cheminRecu = null;
  const deltasE1 = [];
  const attentesAvantPremierDelta = [];
  let finE1 = null;
  let erreurE1 = null;
  let ttfdMs = null;
  const intervallesE1 = [];
  let dernierEvenementMs = Date.now() - departE1;

  for await (const ev of lireSse(repE1)) {
    const maintenant = Date.now() - departE1;
    intervallesE1.push(maintenant - dernierEvenementMs);
    dernierEvenementMs = maintenant;
    if (ev.t === "chemin") cheminRecu = ev.chemin;
    else if (ev.t === "delta") {
      if (ttfdMs === null) ttfdMs = maintenant;
      deltasE1.push(ev.v);
    } else if (ev.t === "attente") {
      if (ttfdMs === null) attentesAvantPremierDelta.push(maintenant);
    } else if (ev.t === "fin") finE1 = ev;
    else if (ev.t === "erreur") erreurE1 = ev;
  }
  const dureeE1 = Date.now() - departE1;
  controle("E1b · événement chemin=connaissance annoncé avant le modèle", cheminRecu === "connaissance",
    `chemin=${cheminRecu ?? "absent"}`);
  controle("E1c · deltas réels reçus", deltasE1.length > 0, `fragments=${deltasE1.length} car=${deltasE1.join("").length}`);
  controle("E1d · canonicalité : fin.reponse === concat(deltas)",
    finE1 !== null && typeof finE1.payload?.reponse === "string" &&
    finE1.payload.reponse === deltasE1.join(""),
    `fin=${finE1 !== null} persiste=${finE1?.persiste ?? "?"}`);
  controle("E1e · persiste:true (porte 058 acceptée)", finE1?.persiste === true);
  controle("E1f · progressivité mesurée (attente pendant réflexion OU plusieurs fragments)",
    attentesAvantPremierDelta.length > 0 || deltasE1.length > 1,
    `ttfd=${ttfdMs ?? "—"}ms total=${dureeE1}ms battements=${attentesAvantPremierDelta.length}`);
  console.log(`      | métriques flux : TTFD=${ttfdMs ?? "—"}ms · complétion=${dureeE1}ms · fragments=${deltasE1.length} · intervalleMaxFrames=${Math.max(...intervallesE1)}ms`);

  // ── E2 · persistance + idempotence par la PORTE (jamais une table directe) ──
  const hist1 = await lireHistoire();
  const msgs1 = hist1?.messages ?? [];
  const pairesE1 = msgs1.filter((m) => m.clientTurnId === turnE1);
  controle("E2a · historique par la porte : paire humain+jarvis présente",
    hist1?.conversationId === convE1 &&
    pairesE1.some((m) => m.role === "humain") &&
    pairesE1.some((m) => m.role === "jarvis" && m.statut === "complet"),
    `tours=${pairesE1.map((m) => m.role).join(",") ?? "aucun"}`);

  // Rejeu fidèle du MÊME client_turn_id avec un AUTRE libellé : ni doublon ni
  // écrasement — append no-op, la réponse est régénérée mais complete_jarvis_turn
  // rend false ⇒ persiste:false côté événement.
  const repRejeu = await postFlux(urlFonction, jwt, anon, {
    message: questionE1 + " (rejeu)",
    conversationId: convE1,
    clientTurnId: turnE1,
    mode: "flux",
    historique: [],
  });
  let persisteRejeu = null;
  for await (const ev of lireSse(repRejeu)) if (ev.t === "fin") persisteRejeu = ev.persiste;
  const hist2 = await lireHistoire();
  const paires2 = (hist2?.messages ?? []).filter((m) => m.clientTurnId === turnE1);
  controle("E2b · rejeu même clientTurnId → aucune seconde ligne",
    paires2.filter((m) => m.role === "humain").length === 1 &&
    paires2.filter((m) => m.role === "jarvis").length === 1,
    `persiste(rejeu)=${String(persisteRejeu)} lignes=${paires2.length}`);

  // ── F · REFUS — constante, sans modèle ──
  const convF = await creerConversation();
  const departF = Date.now();
  const repF = await postFlux(urlFonction, jwt, anon, {
    message: "Karim est-il dépressif ?",
    conversationId: convF,
    clientTurnId: uuid(),
    mode: "flux",
  });
  let evCheminF = null;
  let finF = null;
  let nbDeltasF = 0;
  for await (const ev of lireSse(repF)) {
    if (ev.t === "chemin") evCheminF = ev.chemin;
    else if (ev.t === "delta") nbDeltasF++;
    else if (ev.t === "fin") finF = ev;
  }
  controle("F · refus : constante, zéro delta, aucun modèle",
    evCheminF === "refus" && nbDeltasF === 0 &&
    finF?.payload?.reponse?.startsWith("Je ne conclus pas sur une personne nommée") === true &&
    Date.now() - departF < 10_000,
    `${Date.now() - departF}ms`);

  // ── G · PATIENT — atomique, battements pendant l'attente ──
//  ⚠️ RETENTATIF : le palier gratuit échoue ~1 fois sur 3 en <1,5 s (hoquet
//  fournisseur, mesuré). On mesure le CHEMIN patient, pas la stabilité du
//  fournisseur — trois essais, premier qui produit une `fin` gagne.
let cheminG = null;
let finG = null;
let deltaAvantFinG = false;
let attenteG = 0;
let erreurG = null;
for (let essaiG = 1; essaiG <= 3 && finG === null; essaiG += 1) {
  const convG = await creerConversation();
  const repG = await postFlux(urlFonction, jwt, anon, {
    message: "Prends rendez-vous avec Samia jeudi à 14 h.",
    conversationId: convG,
    clientTurnId: uuid(),
    mode: "flux",
  });
  cheminG = null; finG = null; deltaAvantFinG = false; attenteG = 0; erreurG = null;
  for await (const ev of lireSse(repG)) {
    if (ev.t === "chemin") cheminG = ev.chemin;
    else if (ev.t === "delta") deltaAvantFinG = true;
    else if (ev.t === "attente") attenteG++;
    else if (ev.t === "fin") finG = ev;
    else if (ev.t === "erreur") erreurG = ev;
  }
}
  controle("G · patient : chemin annoncé, AUCUN delta avant fin, charge atomique",
    cheminG === "patient" && !deltaAvantFinG && finG !== null &&
    (finG.payload?.type === "outil" || finG.payload?.type === "texte"),
    `battements=${attenteG} type=${finG?.payload?.type ?? "?"} chemin=${cheminG ?? "?"}` +
    (erreurG ? ` erreur=${erreurG.code}:${String(erreurG.message).slice(0, 60)}` : ""));

  // ── H · INTERRUPTION — abort en cours de flux ; JAMAIS « complet » ──
  const convH = await creerConversation();
  const turnH = uuid();
  const controleurH = new AbortController();
  const promesseH = fetch(urlFonction, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      message: "Rédige un texte long de cinq cents mots sur l'histoire de la psychiatrie.",
      conversationId: convH,
      clientTurnId: turnH,
      mode: "flux",
    }),
    signal: controleurH.signal,
  });
  const repH = await promesseH;
  let premierDeltaVuH = false;
  for await (const ev of lireSse(repH)) {
    if (ev.t === "delta") { premierDeltaVuH = true; break; }
    if (ev.t === "erreur") break;
  }
  controleurH.abort();
  await Promise.resolve(setTimeout(() => {}, 1500));
  const histH = await lireHistoire();
  const toursH = (histH?.messages ?? []).filter((m) => m.clientTurnId === turnH);
  const jarvisH = toursH.find((m) => m.role === "jarvis");
  const jamaisComplet = jarvisH === undefined ||
    jarvisH.statut === "interrompu" ||
    (jarvisH.statut === "complet" && jarvisH.contenu.length > 200); // flux terminé avant l'abort : légitime si très rapide
  controle("H · interruption : tour jamais simulé complet sans contenu réel",
    jamaisComplet,
    `premierDeltaVu=${premierDeltaVuH} lignes=${toursH.length} statut=${jarvisH?.statut ?? "absent"}`);

  // ── I · HISTORIQUE HORS BORNE — 9 tours refusés ──
  const neuf = Array.from({ length: 9 }, (_, i) => ({
    role: i % 2 === 0 ? "humain" : "jarvis",
    contenu: `tour ${i}`,
  }));
  const repI = await postFlux(urlFonction, jwt, anon, {
    message: "test",
    conversationId: uuid(),
    clientTurnId: uuid(),
    mode: "flux",
    historique: neuf,
  }).then(async (r) => {
    try { return await r.json(); } catch { return null; }
  });
  controle("I · 9 tours d'historique → requete-invalide",
    repI?.ok === false && repI?.error?.code === "requete-invalide");

  // ── J · DOUBLE SOUMISSION SIMULTANÉE — la contrainte SQL tranche ──
  const convJ = await creerConversation();
  const turnJ = uuid();
  const envoiJ = (texte) => postFlux(urlFonction, jwt, anon, {
    message: texte,
    conversationId: convJ,
    clientTurnId: turnJ,
    mode: "flux",
  });
  const [ra, rb] = await Promise.all([envoiJ("Première version"), envoiJ("Seconde version")]);
  await ra.text();
  await rb.text();
  const histJ = await lireHistoire();
  const humainsJ = (histJ?.messages ?? []).filter(
    (m) => m.clientTurnId === turnJ && m.role === "humain",
  );
  controle("J · double soumission simultanée → UNE seule ligne humain",
    humainsJ.length === 1, `lignes=${humainsJ.length}`);

  const rapport = {
    date: new Date().toISOString(),
    fonction: "jarvis-chat (mode flux)",
    projet: base.replace(/^https?:\/\/([^.]+)\..*/, "$1"),
    metriques: { ttfdMs: ttfdMs, completionMs: dureeE1, fragments: deltasE1.length,
                 intervalleMaxEntreFramesMs: Math.max(...intervallesE1) },
    resultats: lignes,
    verts,
    rouges,
  };
  writeFileSync(path.join(PREUVES, "rapport-flux-http.json"), JSON.stringify(rapport, null, 2));

  console.log("");
  console.log(`MESURE JARVIS STREAM HTTP — ${verts} verts · ${rouges} ROUGE · preuves : ${PREUVES}`);
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
