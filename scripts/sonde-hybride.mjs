/**
 * sonde-hybride — PREUVES R3-D + R3-E (M07) sur base gouvernée réelle.
 *
 * Chaîne VRAIE de bout en bout : texte → BGE-M3 local → portes pgvector +
 * lexicale (SQL 092) → fusion → rerank heuristique → qualification.
 *
 *   node scripts/sonde-hybride.mjs [--db <nom-base>] [--dossier <modeles>]
 *
 * LECTURE SEULE (l'adaptateur DbPort n'émet que des SELECT sur les portes ;
 * le script ne contient aucun INSERT/UPDATE/DELETE). L'activation éventuelle
 * d'une source est un acte opérateur SQL SÉPARÉ, jamais ici.
 * Sortie : une ligne JSON + exit code.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chargerBinaireNatif,
  compilerConnaissance,
  resoudreDossierProuve,
  verifierPariteTokens,
} from "./embeddings-runtime.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const base = option("--db") ?? "m07r3b";

/** Chargeur env minimal (même sémantique que verifier-base.mjs : réel prime, jamais journalisé). */
function chargerEnv() {
  for (const nom of [".env.local", ".env"]) {
    let texte;
    try {
      texte = readFileSync(join(RACINE, nom), "utf8");
    } catch {
      continue;
    }
    for (const ligne of texte.split("\n")) {
      const nette = ligne.trim().replace(/\r$/, "");
      if (nette === "" || nette.startsWith("#")) continue;
      const egal = nette.indexOf("=");
      if (egal <= 0) continue;
      const cle = nette.slice(0, egal).trim();
      if (process.env[cle] !== undefined) continue;
      let valeur = nette.slice(egal + 1).trim();
      if (
        (valeur.startsWith('"') && valeur.endsWith('"')) ||
        (valeur.startsWith("'") && valeur.endsWith("'"))
      ) {
        valeur = valeur.slice(1, -1);
      }
      process.env[cle] = valeur;
    }
  }
}

function echouer(etapeNom, detail) {
  console.log(JSON.stringify({ ok: false, etape: etapeNom, detail }));
  process.exit(1);
}

chargerEnv();
const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ??
  process.env.MINDCARE_TEST_DATABASE_URL ??
  process.env.MINDCARE_DATABASE_URL ??
  "";
if (url.trim() === "") {
  echouer("connexion", "aucune URL MINDCARE_* disponible (lecture seule exigée).");
}
// Force la base cible sans toucher au reste de l'URL (hôte/port/rôle).
function baseCible(u, nom) {
  const m = u.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
  if (!m) return null;
  return `${m[1]}${nom}${m[3]}`;
}
const urlCible = baseCible(url, base);
if (urlCible === null) {
  echouer("connexion", "URL illisible.");
}

const { local, embeddings, service, db } = await compilerConnaissance(
  RACINE,
  "sonde-hybride",
  "src/services/connaissance-recherche.ts",
);
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
const config = local.configLocaleDepuisRecette(recette);
const dossier = resoudreDossierProuve(
  local,
  recette,
  RACINE,
  option("--dossier") ?? process.env["MINDCARE_BGE_M3_DIR"] ?? "",
);
const { createReadStream } = await import("node:fs");
await local.verifierEmpreintesParFlux(dossier, local.extraireEmpreintes(recette), (p) =>
  createReadStream(p),
);
const { ort, Tokenizer } = await chargerBinaireNatif();
const prete = await local.chargerSessionLocale(
  dossier,
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
verifierPariteTokens(local, prete.tokenizer, "Quelle est la posologie de la sertraline en premiere intention ?");
const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
const vecteurRequete = local.vecteurRequeteDepuisFournisseur(fournisseur);

// ── adaptateur DbPort lecture seule : les portes 092, rien d'autre ──────────
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
try {
  await client.connect();
} catch (err) {
  echouer("connexion", String(err.message ?? err).slice(0, 200));
}
const inattendu = () => {
  throw new Error("porte factice : méthode non implantée (lecture seule)");
};
db.setDbPort({
  select: inattendu,
  rpc: async (nom, params) => {
    try {
      if (nom === "search_knowledge_lexical") {
        const r = await client.query("SELECT * FROM app.search_knowledge_lexical($1,$2,$3)", [
          params.p_requete,
          params.p_langue,
          params.p_limite,
        ]);
        return { ok: true, data: r.rows };
      }
      if (nom === "search_knowledge_vector") {
        const r = await client.query("SELECT * FROM app.search_knowledge_vector($1,$2)", [
          params.p_embedding_json,
          params.p_limite,
        ]);
        return { ok: true, data: r.rows };
      }
      return { ok: false, error: { code: "introuvable", message: `porte inconnue : ${nom}` } };
    } catch (err) {
      return { ok: false, error: { code: "indisponible", message: String(err.message ?? err).slice(0, 200) } };
    }
  },
  signIn: inattendu,
  signOut: inattendu,
  getSession: inattendu,
  getInstallationStatus: inattendu,
  provisionOwnerAccount: inattendu,
  invokeFunction: inattendu,
  invokeFunctionStream: inattendu,
});

const CAS = [
  {
    id: "sertraline",
    requete: "posologie initiale sertraline",
    attend: { pertinent: true, top_source: "SONDE-R3-GOUVERNEE" },
  },
  {
    id: "sevrage",
    requete: "sevrage progressif par paliers",
    attend: { pertinent: true, top_source: "SONDE-R3-GOUVERNEE" },
  },
  // Hors-sujet / révoqué : la porte vectorielle rend TOUJOURS un plus proche
  // voisin — l'invariant n'est donc pas "aucune" mais "jamais pertinent"
  // (anti-hallucination) + zéro fuite de la source révoquée.
  {
    id: "revoque",
    requete: "protocole retire ne pas utiliser",
    attend: { pertinent: false, top_source: null },
  },
  {
    id: "hors-sujet",
    requete: "recette de couscous aux legumes xyzzy",
    attend: { pertinent: false, top_source: null },
  },
];

const preuves = [];
for (const cas of CAS) {
  const hybride = await service.rechercherConnaissance(cas.requete, "fr", { vecteurRequete });
  const lexical = await service.rechercherConnaissance(cas.requete, "fr", {
    vecteurRequete: async () => null,
  });
  if (!hybride.ok) {
    echouer(`cas-${cas.id}`, `hybride indisponible : ${hybride.error.message}`);
  }
  if (!lexical.ok) {
    echouer(`cas-${cas.id}`, `lexical indisponible : ${lexical.error.message}`);
  }
  const top = hybride.data.evidences[0] ?? null;
  const verdict = cas.attend.pertinent
    ? hybride.data.issue === "pertinent" &&
      top !== null &&
      top.sourceTitre === cas.attend.top_source
    : hybride.data.issue !== "pertinent";
  // Gouvernance : aucune source révoquée/non-active dans les deux modes.
  const fuite = [...hybride.data.evidences, ...lexical.data.evidences].filter(
    (e) => e.sourceTitre === "SONDE-R3-REVOQUEE",
  );
  preuves.push({
    id: cas.id,
    issue_hybride: hybride.data.issue,
    issue_lexical: lexical.data.issue,
    top_hybride: top === null ? null : `${top.sourceTitre}::${top.section ?? "?"}::${top.chunkId}`,
    evidences: hybride.data.evidences.length,
    fuite_revoquee: fuite.length,
    verdict: verdict && fuite.length === 0 ? "vert" : "ROUGE",
  });
}

// Déterminisme : même requête rejouée = même ordre à l'octet.
const rejouer = async () =>
  service.rechercherConnaissance(CAS[0].requete, "fr", { vecteurRequete });
const p1 = await rejouer();
const p2 = await rejouer();
const ordre1 = p1.ok ? p1.data.evidences.map((e) => e.chunkId).join(",") : "ERREUR";
const ordre2 = p2.ok ? p2.data.evidences.map((e) => e.chunkId).join(",") : "ERREUR";
const deterministe = ordre1 === ordre2 && ordre1 !== "ERREUR" && ordre1 !== "";

await client.end();
const rouges = preuves.filter((p) => p.verdict !== "vert").length + (deterministe ? 0 : 1);
console.log(
  JSON.stringify({
    ok: rouges === 0,
    etape: rouges === 0 ? "hybride-prouve" : "ecart-hybride",
    base,
    cas: preuves,
    determinisme_rerun: deterministe ? "octet-identique" : "DIVERGENT",
    ordre_top1: ordre1.split(",")[0] ?? null,
  }),
);
process.exit(rouges === 0 ? 0 : 1);
