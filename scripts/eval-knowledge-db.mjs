/**
 * eval-knowledge-db — LA PASSE PORTES REELLES M07 (lecture seule, 0 ecriture).
 *
 * ═══ CE QUE CETTE PASSE PROUVE ═══
 * Le VRAI service `rechercherConnaissance` contre les VRAIES portes 092/093
 * (base gouvernee) sur les 46 cas du golden PROD
 * (`tests/eval/knowledge.golden.prod-2026-09-15.json`, sources reelles) :
 * issue, identite de preuve (source+section), top-1, citation, version,
 * absences interdites, gouvernance (provenance complete), determinisme.
 * Mode hybride (BGE-M3 local) si le dossier modele est prouve ; sinon
 * lexical seul, le vectoriel etant declare NOT RUN avec motif (jamais
 * simule en silence).
 *
 * ═══ CE QU'ELLE NE PROUVE PAS ═══
 * Ni le cross-encoder en prod (M13, >p95 — heuristique par defaut), ni le
 * cablage Jarvis (M07 slice 2), ni la qualite live d'un modele (aucun LLM
 * ici : retrieval seul, deterministe).
 *
 *   node scripts/eval-knowledge-db.mjs [--db <nom-base>] [--vecteur] [--dossier <modeles>]
 * Mode DEFAUT : lexical seul (configuration cablee en production, M07
 * slice 2). `--vecteur` tente l'hybride BGE-M3 local (coherence-gatee) :
 * mesure instrumentee, pas porte de production.
 * LECTURE SEULE (adaptateur DbPort : SELECT sur les portes 092, rien
 * d'autre ; aucun INSERT/UPDATE/DELETE dans ce fichier).
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
const GOLDEN = join(RACINE, "tests", "eval", "knowledge.golden.prod-2026-09-15.json");

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const base = option("--db") ?? "mindcare";

// Calibration mesuree (M07 slice 3) : `--calib <nom>` ne change JAMAIS les
// seuils ni le golden — seule la forme du score heuristique varie.
// Absent = CALIBRATION_COURANTE (comportement cable). Valeurs miroir de
// `sonde-fusion-caracterisation.mjs` (ne pas diverger sans raison).
const CALIBS = {
  courant: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 0 },
  A1: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1 },
  A2: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 2, exposantVecteur: 2 },
  A3: { poidsCouverture: 0.55, poidsVecteur: 0.45, exposantCouverture: 1, exposantVecteur: 1, porteMajorite: true },
  A4: { poidsCouverture: 0.55, poidsVecteur: 0, exposantCouverture: 1, exposantVecteur: 0 },
};
const nomCalib = option("--calib") ?? "courant";
const calibDemandee = CALIBS[nomCalib];
if (calibDemandee === undefined) {
  console.log(`  ROUGE | calib | inconnue : ${nomCalib} (attendues : ${Object.keys(CALIBS).join(",")})`);
  process.exit(1);
}
// A3 est transparente en mode lexical (candidats corroborés : porte
// exempte, γ=1, sim nulle → identique à l'historique). A2 ne l'est pas
// (γ=2) : ne comparer A2 qu'en `--vecteur`, jamais au lexical câblé.

/** Chargeur env minimal (meme semantique que verifier-base.mjs : reel prime, jamais journalise). */
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

let verts = 0;
let rouges = 0;
const detailsRouges = [];
function verdict(ok, ligne, detail = "") {
  if (ok) verts += 1;
  else {
    rouges += 1;
    detailsRouges.push(`${ligne} :: ${detail}`);
  }
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${ligne}${detail === "" ? "" : ` | ${detail}`}`);
}

chargerEnv();
const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ??
  process.env.MINDCARE_TEST_DATABASE_URL ??
  process.env.MINDCARE_DATABASE_URL ??
  "";
if (url.trim() === "") {
  console.log("  ROUGE | connexion | aucune URL MINDCARE_* disponible (lecture seule exigee)");
  console.log("\nVERDICT KNOWLEDGE-DB : ROUGE — connexion impossible");
  process.exit(1);
}
function baseCible(u, nom) {
  const m = u.match(/^(\w+:\/\/[^/]+\/)([^?]*)(.*)$/);
  if (!m) return null;
  return `${m[1]}${nom}${m[3]}`;
}
const urlCible = baseCible(url, base);
if (urlCible === null) {
  console.log("  ROUGE | connexion | URL illisible");
  process.exit(1);
}

const { local, embeddings, service, db } = await compilerConnaissance(
  RACINE,
  "eval-knowledge-db",
  "src/services/connaissance-recherche.ts",
);

// Vecteur local seulement sur demande explicite (`--vecteur`) : le mode
// DEFAUT est lexical seul, qui est la configuration cablee en production
// (slice 2 : surete d'abord — les ecarts lexicaux echouent vers le
// silence, jamais vers l'hallucination). L'hybride reste une mesure
// instrumentee (trouvailles documentees), pas la porte de production.
// Deux proprietes distinctes, toutes deux rapportees quand `--vecteur` :
// - parite-tokens : le tokenizer courant == le vecteur epingle (recette) ;
// - coherence-stack : la pile locale retrouve les ancres gold sur les
//   embeddings reels (pas de derive corpus) — decide hybride vs lexical.
const VEUT_VECTEUR = args.includes("--vecteur");
let vecteurRequete = async () => null;
let modeVecteur = "lexical-seul (configuration cablee ; vectoriel NOT RUN sans --vecteur)";
let pariteOk = false;
if (!VEUT_VECTEUR) {
  console.log(`  vert  | mode-vecteur | ${modeVecteur}`);
  verts += 1;
} else {
try {
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
  try {
    verifierPariteTokens(local, prete.tokenizer, "sertraline 50 mg");
    pariteOk = true;
  } catch (e) {
    console.log(`  ROUGE | parite-tokens | pin evente : ${String(e?.message ?? e).slice(0, 160)}`);
    rouges += 1;
  }
  const inference = local.inferenceDepuisSession({ Tensor: ort.Tensor }, prete.session, prete.tokenizer);
  const fournisseur = new embeddings.FournisseurLocalOnnx(config, inference);
  vecteurRequete = local.vecteurRequeteDepuisFournisseur(fournisseur);
  modeVecteur = "hybride-candidat";
} catch (e) {
  console.log(`  vert  | mode-vecteur | lexical-seul (modele local non prouve : vectoriel NOT RUN) : ${String(e?.message ?? e).slice(0, 120)}`);
  verts += 1;
}
}

// ── adaptateur DbPort lecture seule : les portes 092/093, rien d'autre ──────
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: urlCible });
try {
  await client.connect();
  // Posture applicative exacte (withCaller) : les portes 092 sont
  // EXECUTE-TO-authenticated ; sans JWT (C4 gouverne, sans perimetre
  // utilisateur), l'identite reste absente — prouve par les cas.
  await client.query("SET ROLE authenticated");
} catch (err) {
  console.log(`  ROUGE | connexion | ${String(err.message ?? err).slice(0, 200)}`);
  console.log("\nVERDICT KNOWLEDGE-DB : ROUGE — base injoignable");
  process.exit(1);
}
const inattendu = () => {
  throw new Error("porte factice : methode non implantee (lecture seule)");
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

const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
const cas = golden.cas ?? [];

// Coherence stack : la pile locale doit retrouver, pour des cas pertinents
// du golden lui-meme, la source gold sur les embeddings reels (pas de
// derive corpus). Les ancres viennent du golden (pas d'UUID en dur :
// le scan PII les refuserait, et elles y resteraient synchronisees).
// Decide hybride vs lexical.
const ancres = cas.filter((c) => c.gold !== null && c.gold !== undefined && c.issue === "pertinent").slice(0, 2);
if (modeVecteur === "hybride-candidat") {
  let coherent = ancres.length > 0;
  for (const ancre of ancres) {
    try {
      const v = await vecteurRequete(ancre.requete);
      if (v === null) {
        coherent = false;
        break;
      }
      const r = await client.query("SELECT source_id FROM app.knowledge_chunks ORDER BY embedding OPERATOR(public.<=>) $1::public.vector LIMIT 1", [
        JSON.stringify([...v]),
      ]);
      if ((r.rows[0]?.source_id ?? null) !== ancre.gold.source) coherent = false;
    } catch {
      coherent = false;
    }
  }
  if (coherent) {
    modeVecteur = `hybride (BGE-M3 local, coherence prouvee, parite ${pariteOk ? "OK" : "EVENTEE-pin-a-revoir"})`;
    console.log(`  vert  | coherence-stack | ancres catalogue retrouvees | ${modeVecteur}`);
    verts += 1;
  } else {
    vecteurRequete = async () => null;
    modeVecteur = "lexical-seul (coherence-stack non prouvee : vectoriel NOT RUN)";
    console.log(`  ROUGE | coherence-stack | ancres non retrouvees — repli lexical honnete`);
    rouges += 1;
  }
}
console.log(`  vert  | mode | ${modeVecteur} | base=${base} | cas=${cas.length} | calib=${nomCalib}`);
verts += 1;

for (const c of cas) {
  let r;
  try {
    r = await service.rechercherConnaissance(c.requete, c.langue, { vecteurRequete, calibration: calibDemandee });
  } catch (e) {
    verdict(false, `${c.id} le service ne leve jamais`, String(e?.message ?? e).slice(0, 120));
    continue;
  }
  if (!r.ok) {
    verdict(false, `${c.id} service ok`, r.error.message);
    continue;
  }
  const obtenu = r.data;
  const top5 = obtenu.evidences.slice(0, 5);
  const top1 = top5[0] ?? null;
  verdict(obtenu.issue === c.issue, `${c.id} issue`, `attendu=${c.issue} obtenu=${obtenu.issue}`);
  if (c.gold !== null && c.gold !== undefined) {
    const trouve = top5.some((e) => e.sourceId === c.gold.source && (e.section ?? null) === c.gold.section);
    verdict(trouve, `${c.id}-gold`, trouve ? `${c.gold.source}@${c.gold.section}` : `absent du top-5 (top1=${top1 === null ? "aucun" : `${top1.sourceId}@${top1.section ?? "?"}`})`);
    if (c.issue === "pertinent") {
      const auteur = ["acceptable", "gold"];
      const licite = top1 !== null && (top1.sourceId === c.gold.source || (c.acceptable ?? []).includes(top1.sourceId));
      verdict(licite, `${c.id}-top1`, licite ? `${top1.sourceId}` : `inattendu=${top1 === null ? "aucun" : top1.sourceId} ${auteur}`);
    }
    if (c.citation_contient !== null && c.citation_contient !== undefined) {
      const present = top1 !== null && (top1.texte ?? "").includes(c.citation_contient);
      verdict(present, `${c.id}-cit`, present ? "fait present au top-1" : `fait ABSENT du top-1 (${c.citation_contient})`);
    }
    if (c.expected_version !== null && c.expected_version !== undefined) {
      const version = top5.find((e) => e.sourceId === c.gold.source)?.sourceVersion ?? null;
      verdict(version === c.expected_version, `${c.id}-ver`, `attendu=${c.expected_version} obtenu=${version}`);
    }
  }
  for (const interdit of c.forbidden ?? []) {
    const fautive = top5.filter((e) => e.sourceId === interdit);
    verdict(fautive.length === 0, `${c.id}-forbid`, fautive.length === 0 ? "aucune" : `FUITE: ${interdit}`);
  }
  const incompletes = top5.filter((e) => !e.chunkId || !e.sourceId || !e.sourceVersion);
  verdict(incompletes.length === 0, `${c.id}-prov`, incompletes.length === 0 ? "provenance complete" : "provenance incomplete");
}

// Determinisme : meme requete rejouee = meme ordre a l'octet.
const tete = cas.find((c) => c.issue === "pertinent") ?? cas[0];
const rejouer = async () => service.rechercherConnaissance(tete.requete, tete.langue, { vecteurRequete, calibration: calibDemandee });
const p1 = await rejouer();
const p2 = await rejouer();
const ordre = (p) => (p.ok ? p.data.evidences.map((e) => e.chunkId).join(",") : "ERREUR");
const deterministe = ordre(p1) === ordre(p2) && ordre(p1) !== "ERREUR" && ordre(p1) !== "";
verdict(deterministe, "determinisme-rerun", deterministe ? "octet-identique" : "DIVERGENT");

await client.end();
console.log(`\n${verts} verts, ${rouges} ROUGE`);
console.log(rouges === 0 ? "VERDICT KNOWLEDGE-DB : VERT" : `VERDICT KNOWLEDGE-DB : ROUGE — ${rouges} controle(s)`);
if (detailsRouges.length > 0) {
  console.log("— details —");
  for (const d of detailsRouges.slice(0, 20)) console.log(`  ROUGE | ${d}`);
}
process.exit(rouges === 0 ? 0 : 1);
