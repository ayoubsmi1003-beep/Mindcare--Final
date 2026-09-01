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

try {
  await client.connect();
} catch (e) {
  // Volontairement sans le message brut : il contient l'URL de connexion,
  // donc le mot de passe de la base.
  refuser(
    "La base de donnees ne repond pas.",
    `Verifier que le service PostgreSQL est demarre. (${e?.code ?? e?.name ?? "erreur"})`,
  );
}

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
