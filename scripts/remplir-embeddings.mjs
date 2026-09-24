#!/usr/bin/env node
/**
 * remplir-embeddings — M07 R3 · BACKFILL REPRENABLE des embeddings BGE-M3.
 *
 *   node scripts/remplir-embeddings.mjs --inventaire [--socket]
 *   node scripts/remplir-embeddings.mjs --ecrire [--limite N] [--dossier P] [--socket]
 * `--socket` = transport superuser local mc-p3 (docker exec + fichier),
 * sans URL admin ; preuve d'écriture par RETURNING (identité prouvée).
 * `--lots K` borne les lots (garde-fou : jamais de passe non bornée).
 *
 * Règles (plan R3 §4) : lots de 8 séquentiels, ordre `id` stable, UNE
 * instruction UPDATE par lot (tout ou rien), reprise = les lignes conformes
 * sont sautées par le prédicat (re-jouer est un no-op), arrêt SIGINT = fin de
 * lot puis sortie, 5 échecs de lot consécutifs = abandon. N'écrit JAMAIS
 * statut/sources/approbation (garde active=0 avant + après). Dérive découpeur
 * = saut journalisé (décision humaine, jamais ré-embedding aveugle).
 * AUCUNE activation, AUCUN secret journalisé, AUCUNE donnée patient (C4 seul).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compilerConnaissance,
  chargerBinaireNatif,
  resoudreDossierProuve,
  verifierPariteTokens,
} from "./embeddings-runtime.mjs";
import { execSocket, lignesSocket as lignesSocketTransport } from "./transport-socket.mjs";
import {
  CHUNKERS_ACCEPTES,
  decoderTexteB64,
  sqlEmpreinteActive,
  sqlGardeGlobaleActive,
  sqlGardeLotActif,
  sqlInventaire,
  sqlMiseAJourLotReturning,
  sqlSelectionLot,
  sqlSelectionLotBase64,
  sqlUniformiteRecette,
  validerIdChunk,
  verifierRetourLot,
} from "./remplir-embeddings-sql.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SORTIE = join(RACINE, "knowledge", ".sortie-remplissage.json");
const ECHECS_CONSECUTIFS_MAX = 5;

const args = process.argv.slice(2);
function option(nom) {
  const i = args.indexOf(nom);
  if (i < 0) return null;
  const valeur = args[i + 1];
  return valeur !== undefined && !valeur.startsWith("--") ? valeur : "";
}
const inventaireSeul = args.includes("--inventaire");
const ecrire = args.includes("--ecrire");
// R3-P2 : `--socket` = transport superuser local (docker exec + fichier),
// SANS URL admin (absente du .env — MINDCARE_DATABASE_URL seule, 42501 en
// écriture). Interpolation via `lierParams` (testée) + preuve par RETURNING
// (identité + cardinalité), jamais par confiance.
const viaSocket = args.includes("--socket");
// Garde-fou opérateur (incident P8 : flag `--lots` ignoré = passe NON BORNÉE
// tuée par timeout) : `--lots N` borne le nombre de lots, `--limite M` le
// nombre total d'embeddings. Les deux peuvent se combiner.
let maxLots = null;
{
  const i = args.indexOf("--lots");
  if (i >= 0) maxLots = Math.max(1, Number.parseInt(args[i + 1], 10) || 1);
}
const limiteBrute = option("--limite");
const limite = limiteBrute === null ? null : Math.max(0, Number.parseInt(limiteBrute, 10));

if (!inventaireSeul && !ecrire) {
  console.error("ROUGE — usage : --inventaire | --ecrire [--limite N] [--dossier P]. Rien n'a été fait.");
  process.exit(2);
}
if (limiteBrute !== null && (!Number.isInteger(limite) || limite <= 0)) {
  console.error("ROUGE — --limite exige un entier > 0.");
  process.exit(2);
}

function rouge(detail) {
  console.error(`ROUGE — ${detail} Rien n'a été activé.`);
  process.exit(1);
}

/** Chargeur env minimal (même sémantique que verifier-base.mjs : le réel prime, jamais journalisé). */
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

let interrompu = false;
process.on("SIGINT", () => {
  interrompu = true;
});

const rapport = {
  debut: new Date().toISOString(),
  lots: 0,
  ecrits: 0,
  sautes_decoupeur: 0,
  echecs: [],
  dernier_id: null,
  termine: false,
};
function ecrireRapport() {
  writeFileSync(SORTIE, JSON.stringify(rapport, null, 2) + "\n", "utf8");
}

const { local, embeddings } = await compilerConnaissance(RACINE, "remplissage-embeddings");
const recette = JSON.parse(readFileSync(join(RACINE, "knowledge", "recette-embedding-pinee.json"), "utf8"));
let config;
try {
  config = local.configLocaleDepuisRecette(recette);
} catch (err) {
  rouge(`recette dérivée : ${String(err.message ?? err).slice(0, 300)}`);
}
if (embeddings.validerConfigLocale(config).ok !== true) {
  rouge("recette locale invalide (validerConfigLocale).");
}
const RECETTE_SQL = {
  provider: "local-onnx",
  modele: config.modele,
  version: config.version,
  dimensions: config.dimensions,
  normalisation: config.normalisation,
  instruction_requete: config.instruction_requete,
  instruction_document: config.instruction_document,
  distance: config.distance,
  // Liste FERMÉE (décision humaine struct-v1.1) : jamais `config.versionChunk`
  // seul — sinon les enfants v1.1 seraient exclus et les R1 ré-embarqués.
  chunkers: [...CHUNKERS_ACCEPTES],
};

chargerEnv();

// ── transport : pg (défaut) ou socket superuser local (--socket) ────────────
// Module partagé `transport-socket.mjs` (fichier + ON_ERROR_STOP, nettoyage
// en finally). La preuve d'écriture vient de RETURNING, pas du shell.
function lignesSocket(requete) {
  return lignesSocketTransport(RACINE, requete);
}

const url =
  process.env.MINDCARE_ADMIN_DATABASE_URL ??
  process.env.MINDCARE_TEST_DATABASE_URL ??
  process.env.MINDCARE_DATABASE_URL ??
  "";
if (!viaSocket && url.trim() === "") {
  rouge("--ecrire/--inventaire exige MINDCARE_ADMIN_DATABASE_URL (ou TEST/DATABASE), ou --socket (superuser local mc-p3).");
}
const { default: pg } = viaSocket ? { default: null } : await import("pg");
const client = viaSocket ? null : new pg.Client({ connectionString: url });
try {
  if (!viaSocket) await client.connect();
} catch (err) {
  rouge(`connexion base impossible : ${String(err.message ?? err).slice(0, 200)}`);
}

async function uneLigne(sql) {
  if (viaSocket) {
    const lignes = lignesSocket(sql);
    const cols = (lignes[0] ?? "").split("|");
    if (cols.length === 1) return { n: Number.parseInt(cols[0], 10) };
    return {
      chunks: cols[0], sans_embedding: cols[1], sources: cols[2],
      sources_active: cols[3], ext_vector: cols[4], migration_092: cols[5],
    };
  }
  const r = await client.query(sql.texte, sql.params);
  return r.rows[0];
}

try {
  const inv = await uneLigne(sqlInventaire());
  console.log(
    `inventaire — chunks=${inv.chunks} sans_embedding=${inv.sans_embedding} sources=${inv.sources} sources_active=${inv.sources_active} ext_vector=${inv.ext_vector} migration_092=${inv.migration_092}`,
  );
  if ((inv.migration_092 ?? 0) < 1) rouge("migration 092 absente — STOP.");
  if ((inv.ext_vector ?? 0) < 1) rouge("extension pgvector absente — STOP.");
  if (inventaireSeul) {
    if (!viaSocket) await client.end();
    process.exit(0);
  }
  // Scoping R3 (décision humaine, ADR-039) : les sources `active` coexistent
  // avec le backfill — la sélection les exclut, chaque lot est gardé, et
  // l'empreinte (embeddings par source active) doit être IDENTIQUE avant et
  // après la passe. La garde historique `sources_active = 0` est remplacée.
  async function empreinteActive() {
    if (viaSocket) return lignesSocket(sqlEmpreinteActive()).join("\n");
    const r = await client.query(sqlEmpreinteActive().texte, []);
    return r.rows.map((x) => `${x.id}|${x.n}`).join("\n");
  }
  const empreinteAvant = await empreinteActive();
  console.log(`scoping — sources_active=${inv.sources_active} (intouchées, empreinte verrouillée)`);

  // ── modèle : résolution → SHA → session → témoin ──────────────────────────
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
  console.log(`modele — ${dossier} (témoin tokens ok)`);

  // ── boucle : sélection → embed → UPDATE mono-instruction ──────────────────
  let restants = limite;
  let echecsConsecutifs = 0;
  let epuise = false;
  const exclus = [];
  for (;;) {
    if (interrompu) {
      console.log("interrompu — lot courant validé, reprise au prochain run.");
      break;
    }
    if (maxLots !== null && rapport.lots >= maxLots) {
      console.log(`borne --lots ${maxLots} atteinte — reprise au prochain run.`);
      break;
    }
    if (restants !== null && restants <= 0) break;
    const tailleLecture = restants === null ? 8 : Math.min(8, restants);
    let lignesLues;
    if (viaSocket) {
      // UNE requête, ordre id garanti, texte en base64 (retours-ligne et
      // `|` neutralisés) — jamais deux requêtes à recoller par position.
      const sel = sqlSelectionLotBase64(tailleLecture, RECETTE_SQL, exclus);
      lignesLues = lignesSocket(sel).map((ligne) => {
        const [id, version, b64] = ligne.split("|");
        return { id: validerIdChunk(id), chunker_version: version, texte: decoderTexteB64(b64 ?? "") };
      });
    } else {
      const sel = sqlSelectionLot(tailleLecture, RECETTE_SQL, exclus);
      const res = await client.query(sel.texte, sel.params);
      lignesLues = res.rows;
    }
    const res = { rows: lignesLues };
    if (res.rows.length === 0) {
      epuise = true;
      break;
    }
    // Garde par lot PRÉ-INFÉRENCE : aucun chunk du lot ne doit appartenir
    // à une source `active` (le filtre de sélection + ce garde = 2 verrous).
    {
      const ids = res.rows.map((l) => String(l.id));
      const garde = sqlGardeLotActif(ids);
      const n = viaSocket
        ? Number.parseInt((lignesSocket(garde)[0] ?? "1").trim(), 10)
        : (await client.query(garde.texte, garde.params)).rows[0]?.n;
      if ((n ?? 1) !== 0) rouge(`garde lot : ${n} source(s) active(s) dans le lot — STOP, aucune écriture.`);
    }
    const exploitables = [];
    for (const ligne of res.rows) {
      if (!CHUNKERS_ACCEPTES.includes(ligne.chunker_version)) {
        rapport.sautes_decoupeur += 1;
        rapport.echecs.push({ id: ligne.id, motif: "decoupeur-derive-saut" });
        exclus.push(String(ligne.id));
        continue;
      }
      exploitables.push(ligne);
    }
    if (exploitables.length === 0) {
      // Pochette entière en dérive découpeur : exclue ce run (anti-boucle),
      // journalisée pour décision humaine — on continue le balayage.
      console.log(`lot — ${res.rows.length} ligne(s) en dérive découpeur, exclues ce run.`);
      ecrireRapport();
      continue;
    }
    let vecteurs;
    try {
      const textes = exploitables.map((l) => fournisseur.texteDocument(String(l.texte)));
      const resultat = await fournisseur.embed(textes);
      if (!resultat.ok) throw new Error(resultat.error.message);
      vecteurs = resultat.vecteurs;
    } catch (err) {
      echecsConsecutifs += 1;
      rapport.echecs.push({ lot: rapport.lots + 1, motif: `inference:${String(err.message ?? err).slice(0, 200)}` });
      ecrireRapport();
      if (echecsConsecutifs >= ECHECS_CONSECUTIFS_MAX) {
        rouge(`${echecsConsecutifs} échecs d'inférence consécutifs — abandon (systémique ?).`);
      }
      console.log(`lot ${rapport.lots + 1} — échec inférence isolé, lot suivant.`);
      continue;
    }
    const lignes = exploitables.map((ligne, i) => ({
      id: String(ligne.id),
      litteral: local.formaterVecteurPg(vecteurs[i] ?? []),
    }));
    const maj = sqlMiseAJourLotReturning(lignes, RECETTE_SQL);
    // Preuve d'appariement par RETURNING (identité + cardinalité) : le seul
    // verdict accepté, sur les deux transports. Le rowCount pg ne prouve que
    // le nombre ; RETURNING prouve QUELLES lignes.
    let retournes;
    if (viaSocket) {
      retournes = lignesSocket(maj);
    } else {
      const majRes = await client.query(maj.texte, maj.params);
      if ((majRes.rowCount ?? -1) !== lignes.length) {
        rouge(`UPDATE a touché ${majRes.rowCount ?? "?"} ligne(s) pour ${lignes.length} — STOP.`);
      }
      retournes = majRes.rows.map((r) => r.id);
    }
    try {
      verifierRetourLot(lignes.map((l) => l.id), retournes);
    } catch (err) {
      rouge(`appariement lot refusé : ${String(err.message ?? err).slice(0, 200)}`);
    }
    rapport.lots += 1;
    rapport.ecrits += lignes.length;
    rapport.dernier_id = lignes[lignes.length - 1]?.id ?? rapport.dernier_id;
    if (restants !== null) restants -= lignes.length;
    echecsConsecutifs = 0;
    ecrireRapport();
    console.log(`lot ${rapport.lots} — ${lignes.length} embedding(s), total ${rapport.ecrits}`);
  }

  // ── post-vérifications : uniformité (si épuisé) + empreinte active ───────
  // L'uniformité n'est exigible qu'en fin de BALAYAGE complet : un run borné
  // (--limite) ou interrompu laisse par construction des dérives à reprendre.
  const uni = await uneLigne(sqlUniformiteRecette(RECETTE_SQL));
  const empreinteApres = await empreinteActive();
  const garde = await uneLigne(sqlGardeGlobaleActive());
  rapport.termine = true;
  ecrireRapport();
  console.log(
    `fin — ecrits=${rapport.ecrits} sautes_decoupeur=${rapport.sautes_decoupeur} echecs=${rapport.echecs.length} derive_restante=${uni.n} sources_active=${garde.n} epuise=${epuise}`,
  );
  if (epuise && (uni.n ?? 1) !== 0) rouge(`uniformité : ${uni.n} ligne(s) à recette dérivée.`);
  if (empreinteApres !== empreinteAvant) rouge("empreinte active modifiée pendant la passe — STOP (écriture sur source active suspectée).");
  if (!viaSocket) await client.end();
  process.exit(0);
} catch (err) {
  ecrireRapport();
  if (!viaSocket) await client.end().catch(() => {});
  rouge(`passe interrompue : ${String(err.message ?? err).slice(0, 300)}`);
}
