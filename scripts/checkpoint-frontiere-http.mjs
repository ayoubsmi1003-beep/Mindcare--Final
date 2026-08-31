#!/usr/bin/env node
/**
 * checkpoint-frontiere-http — la chaîne ENTIÈRE, par HTTP, contre un vrai serveur.
 *
 * ═══ POURQUOI CE SCRIPT EXISTE EN PLUS DES TESTS D'INTÉGRATION ═════════════
 *
 * `tests/integration/frontiere-donnees.test.ts` éprouve les pièces : la
 * validation, les allowlists, le traducteur SQL. Il ne prouve PAS que la chaîne
 * tourne, parce qu'il n'emprunte jamais le chemin réel — cookie `httpOnly`,
 * `cookies()` de Next, résolution de session, `withCaller`, RLS.
 *
 * C'est exactement la leçon inscrite dans STATE.md : quinze verts hors ligne
 * recouvraient une chaîne qui n'avait jamais tourné. Un Route Handler qui n'a
 * jamais reçu de requête HTTP n'est pas vérifié, quel que soit le nombre de
 * tests autour.
 *
 * Le serveur est lancé par l'appelant (`next start`), ce script ne fait que
 * l'interroger. Verdict VERT/ROUGE, sans nuance : si on ne peut pas prouver,
 * c'est ROUGE.
 */

const BASE = process.env.MC_BASE ?? "http://127.0.0.1:3210";
const EMAIL = process.env.MC_EMAIL ?? "";
const MDP = process.env.MC_MDP ?? "";

let echecs = 0;
let reussites = 0;

function verdict(ok, titre, detail) {
  if (ok) {
    reussites += 1;
    console.log(`  ✅ ${titre}`);
  } else {
    echecs += 1;
    console.log(`  🔴 ${titre}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

/** Conserve le cookie de session entre les appels, comme le ferait un navigateur. */
let cookie = "";

async function appeler(chemin, options = {}) {
  const entetes = { ...(options.headers ?? {}) };
  if (cookie !== "") entetes.Cookie = cookie;
  const r = await fetch(`${BASE}${chemin}`, { ...options, headers: entetes, redirect: "manual" });
  const brut = r.headers.getSetCookie?.() ?? [];
  for (const c of brut) {
    const paire = c.split(";")[0];
    if (paire !== undefined && paire.startsWith("mc_session=")) {
      cookie = paire.endsWith("=") ? "" : paire;
    }
  }
  let corps;
  try {
    corps = await r.json();
  } catch {
    corps = undefined;
  }
  return { statut: r.status, corps, entetes: r.headers };
}

const json = (o) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(o),
});

async function main() {
  console.log("checkpoint-frontiere-http — la chaîne complète, par HTTP\n");

  console.log("1 · avant connexion, la frontière est fermée");
  {
    const s = await appeler("/api/auth/session");
    verdict(s.statut === 200 && s.corps?.data === null, "GET /api/auth/session rend « personne »", `statut ${s.statut}`);

    const r = await appeler("/api/db/rpc", json({ name: "search_patients", args: {} }));
    verdict(r.statut === 401, "POST /api/db/rpc sans session → 401", `statut ${r.statut}`);

    const sel = await appeler("/api/db/select", json({ relation: "profiles", columns: ["id"] }));
    verdict(sel.statut === 401, "POST /api/db/select sans session → 401", `statut ${sel.statut}`);
  }

  console.log("\n2 · connexion");
  {
    const mauvais = await appeler("/api/auth/sign-in", json({ email: EMAIL, password: "faux-mot-de-passe" }));
    verdict(mauvais.statut === 401, "mot de passe faux → 401", `statut ${mauvais.statut}`);
    verdict(cookie === "", "aucun cookie posé sur un échec");

    const inconnu = await appeler("/api/auth/sign-in", json({ email: "inconnu@invalid.local", password: "x" }));
    verdict(
      inconnu.statut === 401 && inconnu.corps?.code === mauvais.corps?.code,
      "compte inconnu INDISTINGUABLE d'un mot de passe faux",
      `${inconnu.statut}/${inconnu.corps?.code} vs ${mauvais.statut}/${mauvais.corps?.code}`,
    );

    const bon = await appeler("/api/auth/sign-in", json({ email: EMAIL, password: MDP }));
    verdict(bon.statut === 200 && typeof bon.corps?.data?.userId === "string", "connexion réussie", `statut ${bon.statut}`);
    verdict(cookie.startsWith("mc_session="), "cookie de session posé");
    verdict(
      JSON.stringify(bon.corps).includes(cookie.slice("mc_session=".length)) === false,
      "le JETON n'apparaît PAS dans le corps de la réponse",
    );
  }

  console.log("\n3 · le cookie est bien httpOnly");
  {
    const r = await fetch(`${BASE}/api/auth/sign-in`, json({ email: EMAIL, password: MDP }));
    const entetes = r.headers.getSetCookie?.() ?? [];
    const mc = entetes.find((c) => c.startsWith("mc_session="));
    verdict(mc !== undefined && /HttpOnly/i.test(mc), "Set-Cookie porte HttpOnly", mc);
    verdict(mc !== undefined && /SameSite=Lax/i.test(mc), "Set-Cookie porte SameSite=Lax", mc);
  }

  console.log("\n4 · sous session, la frontière fonctionne");
  {
    const s = await appeler("/api/auth/session");
    verdict(s.statut === 200 && typeof s.corps?.data?.userId === "string", "GET /api/auth/session rend l'identité");

    const r = await appeler("/api/db/rpc", json({ name: "search_patients", args: { p_query: null, p_limit: 5, p_offset: 0 } }));
    verdict(r.statut === 200 && Array.isArray(r.corps?.data), "rpc search_patients aboutit", `statut ${r.statut} ${JSON.stringify(r.corps)?.slice(0, 120)}`);

    // `dashboard_today(p_day date)` — l'argument est OBLIGATOIRE, et c'est
    // exactement ce que `src/services/dashboard.ts` envoie. La première
    // rédaction de ce contrôle l'appelait sans argument et rendait 500 : le
    // défaut était dans le contrôle, pas dans la frontière.
    const jour = new Date().toISOString().slice(0, 10);
    const d = await appeler("/api/db/rpc", json({ name: "dashboard_today", args: { p_day: jour } }));
    verdict(d.statut === 200, "rpc dashboard_today aboutit", `statut ${d.statut} ${JSON.stringify(d.corps)?.slice(0, 120)}`);

    // Et le cas symétrique : une signature qui ne correspond pas doit être une
    // ERREUR DE REQUÊTE (422), pas une panne serveur (500). L'allowlist ne
    // connaît pas l'arité ; c'est PostgreSQL qui tranche, par SQLSTATE 42883.
    const arite = await appeler("/api/db/rpc", json({ name: "dashboard_today", args: {} }));
    verdict(arite.statut === 422, "arguments non conformes → 422, pas 500", `statut ${arite.statut}`);

    const p = await appeler("/api/db/select", json({ relation: "profiles", columns: ["id", "role", "full_name"] }));
    verdict(p.statut === 200 && Array.isArray(p.corps?.data), "select profiles aboutit", `statut ${p.statut}`);
  }

  console.log("\n5 · les bornes de la frontière");
  {
    // Une fonction qui EXISTE en base mais qu'aucun service n'appelle.
    const hors = await appeler("/api/db/rpc", json({ name: "set_deployment_environment", args: {} }));
    verdict(hors.statut === 404, "fonction hors allowlist → 404 (pas d'oracle)", `statut ${hors.statut}`);

    const inexistante = await appeler("/api/db/rpc", json({ name: "fonction_inventee", args: {} }));
    verdict(
      inexistante.statut === hors.statut && inexistante.corps?.code === hors.corps?.code,
      "fonction inexistante INDISTINGUABLE d'une fonction non exposée",
      `${inexistante.statut} vs ${hors.statut}`,
    );

    // ADR-019 : la table patients n'est pas lisible en direct, même connectée.
    const pat = await appeler("/api/db/select", json({ relation: "patients", columns: ["id", "last_name"] }));
    verdict(pat.statut === 404, "select app.patients refusé par l'allowlist", `statut ${pat.statut}`);

    const colonne = await appeler("/api/db/select", json({ relation: "profiles", columns: ["signature_block"] }));
    verdict(colonne.statut === 404, "colonne non citée refusée", `statut ${colonne.statut}`);

    const cle = await appeler("/api/db/rpc", json({ name: "search_patients", args: { "p_query; DROP": "x" } }));
    verdict(cle.statut === 400, "clé d'argument malformée → 400", `statut ${cle.statut}`);

    const gros = await appeler("/api/db/select", json({ relation: "profiles", columns: ["id"], limit: 5000 }));
    verdict(gros.statut === 400, "limit hors borne → 400", `statut ${gros.statut}`);
  }

  console.log("\n6 · déconnexion : la révocation est réelle");
  {
    const avant = cookie;
    const out = await appeler("/api/auth/sign-out", { method: "POST" });
    verdict(out.statut === 200, "POST /api/auth/sign-out réussit", `statut ${out.statut}`);

    // On REJOUE volontairement l'ancien cookie : un jeton opaque révoqué doit
    // être refusé côté serveur, pas seulement oublié côté navigateur.
    cookie = avant;
    const rejoue = await appeler("/api/db/rpc", json({ name: "search_patients", args: {} }));
    verdict(rejoue.statut === 401, "l'ancien jeton REJOUÉ est refusé (401)", `statut ${rejoue.statut}`);
    cookie = "";
  }

  console.log("");
  if (echecs === 0) {
    console.log(`VERDICT : VERT — ${reussites} contrôles, 0 échec.`);
    process.exit(0);
  }
  console.log(`VERDICT : ROUGE — ${echecs} échec(s) sur ${reussites + echecs} contrôles.`);
  process.exit(1);
}

main().catch((e) => {
  console.error("VERDICT : ROUGE — le checkpoint lui-même a échoué :", e?.message ?? e);
  process.exit(1);
});
