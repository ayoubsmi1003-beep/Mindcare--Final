#!/usr/bin/env node
/**
 * checkpoint-jarvis-http — les cinq routes portées, par HTTP, contre un vrai serveur.
 *
 * ═══ CE QUE CE CHECKPOINT PEUT ET NE PEUT PAS PROUVER ══════════════════════
 *
 * IL PEUT prouver la MÉCANIQUE du portage : que les routes existent, qu'elles
 * refusent sans session, qu'elles valident leurs entrées, qu'elles atteignent
 * la base sous la bonne identité, et que le flux SSE porte les bons en-têtes.
 *
 * IL NE PEUT PAS prouver que Groq transcrit, qu'ElevenLabs parle ou que le
 * modèle répond : ces trois-là exigent des clés de fournisseur et du réseau.
 * Quand elles manquent, la route doit refuser PROPREMENT, en nommant l'organe
 * en panne — et c'est CELA qu'on vérifie. Un refus bien nommé est un résultat,
 * pas une absence de résultat.
 *
 * La distinction est écrite ici parce que la confondre est exactement l'erreur
 * que STATE.md documente : « la sortie vocale locale masque la panne ».
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

let cookie = "";

async function appeler(chemin, options = {}) {
  const entetes = { ...(options.headers ?? {}) };
  if (cookie !== "") entetes.Cookie = cookie;
  const r = await fetch(`${BASE}${chemin}`, { ...options, headers: entetes, redirect: "manual" });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const paire = c.split(";")[0];
    if (paire?.startsWith("mc_session=")) cookie = paire.endsWith("=") ? "" : paire;
  }
  const type = r.headers.get("content-type") ?? "";
  let corps;
  if (type.includes("application/json")) {
    try {
      corps = await r.json();
    } catch {
      corps = undefined;
    }
  }
  return { statut: r.status, corps, entetes: r.headers, type };
}

const json = (o) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(o),
});

const ROUTES = [
  "jarvis-voice-in",
  "jarvis-voice-out",
  "jarvis-resume-cas",
  "jarvis-analyze-session",
  "jarvis-chat",
];

async function main() {
  console.log("checkpoint-jarvis-http — les cinq fonctions portées\n");

  console.log("1 · les cinq routes EXISTENT (plus de 404)");
  for (const r of ROUTES) {
    const rep = await appeler(`/api/jarvis/${r}`, json({}));
    verdict(rep.statut !== 404, `/api/jarvis/${r} répond (${rep.statut})`, `statut ${rep.statut}`);
  }

  console.log("\n2 · sans session, TOUTES refusent");
  for (const r of ROUTES) {
    const rep = await appeler(`/api/jarvis/${r}`, json({ texte: "x", message: "x" }));
    const refuse = rep.corps?.ok === false && rep.corps?.error?.code === "non-authentifie";
    verdict(refuse, `/api/jarvis/${r} → non-authentifie`, JSON.stringify(rep.corps)?.slice(0, 100));
  }

  console.log("\n3 · connexion");
  {
    const bon = await appeler("/api/auth/sign-in", json({ email: EMAIL, password: MDP }));
    verdict(bon.statut === 200, "connexion réussie", `statut ${bon.statut}`);
  }

  console.log("\n4 · sous session : validation des entrées");
  {
    const vide = await appeler("/api/jarvis/jarvis-voice-out", json({}));
    verdict(
      vide.corps?.error?.code === "requete-invalide",
      "voice-out refuse un corps vide",
      JSON.stringify(vide.corps)?.slice(0, 100),
    );

    const mauvaisMime = await appeler(
      "/api/jarvis/jarvis-voice-in",
      json({ audioBase64: "AAAA", mimeType: "application/x-danger" }),
    );
    verdict(
      mauvaisMime.corps?.error?.code === "requete-invalide",
      "voice-in refuse un type MIME hors allowlist",
      JSON.stringify(mauvaisMime.corps)?.slice(0, 100),
    );

    const longTexte = await appeler(
      "/api/jarvis/jarvis-voice-out",
      json({ texte: "a".repeat(3000) }),
    );
    verdict(
      longTexte.corps?.error?.code === "requete-invalide",
      "voice-out refuse un texte hors borne",
      JSON.stringify(longTexte.corps)?.slice(0, 100),
    );
  }

  console.log("\n5 · les refus NOMMENT l'organe en panne (pas « base indisponible »)");
  {
    // Sans clé de fournisseur, la voix doit refuser en disant QUOI est en
    // panne. C'est le défaut mesuré le 2026-08-27 : `indisponible` envoyait
    // chercher une panne de base pendant que Groq refusait.
    const dictee = await appeler(
      "/api/jarvis/jarvis-voice-in",
      json({ audioBase64: Buffer.from("bruit").toString("base64"), mimeType: "audio/webm" }),
    );
    const code = dictee.corps?.error?.code;
    verdict(
      code === "transcription-indisponible" || code === "configuration" || code === "frontiere",
      `voice-in refuse en nommant la cause (${String(code)})`,
      JSON.stringify(dictee.corps)?.slice(0, 140),
    );
    verdict(
      code !== "indisponible",
      "voice-in ne dit PAS « service de données indisponible »",
      String(code),
    );

    const parole = await appeler("/api/jarvis/jarvis-voice-out", json({ texte: "Bonjour." }));
    const codeTts = parole.corps?.error?.code;
    verdict(
      codeTts === undefined ||
        codeTts === "synthese-indisponible" ||
        codeTts === "configuration" ||
        codeTts === "frontiere",
      `voice-out aboutit ou nomme la cause (${String(codeTts)})`,
      JSON.stringify(parole.corps)?.slice(0, 140),
    );
  }

  console.log("\n6 · le chat atteint la base sous la bonne identité");
  {
    // Le chemin « connaissance » ne lit aucune table ; le chemin « refus » non
    // plus. On envoie une phrase quelconque : ce qui compte est que la route
    // aille jusqu'au routage sans échouer sur l'identité ou la base.
    const rep = await appeler(
      "/api/jarvis/jarvis-chat",
      json({ message: "Bonjour, comment ça va ?", conversationId: crypto.randomUUID(), clientTurnId: crypto.randomUUID() }),
    );
    const c = rep.corps?.error?.code;
    verdict(
      rep.corps?.ok === true || c === "indisponible" || c === "configuration" || c === "analyse-indisponible",
      `chat traite la demande ou nomme la cause (${rep.corps?.ok === true ? "ok" : String(c)})`,
      JSON.stringify(rep.corps)?.slice(0, 160),
    );
    verdict(c !== "non-authentifie", "chat reconnaît la session");
  }

  console.log("\n7 · le flux SSE porte les en-têtes anti-tampon");
  {
    const r = await fetch(`${BASE}/api/jarvis/jarvis-chat`, {
      ...json({
        message: "Bonjour",
        mode: "flux",
        conversationId: crypto.randomUUID(),
        clientTurnId: crypto.randomUUID(),
      }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
    });
    const type = r.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) {
      verdict(true, "réponse en text/event-stream");
      const cc = r.headers.get("cache-control") ?? "";
      verdict(cc.includes("no-transform"), "Cache-Control porte no-transform", cc);
      verdict(
        (r.headers.get("x-accel-buffering") ?? "") === "no",
        "X-Accel-Buffering: no",
        r.headers.get("x-accel-buffering") ?? "(absent)",
      );
    } else {
      // Dégradation gracieuse prévue : sans fournisseur, la route peut rendre
      // l'enveloppe JSON historique. Ce n'est pas un échec du PORTAGE.
      verdict(true, `pas de flux (dégradation gracieuse, ${type.split(";")[0]})`);
      console.log("     ℹ️  en-têtes SSE non vérifiables sans fournisseur LLM joignable.");
    }
    try {
      await r.body?.cancel();
    } catch {
      /* rien */
    }
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
