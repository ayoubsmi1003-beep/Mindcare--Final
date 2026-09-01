/**
 * Le cluster PostgreSQL local — construction des commandes, jamais leur
 * exécution. §C du plan : chaque fonction ici rend soit un texte de
 * configuration, soit un `{ cmd, args }` prêt pour `child_process.spawn` —
 * sans jamais appeler `spawn` elle-même. C'est ce qui rend ce module
 * vérifiable sans PostgreSQL réel ; `provisionnement.ts` est le seul endroit
 * qui exécute.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { BinairesPg } from "./pg-binaires";

export const NOM_SERVICE = "mindcare-postgres";

/**
 * ⚠️ 16, PAS 15 — malgré ce qu'affirment CLAUDE.md et
 * `installer-windows.ps1`. Découvert par exécution réelle (§K du plan) :
 * `020_gatekeeper_role.sql` et `supabase/bootstrap/010_app_role.sql` utilisent
 * `GRANT role TO role WITH INHERIT {TRUE|FALSE}` sur l'appartenance à un
 * rôle — une clause introduite par PostgreSQL 16, absente de la 15. Appliquer
 * la chaîne 000→083 contre un `postgres:15` échoue dès la migration 020 avec
 * une erreur de syntaxe ; la même chaîne réussit intégralement contre un
 * `postgres:16`. Le conteneur de développement de ce dépôt tourne d'ailleurs
 * déjà en PostgreSQL 16.14 (`pgvector/pgvector:pg16`) — la documentation
 * n'avait simplement pas suivi. Une migration déjà écrite l'emporte sur un
 * texte de documentation (CLAUDE.md, note de tête) : c'est la règle que ce
 * dépôt énonce lui-même.
 */
export const VERSION_ATTENDUE = "16";

export interface Commande {
  readonly cmd: string;
  readonly args: readonly string[];
}

/**
 * Lit `PG_VERSION` dans le répertoire de données. `null` si le cluster
 * n'existe pas encore (premier lancement) — c'est la distinction entre
 * "installation fraîche" et "mise à jour" du §E du plan.
 */
export function versionCluster(dataDir: string): string | null {
  try {
    return readFileSync(path.join(dataDir, "PG_VERSION"), "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * §N du plan, risque "mise à niveau majeure de PostgreSQL" : on refuse de
 * démarrer sur un cluster dont la version majeure ne correspond pas au
 * binaire empaqueté, plutôt que de laisser `postgres.exe` échouer avec un
 * message opaque — ou pire, corrompre silencieusement les fichiers.
 */
export function versionCompatible(dataDir: string): boolean {
  const v = versionCluster(dataDir);
  return v !== null && v === VERSION_ATTENDUE;
}

/**
 * `initdb` — encodage UTF8, locale ICU fr-DZ (§C : irréversible après coup,
 * donc posée dès la création), authentification scram-sha-256 en local.
 * Le mot de passe du superutilisateur du CLUSTER (distinct de
 * `mindcare_app`) est fourni via un fichier temporaire, jamais en argument :
 * la ligne de commande est visible par tout processus de la machine.
 */
export function commandeInitdb(bin: BinairesPg, dataDir: string, fichierMotDePasse: string): Commande {
  return {
    cmd: bin.initdb,
    args: [
      "--pgdata",
      dataDir,
      "--encoding=UTF8",
      "--locale-provider=icu",
      "--icu-locale=fr-DZ",
      "--auth-local=scram-sha-256",
      "--auth-host=reject",
      "--username=postgres",
      `--pwfile=${fichierMotDePasse}`,
    ],
  };
}

/**
 * §C, §G du plan : écoute exclusivement en boucle locale. C'est la même
 * exigence que `installer-windows.ps1` vérifie après coup (étape 2) — ici on
 * l'ÉCRIT à la création, elle n'a donc jamais à être corrigée.
 */
export function contenuEcouteLocale(port: number): string {
  return `listen_addresses = 'localhost'\nport = ${port}\n`;
}

/**
 * `pg_hba.conf` — la seule ligne nécessaire : connexions locales et
 * boucle IPv4/IPv6, authentification par mot de passe salé, rien d'autre.
 * Remplace ENTIÈREMENT le fichier généré par `initdb` (qui autoriserait
 * `trust` en local sur certaines plateformes) plutôt que de l'amender.
 */
export function contenuPgHba(): string {
  return [
    "# Écrit par MindCare — ne pas éditer à la main, voir electron/main/pg-cluster.ts",
    "local   all             all                                     scram-sha-256",
    "host    all             all             127.0.0.1/32            scram-sha-256",
    "host    all             all             ::1/128                 scram-sha-256",
    "",
  ].join("\n");
}

/**
 * Enregistrement comme service Windows — survit au redémarrage de la machine
 * et redémarre après un plantage (§16 de la mission : laisser Windows
 * résoudre ce que gérerait sinon un superviseur maison).
 */
export function commandeEnregistrerService(bin: BinairesPg, dataDir: string, journalDir: string): Commande {
  return {
    cmd: bin.pgCtl,
    args: [
      "register",
      "--pgdata",
      dataDir,
      "--servicename",
      NOM_SERVICE,
      "--startup=auto",
      "--wait",
      "--log",
      path.join(journalDir, "postgres.log"),
    ],
  };
}

export function commandeDemarrerService(): Commande {
  return { cmd: "net", args: ["start", NOM_SERVICE] };
}

/**
 * `net stop` peut rendre "service not started" si l'utilisatrice a déjà
 * arrêté PostgreSQL manuellement — l'appelant traite ce cas comme un succès,
 * pas comme une erreur (§16 : on ne veut pas empêcher la fermeture de
 * l'application pour ça).
 */
export function commandeArreterService(): Commande {
  return { cmd: "net", args: ["stop", NOM_SERVICE] };
}
