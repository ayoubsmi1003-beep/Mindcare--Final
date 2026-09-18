/**
 * Le pool de connexions PostgreSQL — SERVEUR UNIQUEMENT.
 *
 * ⚠️ CE MODULE NE DOIT ÊTRE IMPORTÉ QUE PAR `withCaller.ts`. La règle
 * `no-restricted-imports` d'ESLint l'impose, et ce n'est pas une convention de
 * style : `pg` NE RÉINITIALISE PAS une connexion entre deux emprunts. Un
 * `pool.connect()` posé ailleurs rendrait une connexion portant encore les
 * `SET` de la requête précédente — c'est-à-dire l'identité d'un autre
 * utilisateur. Tout emprunt passe donc par l'enveloppe, qui garantit la remise
 * à zéro.
 *
 * POURQUOI CE FICHIER N'EST PAS DANS `src/services/`. `src/services/*` est du
 * code qui s'exécute DANS LE NAVIGATEUR (74 fichiers `"use client"` en
 * dépendent). Un module qui importe `pg` y serait empaqueté dans le bundle, ou
 * plus probablement casserait la compilation — et dans le meilleur des cas
 * mettrait les identifiants de la base à portée du navigateur. `src/server/**`
 * est la frontière : rien de ce qui s'y trouve ne traverse vers le client.
 */

import { readFileSync } from "node:fs";

import { Pool, type PoolConfig } from "pg";

/**
 * L'URL de connexion ne porte PAS de valeur par défaut, et ne doit pas en
 * porter. Un défaut du genre `postgres://localhost/mindcare` transformerait une
 * variable d'environnement absente en connexion silencieuse à une base
 * inattendue — au mieux vide, au pire celle d'un autre environnement. Une
 * configuration manquante doit empêcher le démarrage, pas le deviner.
 */
function lireUrl(): string {
  let url = process.env.MINDCARE_DATABASE_URL;
  if (url !== undefined && url.trim() !== "") return url;
  // En paquet Electron, la variable vit dans MINDCARE_ENV_FILE (ProgramData),
  // pas dans l'environnement hérité. Charger à la demande, sans écraser
  // une variable déjà posée (même priorité que verifier-base.mjs).
  const fichierEnv = process.env.MINDCARE_ENV_FILE;
  if (fichierEnv !== undefined && fichierEnv.trim() !== "") {
    try {
      const texte = readFileSync(fichierEnv, "utf8");
      for (const ligne of texte.split("\n")) {
        const nette = ligne.trim();
        if (nette === "" || nette.startsWith("#")) continue;
        const egal = nette.indexOf("=");
        if (egal <= 0) continue;
        const cle = nette.slice(0, egal).trim();
        if (cle === "MINDCARE_DATABASE_URL" && url === undefined) {
          let valeur = nette.slice(egal + 1).trim();
          if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) {
            valeur = valeur.slice(1, -1);
          }
          url = valeur;
          break;
        }
      }
      if (url !== undefined && url.trim() !== "") return url;
    } catch {
      // fichier illisible : on retombe sur l'erreur ci-dessous
    }
  }
  throw new Error(
    "MINDCARE_DATABASE_URL est absente. Le serveur ne peut pas démarrer sans " +
      "savoir à quelle base il parle.",
  );
}

/**
 * Réglages du pool, et la raison de chacun.
 *
 * `max` — le cabinet compte trois postes au plus. Un pool large ne rendrait pas
 * l'application plus rapide ; il retarderait seulement le moment où une fuite de
 * connexion devient visible, en la noyant dans la réserve.
 *
 * `statement_timeout` est posé PAR TRANSACTION dans `withCaller`, pas ici :
 * un réglage de pool s'applique à la connexion et survivrait donc à l'emprunt,
 * ce qui est précisément ce qu'on cherche à éviter partout dans ce module.
 *
 * `allowExitOnIdle: false` — le processus Next.js vit longtemps ; on ne veut pas
 * qu'un pool inactif laisse filer le handle et force une reconnexion à la
 * première consultation du matin.
 */
const REGLAGES: Omit<PoolConfig, "connectionString"> = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: false,
  application_name: "mindcare",
};

/**
 * Mémoïsé sur `globalThis`. En développement, Next.js recharge les modules à
 * chaud ; une variable de module ordinaire repartirait à zéro à chaque
 * rechargement et on accumulerait un pool par sauvegarde de fichier, jusqu'à
 * épuiser `max_connections` au bout d'une matinée. `globalThis`, lui, survit.
 *
 * `declare global { var … }` plutôt qu'un symbole et deux assertions : le
 * dépôt interdit la double assertion (`x as unknown as T`, règle I9), et il a
 * raison — elle fait taire le compilateur exactement là où on aurait besoin
 * qu'il parle. La déclaration d'ambiance donne le même résultat en restant
 * vérifiée de bout en bout.
 */
declare global {
  // `var` est la SEULE forme qui déclare une propriété de `globalThis` ; `let`
  // et `const` créent une liaison de portée module, invisible d'ici. (Pas de
  // `eslint-disable` ici : le dépôt règle `noInlineConfig`, qui les rend
  // inertes — et `no-var` n'est de toute façon pas actif sur ce dépôt.)
  var mindcarePoolPg: Pool | undefined;
}

export function obtenirPool(): Pool {
  const existant = globalThis.mindcarePoolPg;
  if (existant !== undefined) {
    return existant;
  }

  const cree = new Pool({ ...REGLAGES, connectionString: lireUrl() });

  /**
   * Une erreur sur une connexion INACTIVE (coupure réseau, redémarrage du
   * service PostgreSQL) est émise sur le pool. Sans écouteur, Node considère
   * l'événement `error` comme non géré et TERMINE LE PROCESSUS — l'application
   * entière tomberait parce qu'une connexion au repos a été fermée par le
   * serveur. On journalise et on laisse `pg` retirer la connexion fautive.
   *
   * Volontairement sans détail : le message de `pg` peut contenir l'URL de
   * connexion, donc le mot de passe.
   */
  cree.on("error", () => {
    console.error("[db] connexion inactive perdue ; elle est retirée du pool.");
  });

  globalThis.mindcarePoolPg = cree;
  return cree;
}

/** Ferme le pool — arrêt propre du serveur et fin des tests d'intégration. */
export async function fermerPool(): Promise<void> {
  const existant = globalThis.mindcarePoolPg;
  if (existant === undefined) return;
  // Effacé AVANT `end()` : si la fermeture échoue, on ne veut pas qu'un pool
  // à demi fermé reste joignable par le prochain appelant.
  globalThis.mindcarePoolPg = undefined;
  await existant.end();
}
