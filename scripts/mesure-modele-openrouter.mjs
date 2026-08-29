#!/usr/bin/env node
/**
 * mesure-modele-openrouter.mjs — V-JARVIS-CORE §12.
 * Vérifie DYNAMIQUEMENT le modèle cible avant tout déploiement : existence du
 * slug exact, gratuité, support du streaming, taille de contexte, capacités.
 *
 *   node scripts/mesure-modele-openrouter.mjs [slug]
 *
 * Endpoint public (`/api/v1/models`) : aucune clé, aucun secret imprimé.
 * AUCUNE substitution silencieuse : si le slug visé manque, l'instrument
 * liste la famille `nemotron` et rend ROUGE — la décision reste humaine.
 */
import { lireDatabaseUrl } from "./lib/dburl.mjs";

const SLAGE_VISE = process.argv[2] ?? "nvidia/nemotron-3.5-lightning:free";
const URL_MODELES = "https://openrouter.ai/api/v1/models";

let verts = 0, rouges = 0;
const controle = (label, cond, detail = "") => {
  const v = cond === true;
  cond ? verts++ : rouges++;
  console.log(`${v ? "vert  " : "ROUGE"} | ${label}${detail ? ` | ${detail}` : ""}`);
};

const reponse = await fetch(URL_MODELES, { headers: { Accept: "application/json" } });
controle("registre OpenRouter joignable", reponse.ok, `HTTP ${reponse.status}`);
if (!reponse.ok) { console.log("VERDICT : ROUGE"); process.exit(1); }

const { data } = await reponse.json();
controle("registre non vide", Array.isArray(data) && data.length > 0, `${data?.length ?? 0} modèles`);

const vise = data.find((m) => m.id === SLAGE_VISE);
if (!vise) {
  controle(`slug exact « ${SLAGE_VISE} » présent`, false);
  const famille = data
    .filter((m) => m.id.toLowerCase().includes("nemotron"))
    .map((m) => `${m.id} [ctx=${m.context_length}, gratuit=${String(m.pricing?.prompt === "0" && m.pricing?.completion === "0")}]`);
  console.log("--- candidats famille nemotron ---");
  for (const f of famille) console.log("  ·", f);
  console.log("VERDICT : ROUGE — slug absent, AUCUNE substitution automatique.");
  void lireDatabaseUrl; // import gardé pour cohérence des instruments ; inutilisé ici
  process.exit(1);
}

console.log(`--- ${SLAGE_VISE} ---`);
const gratuit = String(vise.pricing?.prompt) === "0" && String(vise.pricing?.completion) === "0";
controle("gratuit (pricing prompt+completion = 0)", gratuit,
  `${vise.pricing?.prompt}/${vise.pricing?.completion} USD/token`);
controle("contexte déclaré", typeof vise.context_length === "number" && vise.context_length >= 8_000,
  `context_length=${vise.context_length}`);
const params = new Set(vise.supported_parameters ?? []);
controle("streaming supporté", params.has("streaming"), [...params].join(","));
// Capacités NON requises cette session (couche d'actions gelée) — relevées,
// jamais exigées :
const info = {
  tools: params.has("tools"),
  structured: params.has("structured_outputs") || params.has("response_format"),
};
console.log(`info  | capacités relevées (non requises) | tools=${info.tools} structured=${info.structured}`);

console.log(`\nTOTAL : vert=${verts} rouge=${rouges}`);
console.log(rouges === 0 ? "VERDICT : VERT — modèle utilisable pour V-JARVIS-CORE." : "VERDICT : ROUGE");
process.exit(rouges === 0 ? 0 : 1);
