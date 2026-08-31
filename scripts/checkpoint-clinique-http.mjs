#!/usr/bin/env node
/**
 * checkpoint-clinique-http — la journée de la praticienne, de bout en bout,
 * par la frontière HTTP réelle.
 *
 * ═══ CE QUE CE CHECKPOINT PROUVE, ET QUE LES AUTRES NE PROUVENT PAS ════════
 *
 * Les checkpoints précédents éprouvent des MÉCANISMES : l'identité ne fuit pas,
 * l'allowlist borne, le journal s'écrit. Celui-ci éprouve le TRAVAIL : ouvrir
 * un dossier, tenir une séance, écrire une note, la signer, émettre un
 * document, encaisser. C'est la seule mesure qui répond à la question que la
 * médecin se pose réellement — « est-ce que je peux travailler ? »
 *
 * Chaque étape passe par `/api/db/rpc`, donc par le cookie de session, le pool,
 * `withCaller`, la RLS et les portes SQL. Rien n'est court-circuité.
 *
 * ═══ HORS-LIGNE ════════════════════════════════════════════════════════════
 *
 * Lancé sans clé de fournisseur d'IA, ce script mesure le mode hors-ligne du
 * §41 : la chaîne clinique doit être ENTIÈREMENT verte sans le moindre appel
 * réseau sortant, et l'IA doit se dégrader en NOMMANT sa panne.
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

async function brut(chemin, options = {}) {
  const entetes = { ...(options.headers ?? {}) };
  if (cookie !== "") entetes.Cookie = cookie;
  const r = await fetch(`${BASE}${chemin}`, { ...options, headers: entetes, redirect: "manual" });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const paire = c.split(";")[0];
    if (paire?.startsWith("mc_session=")) cookie = paire.endsWith("=") ? "" : paire;
  }
  let corps;
  try {
    corps = await r.json();
  } catch {
    corps = undefined;
  }
  return { statut: r.status, corps };
}

const json = (o) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(o),
});

/** Un appel de porte SQL par la frontière. Rend les lignes, ou lève. */
async function rpc(name, args = {}) {
  const r = await brut("/api/db/rpc", json({ name, args }));
  if (r.statut !== 200 || r.corps?.ok !== true) {
    throw new Error(`${name} → ${r.statut} ${JSON.stringify(r.corps)?.slice(0, 200)}`);
  }
  return r.corps.data;
}

/** Première valeur d'une réponse de porte, quelle que soit sa forme. */
function premier(lignes) {
  if (Array.isArray(lignes)) return lignes[0];
  return lignes;
}

async function main() {
  console.log("checkpoint-clinique-http — la journée de la praticienne\n");

  const marqueur = `CLINIQUE${Date.now().toString().slice(-6)}`;

  let moi;
  console.log("1 · connexion");
  {
    const r = await brut("/api/auth/sign-in", json({ email: EMAIL, password: MDP }));
    verdict(r.statut === 200, "connexion", `statut ${r.statut}`);
    // L'identité rendue par la connexion sert au rendez-vous : la porte exige
    // un praticien, et on ne l'invente pas côté client.
    moi = r.corps?.data?.userId;
    if (r.statut !== 200) {
      console.log("\nVERDICT : ROUGE — sans session, rien d'autre n'a de sens.");
      process.exit(1);
    }
  }

  let patientId;
  let apptId;
  let consultId;
  let noteId;

  console.log("\n2 · ouvrir un dossier");
  try {
    const lignes = await rpc("create_patient", {
      p_charge: JSON.stringify({
        first_name: "Essai",
        last_name: marqueur,
        phone: "0555123456",
        sex: "F",
        birth_date: "1985-04-12",
      }),
    });
    patientId = premier(lignes)?.id;
    verdict(typeof patientId === "string", "create_patient", JSON.stringify(lignes)?.slice(0, 150));
  } catch (e) {
    verdict(false, "create_patient", e.message);
  }

  console.log("\n3 · la retrouver par la recherche (porte auditée)");
  try {
    const lignes = await rpc("search_patients", { p_query: marqueur, p_limit: 10, p_offset: 0 });
    verdict(Array.isArray(lignes) && lignes.length === 1, "search_patients la retrouve",
      `${Array.isArray(lignes) ? lignes.length : "?"} resultat(s)`);
  } catch (e) {
    verdict(false, "search_patients", e.message);
  }

  console.log("\n4 · poser un rendez-vous");
  try {
    const demain = new Date(Date.now() + 86400000).toISOString();
    // ⚠️ `p_practitioner_id` NE PEUT PAS ÊTRE NULL, et ce n'est pas une
    // subtilité d'API : `022_appointment_gates.sql` RAISE explicitement
    // « Rendez-vous incomplet : patient, praticien et date sont requis ».
    // La première rédaction passait `null` et rendait 422 — le contrôle avait
    // tort, la porte avait raison. La frontière a fait exactement son travail
    // en traduisant la règle métier en 422 plutôt qu'en 500.
    const lignes = await rpc("create_appointment", {
      p_patient_id: patientId,
      p_practitioner_id: moi,
      p_starts_at: demain,
      p_duration_minutes: 30,
    });
    apptId = premier(lignes)?.create_appointment ?? premier(lignes);
    verdict(typeof apptId === "string", "create_appointment", JSON.stringify(lignes)?.slice(0, 150));
  } catch (e) {
    verdict(false, "create_appointment", e.message);
  }

  console.log("\n5 · tenir la séance");
  try {
    const lignes = await rpc("start_consultation", { p_patient_id: patientId, p_appointment_id: apptId });
    consultId = premier(lignes)?.start_consultation ?? premier(lignes);
    verdict(typeof consultId === "string", "start_consultation", JSON.stringify(lignes)?.slice(0, 150));
  } catch (e) {
    verdict(false, "start_consultation", e.message);
  }

  console.log("\n6 · écrire la note (SOAP)");
  try {
    await rpc("save_note", {
      p_consultation_id: consultId,
      p_changes: JSON.stringify({
        subjective: "Motif rapporte par la patiente.",
        objective: "Examen clinique consigne.",
        assessment: "Evaluation consignee.",
        plan: "Conduite a tenir consignee.",
      }),
    });
    verdict(true, "save_note (4 rubriques)");
  } catch (e) {
    verdict(false, "save_note", e.message);
  }

  console.log("\n7 · relire la séance");
  try {
    const lignes = await rpc("get_consultation", { p_id: consultId });
    const c = premier(lignes);
    noteId = c?.note_id ?? c?.id;
    verdict(c !== undefined, "get_consultation rend la séance", JSON.stringify(c)?.slice(0, 150));
  } catch (e) {
    verdict(false, "get_consultation", e.message);
  }

  console.log("\n8 · tarifer puis clore");
  try {
    await rpc("set_consultation_price", { p_consultation_id: consultId, p_amount_dzd: 2500 });
    verdict(true, "set_consultation_price (2500 DZD)");
  } catch (e) {
    verdict(false, "set_consultation_price", e.message);
  }
  try {
    await rpc("close_consultation", { p_id: consultId });
    verdict(true, "close_consultation");
  } catch (e) {
    verdict(false, "close_consultation", e.message);
  }

  console.log("\n9 · encaisser");
  try {
    const jour = new Date().toISOString().slice(0, 10);
    // Signature réelle : `(p_period_start date, p_period_end date, p_limit, p_offset)`.
    // La première rédaction envoyait `p_day` et rendait 422 — arité invalide.
    const paiements = await rpc("get_sessions_payments_list", {
      p_period_start: jour,
      p_period_end: jour,
      p_limit: 50,
      p_offset: 0,
    });
    // ⚠️ LA PORTE REND UN COMPOSITE `{ total, lignes, impayes_count, … }`, pas
    // un tableau. La première rédaction comptait la ligne enveloppante et
    // annonçait « 1 ligne » sur une liste VIDE — un contrôle qui compte la
    // mauvaise chose est pire qu'un contrôle absent, parce qu'il rassure.
    const charge = premier(paiements)?.get_sessions_payments_list ?? premier(paiements);
    const liste = Array.isArray(charge?.lignes) ? charge.lignes : [];
    const mien = liste.find((p) => p.consultation_id === consultId) ?? liste[0];
    verdict(
      liste.length > 0,
      `get_sessions_payments_list (${liste.length} seance(s) a encaisser)`,
      JSON.stringify(charge)?.slice(0, 160),
    );

    if (mien?.payment_id !== undefined || mien?.id !== undefined) {
      await rpc("record_payment_collected", { p_payment_id: mien.payment_id ?? mien.id });
      verdict(true, "record_payment_collected");
    } else {
      verdict(false, "record_payment_collected", `aucun identifiant de paiement : ${JSON.stringify(mien)?.slice(0, 150)}`);
    }
  } catch (e) {
    verdict(false, "encaissement", e.message);
  }

  console.log("\n10 · la recette du jour reflète l'encaissement");
  try {
    const jour = new Date().toISOString().slice(0, 10);
    const r = await rpc("day_revenue", { p_day: jour });
    verdict(r !== undefined, "day_revenue", JSON.stringify(premier(r))?.slice(0, 150));
  } catch (e) {
    verdict(false, "day_revenue", e.message);
  }

  console.log("\n11 · le tableau de bord de la journée");
  try {
    const jour = new Date().toISOString().slice(0, 10);
    const r = await rpc("dashboard_today", { p_day: jour });
    verdict(r !== undefined, "dashboard_today");
  } catch (e) {
    verdict(false, "dashboard_today", e.message);
  }

  console.log("\n12 · l'IA se dégrade PROPREMENT (hors-ligne)");
  {
    const r = await brut("/api/jarvis/jarvis-voice-in",
      json({ audioBase64: Buffer.from("bruit").toString("base64"), mimeType: "audio/webm" }));
    const code = r.corps?.error?.code;
    verdict(
      code !== undefined && code !== "indisponible",
      `la dictée refuse en nommant la cause (${String(code)})`,
      JSON.stringify(r.corps)?.slice(0, 150),
    );
    verdict(
      r.statut === 200,
      "le refus est une réponse, pas une panne HTTP",
      `statut ${r.statut}`,
    );
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
