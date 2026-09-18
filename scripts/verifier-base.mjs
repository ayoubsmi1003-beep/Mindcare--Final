#!/usr/bin/env node
/**
 * verifier-base — le contrôle de démarrage, EN NODE PUR, avant que Next ne se lance.
 *
 * ═══ POURQUOI CE CONTRÔLE A DÛ SORTIR DE NEXT ══════════════════════════════
 *
 * Il vivait dans `src/instrumentation.ts`. C'était un défaut d'architecture,
 * révélé par `pnpm dev` :
 *
 *   ○ Compiling /instrumentation ...
 *   ⨯ pg-connection-string/index.js:88
 *     Module not found: Can't resolve 'fs'
 *
 * Next compile `instrumentation.ts` dans une unité de compilation SÉPARÉE, qui
 * n'applique PAS `serverExternalPackages`. `pg` y était donc empaqueté par
 * webpack — or `pg` n'est pas empaquetable : `pg-connection-string` fait un
 * `require('fs')` conditionnel que webpack ne peut pas éliminer, et
 * `pg/lib/native` un `require('pg-native')` optionnel. L'unité échouait, et
 * l'échec d'UNE unité rendait TOUTES les requêtes en 500.
 *
 * La leçon n'est pas « pg est difficile » : c'est qu'un contrôle de démarrage
 * n'a rien à faire dans un graphe compilé par un bundler. Il s'exécute AVANT
 * l'application, une fois, dans Node. C'est exactement ce que fait ce fichier —
 * comme `garde-origine.mjs` le fait déjà pour l'origine.
 *
 * ═══ CE QUE CE DÉPLACEMENT AMÉLIORE ════════════════════════════════════════
 *
 * L'ancienne version ne pouvait qu'AVERTIR : Next était déjà lancé. Celle-ci
 * s'exécute avant, et peut donc REFUSER DE DÉMARRER — ce que le plan demandait
 * (« sinon refus de démarrer sur schéma partiellement migré »). Le garde-fou
 * devient ce qu'il prétendait être.
 *
 * ⚠️ CE FICHIER NE REMPLACE PAS `src/server/demarrage.ts`. Celui-là garde la
 * frontière `/api/db/*` À CHAQUE REQUÊTE, ce qui protège aussi le cas où la
 * base se dégrade PENDANT que l'application tourne. Les deux sont nécessaires
 * et couvrent des instants différents : celui-ci le lancement, l'autre la vie
 * du service. La petite redondance des deux requêtes SQL est le prix de cette
 * couverture, et elle est délibérée.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { garantirBaseLocale } from "./lib/base-locale.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ⚠️ CE SCRIPT DOIT CHARGER `.env` LUI-MÊME, et l'oublier coûte un faux
 * diagnostic — mesuré : le contrôle a refusé de démarrer en annonçant
 * « MINDCARE_DATABASE_URL est absente » alors qu'elle était bien dans `.env`.
 *
 * C'est NEXT qui lit `.env`, pas Node. En sortant le contrôle de Next pour le
 * faire tourner AVANT lui, on est aussi sorti de son chargement d'environnement.
 * Le prix de l'indépendance vis-à-vis du bundler est de refaire ces quelques
 * lignes.
 *
 * L'ENVIRONNEMENT RÉEL GAGNE TOUJOURS : une variable déjà posée (service
 * Windows, ligne de commande) n'est jamais écrasée par le fichier — même
 * priorité que Next, pour qu'un `MINDCARE_DATABASE_URL=… pnpm start` se
 * comporte comme on l'attend.
 *
 * Analyse volontairement minimale : `CLE=valeur`, une par ligne. Pas de
 * guillemets multi-lignes, pas d'expansion de variables — on ne réimplémente
 * pas dotenv, on lit ce que `.env.example` décrit. Et JAMAIS de journalisation
 * des valeurs : ce fichier porte le mot de passe de la base.
 */
/**
 * ⚠️ `MINDCARE_ENV_FILE`, quand elle est posée, REMPLACE la liste normale
 * `.env.local` / `.env` — elle ne s'y AJOUTE PAS. C'est le mécanisme par
 * lequel la coquille Electron packagée (§F du plan) pointe ce contrôle vers
 * `%ProgramData%\MindCare\mindcare.env` sans jamais retomber, même en cas de
 * fichier absent, sur le `.env` d'un dépôt de développement qui pourrait se
 * trouver sur la même machine. `pnpm dev`/`pnpm start` ne posent jamais cette
 * variable : leur comportement reste exactement celui d'avant.
 */
function chargerEnv() {
  const fichierExplicite = process.env["MINDCARE_ENV_FILE"];
  const candidats = fichierExplicite !== undefined ? [fichierExplicite] : [".env.local", ".env"];
  for (const nom of candidats) {
    const chemin = fichierExplicite !== undefined ? nom : path.join(RACINE, nom);
    let texte;
    try {
      texte = readFileSync(chemin, "utf8");
    } catch {
      continue; // absent : normal
    }
    // Decoupe sur les fins de ligne, Windows comprises : le retour chariot
    // eventuel est retire par le `trim()` juste en dessous.
    for (const ligne of texte.split(String.fromCharCode(10))) {
      const nette = ligne.trim();
      if (nette === "" || nette.startsWith("#")) continue;
      const egal = nette.indexOf("=");
      if (egal <= 0) continue;
      const cle = nette.slice(0, egal).trim();
      if (process.env[cle] !== undefined) continue; // l'environnement prime
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

chargerEnv();

/**
 * ═══ POURQUOI `--allow-degraded` A ÉTÉ RETIRÉ ══════════════════════════════
 *
 * Il laissait `pnpm dev` démarrer « sain » alors que PostgreSQL manquait :
 * le navigateur atteignait Next.js, puis CHAQUE `/api/auth/sign-in` rendait
 * 503 et `getInstallationStatus` « indisponible » — la panne LM54.3, qui ne
 * se voyait qu'À L'ÉCRAN, jamais au terminal. Un état de service « normal »
 * avec la dépendance obligatoire absente est exactement ce qu'un contrôle
 * de démarrage existe pour empêcher.
 *
 * Le remplacement est le contraire du silence : AVANT de refuser, on tente
 * de RÉPARER la cause la plus fréquente (Docker Desktop pas encore prêt au
 * boot, conteneur arrêté) via `garantirBaseLocale()`, qui attend le démon,
 * démarre le conteneur et prouve `pg_isready`. Si la base ne PEUT pas être
 * prête, le refus nomme l'organe et la conduite à tenir.
 *
 * `MINDCARE_SKIP_DB_WAIT=1` (CI sans Docker, tests hors ligne) SAUTE
 * L'ATTENTE mais garde le contrôle complet : la connexion doit alors
 * réussir au premier essai, sinon refus. Rien ne passe en silence.
 */
const SKIP_DB_WAIT = process.env.MINDCARE_SKIP_DB_WAIT === "1";

/**
 * Les erreurs de TRANSPORT (le serveur n'est pas joignable) par opposition
 * aux erreurs PostgreSQL (le serveur a répondu « non »). Seules les premières
 * justifient d'attendre ; les secondes sont un refus ferme immédiat.
 */
function estConnexionRefusee(e) {
  if (e?.code === "ECONNREFUSED") return true;
  const msg = String(e?.message ?? "");
  return msg.includes("ECONNREFUSED");
}

/** Le nombre de tentatives de connexion quand on n'attend pas la base. */
const TENTATIVES_SANS_ATTENTE = 2;

function refuser(titre, detail, lignes = []) {
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════════╗");
  console.error("║  MINDCARE NE DEMARRE PAS                                     ║");
  console.error("╚══════════════════════════════════════════════════════════════╝");
  console.error(`  ${titre}`);
  if (detail !== undefined) console.error(`  ${detail}`);
  for (const l of lignes) console.error(`    · ${l}`);
  console.error("");
  process.exit(1);
}

const url = process.env.MINDCARE_DATABASE_URL;
if (url === undefined || url.trim() === "") {
  refuser(
    "MINDCARE_DATABASE_URL est absente.",
    "Sans elle, l'application ne sait pas a quelle base parler. Voir .env.example.",
  );
}

let attendues;
try {
  attendues = readdirSync(path.join(RACINE, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4))
    .sort();
} catch (e) {
  refuser("Le dossier supabase/migrations est illisible.", String(e));
}

if (attendues.length === 0) {
  refuser("Aucune migration sur le disque — installation incomplete.");
}

// `max: 1` : un seul aller-retour, puis on ferme. Ce n'est pas le pool de
// l'application, c'est une sonde.
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });

/**
 * ═══ ATTENDRE QUE LA DÉPENDANCE OBLIGATOIRE SOIT PRÊTE ══════════════════════
 *
 * Docker Desktop démarre au boot du PC et peut prendre des dizaines de
 * secondes ; le conteneur `mc-p3` y est attaché mais peut être arrêté.
 * Chacun de ces états produisait un ECONNREFUSED au premier essai — et,
 * avec l'ancien `--allow-degraded`, un démarrage « sain » d'une application
 * cassée.
 *
 * On ne lance donc le contrôle de schéma QU'UNE FOIS la base prouvée prête :
 *   1. attendre/garantir le cycle de vie local (démon, conteneur,
 *      pg_isready) — UNIQUEMENT si l'URL vise le conteneur de développement
 *      `mc-p3` (127.0.0.1:55441). Le paquet installé, lui, parle au service
 *      Windows PostgreSQL (port 54333) que l'orchestrateur Electron gère
 *      par ses propres états : y chercher Docker serait chercher le mauvais
 *      organe ;
 *   2. tant que la connexion applicative échoue par TRANSPORT, retenter —
 *      c'est la fenêtre de course entre « pg_isready dit oui » et « la
 *      première connexion applicative passe » ;
 *   3. une erreur PostgreSQL (rôle, mot de passe, base absente) est un
 *      refus ferme immédiat : attendre ne réparerait rien.
 */
function viseConteneurDev(u) {
  try {
    const parsed = new URL(u);
    return (
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === "55441"
    );
  } catch {
    return false;
  }
}

async function connecterAvecAttente() {
  if (!SKIP_DB_WAIT && viseConteneurDev(url)) {
    const garantie = await garantirBaseLocale(url);
    if (!garantie.ok) {
      refuser(
        `La base locale n'a pas pu être rendue prête (étape : ${garantie.etape}).`,
        garantie.action ?? garantie.erreur ?? "Cause inconnue.",
      );
    }
  }

  const budgetMs = SKIP_DB_WAIT ? 5_000 : 20_000;
  const echeance = Date.now() + budgetMs;
  let derniereErreur;
  for (let tentative = 1; ; tentative += 1) {
    try {
      await client.connect();
      return; // prêt — le contrôle de schéma suit
    } catch (e) {
      derniereErreur = e;
      if (!estConnexionRefusee(e)) break; // refus PostgreSQL : ferme, ne retente pas
      if (Date.now() >= echeance) break;
      if (SKIP_DB_WAIT && tentative >= TENTATIVES_SANS_ATTENTE) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Volontairement sans le message brut : il contient l'URL de connexion,
  // donc le mot de passe de la base.
  refuser(
    "La base de donnees ne repond pas.",
    `Verifier que le service PostgreSQL est demarre. (${
      derniereErreur?.code ?? derniereErreur?.name ?? "erreur"
    })`,
    [
      // Le conseil suit la CIBLE : mc-p3/Docker en développement, service
      // Windows PostgreSQL dans le paquet installé (port 54333, géré par
      // l'orchestrateur Electron — cf. electron/main/orchestrateur.ts).
      ...(viseConteneurDev(url)
        ? [
            "Le conteneur de developpement est mc-p3 (Docker, 127.0.0.1:55441).",
            "Lancer Docker Desktop puis relancer, ou verifier : docker ps -a --filter name=mc-p3",
          ]
        : ["Le service Windows PostgreSQL (mindcare-postgres) doit etre demarre."]),
      ...(SKIP_DB_WAIT
        ? ["MINDCARE_SKIP_DB_WAIT=1 est pose : aucune attente de base locale n'a eu lieu."]
        : []),
    ],
  );
}

await connecterAvecAttente();

try {
  /**
   * ⚠️ IL FAUT ENDOSSER `anon` — et l'oublier donne un `42501` déroutant.
   *
   * `mindcare_app` est NOINHERIT (bootstrap 010) : hors d'un `SET ROLE`, il ne
   * possède AUCUN privilège, pas même sur `app.schema_migrations`. C'est
   * exactement la propriété qui fait qu'une enveloppe d'identité oubliée
   * provoque une panne au lieu d'une fuite — elle s'applique donc aussi à ce
   * contrôle, et c'est très bien ainsi.
   *
   * On fait donc ce que fait l'application : on endosse `anon`, le rôle
   * d'avant-connexion, à qui la migration 072 accorde la lecture du journal de
   * version. Une transaction et `SET LOCAL` par symétrie avec `withCaller()` :
   * l'endossement meurt avec elle.
   */
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE anon");

  const schema = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS present",
  );
  if (schema.rows[0]?.present !== true) {
    await client.end();
    refuser(
      "Le schema « app » n'existe pas : la base n'a jamais ete initialisee.",
      "Jouer supabase/bootstrap/000_platform_compat.sql, puis les migrations.",
    );
  }

  const { rows } = await client.query("SELECT version FROM app.schema_migrations");
  const appliquees = new Set(rows.map((r) => r.version));
  const manquantes = attendues.filter((v) => !appliquees.has(v));

  if (manquantes.length > 0) {
    await client.end();
    refuser(
      `${manquantes.length} migration(s) presente(s) sur le disque mais jamais appliquee(s).`,
      "Refus de demarrer sur un schema partiel : des ecrans fonctionneraient et " +
        "d'autres non, sans que rien ne le signale.",
      manquantes,
    );
  }

  await client.query("COMMIT");
  console.log(`[demarrage] base joignable, ${attendues.length} migrations a jour.`);
} catch (e) {
  await client.end().catch(() => {});
  refuser("Verification du schema impossible.", `(${e?.code ?? e?.name ?? "erreur"})`);
}

await client.end();
