/**
 * sonde-embeddings-production — PREUVE R3-A (M07).
 *
 * Prouve que la recette épinglée tourne dans le runtime Node de production :
 * résolution d'artefact → SHA-256 → session ONNX CPU → tokenizer → parité de
 * tokens (témoin Rust R2) → embeddings 1024 L2-unitaires déterministes.
 *
 *   node scripts/sonde-embeddings-production.mjs [--dossier <chemin>] [--leger]
 *
 * `--leger` : compilation + résolution + SHA seulement (sans inférence).
 * AUCUNE écriture base (aucun import `pg`, aucune connexion). Sortie : une
 * ligne JSON `{"ok":true,...}` ou `{"ok":false,"etape":...}` + exit code.
 * La compilation vit sous `.eval-out/sonde-embeddings/` (git-ignoré, même
 * règle que les passes d'évaluation : reconstruit, jamais livré).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compilerConnaissance,
  resoudreDossierProuve,
  verifierPariteTokens,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECETTE_CHEMIN = join(RACINE, "knowledge", "recette-embedding-pinee.json");

const ECHANTILLONS = [
  "Quelle est la posologie de la sertraline en premiere intention ?",
  "La sertraline 50 mg est une option de premiere intention dans l'anxiete.",
  "La cloture comptable mensuelle du cabinet se fait le dernier ouvre du mois.",
];

function etape(nom, fn) {
  const t0 = performance.now();
  const resultat = fn();
  return { resultat, ms: performance.now() - t0, nom };
}

async function etapeAsync(nom, fn) {
  const t0 = performance.now();
  const resultat = await fn();
  return { resultat, ms: performance.now() - t0, nom };
}

function echouer(etapeNom, detail) {
  console.log(JSON.stringify({ ok: false, etape: etapeNom, detail }));
  process.exit(1);
}

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const leger = args.includes("--leger");

// ── 1 · compilation du sous-ensemble vivant (socle partagé) ─────────────────
let local;
let fabrique;
try {
  ({ local, embeddings: fabrique } = await compilerConnaissance(RACINE, "sonde-embeddings"));
} catch (err) {
  echouer("compilation", String(err.message ?? err).slice(0, 2000));
}

// ── 2 · recette + résolution ───────────────────────────────────────────────
let recette;
try {
  recette = JSON.parse(readFileSync(RECETTE_CHEMIN, "utf8"));
} catch {
  echouer("recette", "recette-embedding-pinee.json illisible");
}
let config;
try {
  config = local.configLocaleDepuisRecette(recette);
} catch (err) {
  echouer("recette", String(err.message ?? err).slice(0, 500));
}
// Ordre plan R3 : --dossier (opérateur explicite) → MINDCARE_BGE_M3_DIR →
// resources/models (futur bundle M13) → cache dev de la mesure R2.
// Un explicite inexistant = échec fermé (socle partagé), jamais de repli.
let dossierModele;
try {
  dossierModele = resoudreDossierProuve(
    local,
    recette,
    RACINE,
    option("--dossier") ?? process.env["MINDCARE_BGE_M3_DIR"] ?? "",
  );
} catch (err) {
  echouer("resolution", String(err.message ?? err).slice(0, 500));
}

// ── 3 · SHA-256 des 3 artefacts (par flux : 2,2 Go > limite Buffer) ─────────
const sha = await etapeAsync("sha256", async () => {
  let empreintes;
  try {
    empreintes = local.extraireEmpreintes(recette);
  } catch (err) {
    echouer("recette", String(err.message ?? err).slice(0, 500));
  }
  const { createReadStream } = await import("node:fs");
  try {
    await local.verifierEmpreintesParFlux(dossierModele, empreintes, (p) => createReadStream(p));
    return "ok";
  } catch (err) {
    echouer("sha256", String(err.message ?? err).slice(0, 500));
    return "ko";
  }
});
if (leger) {
  console.log(JSON.stringify({ ok: true, mode: "leger", dossier: dossierModele, sha_ms: Math.round(sha.ms) }));
  process.exit(0);
}

// ── 4 · dépendances natives + session + tokenizer réels ─────────────────────
// `await import` nu (même idiome que `charger-connaissance.mjs` pour `pg`) :
// `node:module` est interdit par le lint, et l'import dynamique garde le
// natif hors du graphe statique.
let ort;
let Tokenizer;
try {
  ort = await import("onnxruntime-node");
  ({ Tokenizer } = await import("@huggingface/tokenizers"));
} catch (err) {
  echouer("dependances", `onnxruntime-node/@huggingface/tokenizers injoignables : ${String(err.message ?? err).slice(0, 300)}`);
}
const chargement = await etapeAsync("chargement", async () => {
  try {
    return await local.chargerSessionLocale(
      dossierModele,
      (p) => readFileSync(p, "utf8"),
      (json, cfg) => new Tokenizer(json, cfg),
      {
        creerSession: (chemin, options) =>
          ort.InferenceSession.create(chemin, {
            intraOpNumThreads: options.intraOpNumThreads,
            executionProviders: ["cpu"],
          }),
      },
    );
  } catch (err) {
    echouer("chargement", String(err.message ?? err).slice(0, 1000));
    throw err;
  }
});
const prete = chargement.resultat;
if (
  prete.session.inputNames.length !== 2 ||
  prete.session.inputNames[0] !== "input_ids" ||
  prete.session.outputNames.includes("sentence_embedding") === false
) {
  echouer("graphe", `entrées/sorties inattendues : ${prete.session.inputNames.join(",")} / ${prete.session.outputNames.join(",")}`);
}

// ── 5 · parité tokens (témoin Rust, socle partagé) ───────────────────────────
const parite = etape("parite-tokens", () => {
  try {
    verifierPariteTokens(local, prete.tokenizer, ECHANTILLONS[0]);
    return "témoin-Rust-FR ok";
  } catch (err) {
    echouer("parite-tokens", String(err.message ?? err).slice(0, 500));
    return "ko";
  }
});

// ── 6 · embeddings : dims, norme, sens, déterminisme ───────────────────────
const inference = local.inferenceDepuisSession(
  { Tensor: ort.Tensor },
  prete.session,
  prete.tokenizer,
);
const fournisseur = new fabrique.FournisseurLocalOnnx(config, inference);
const mesure = await etapeAsync("inference", async () => {
  const r1 = await fournisseur.embed([...ECHANTILLONS]);
  if (!r1.ok) echouer("inference", r1.error.message);
  const r2 = await fournisseur.embed([...ECHANTILLONS]);
  if (!r2.ok) echouer("inference", "second run indisponible");
  return { r1: r1.ok ? r1.vecteurs : [], r2: r2.ok ? r2.vecteurs : [] };
});
const vecteurs = mesure.resultat.r1;
if (vecteurs.length !== 3 || vecteurs.some((v) => v.length !== 1024)) {
  echouer("dimensions", `reçu=${vecteurs.length}x${vecteurs[0]?.length ?? 0} attendu=3x1024`);
}
const normes = vecteurs.map((v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)));
if (normes.some((n) => Math.abs(n - 1) > 1e-6)) {
  echouer("norme", `normes=${normes.map((n) => n.toFixed(6)).join(",")}`);
}
const cos = (a, b) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
const cosSim = cos(vecteurs[0] ?? [], vecteurs[1] ?? []);
const cosHors = cos(vecteurs[0] ?? [], vecteurs[2] ?? []);
if (!(cosSim > 0.5 && cosHors < 0.4 && cosSim > cosHors)) {
  echouer("sens", `cos_sim=${cosSim.toFixed(4)} cos_hors=${cosHors.toFixed(4)}`);
}
const h = (vs) =>
  createHash("sha256").update(Buffer.from(new Float32Array(vs.flat()).buffer)).digest("hex");
if (h(mesure.resultat.r1) !== h(mesure.resultat.r2)) {
  echouer("determinisme", "deux runs diffèrent à l'octet");
}

console.log(
  JSON.stringify({
    ok: true,
    dossier: dossierModele,
    graphe: { entrees: prete.session.inputNames, sorties: prete.session.outputNames },
    parite_tokens: parite.resultat,
    dims: "3x1024",
    normes: normes.map((n) => Number(n.toFixed(6))),
    cos_sim: Number(cosSim.toFixed(4)),
    cos_hors: Number(cosHors.toFixed(4)),
    determinisme: "octet-identique (2 runs)",
    perf: {
      sha_ms: Math.round(sha.ms),
      chargement_s: Number((chargement.ms / 1000).toFixed(2)),
      inference_3_ms: Math.round(mesure.ms),
      rss_Mo: Number((process.memoryUsage().rss / 1048576).toFixed(1)),
    },
  }),
);
