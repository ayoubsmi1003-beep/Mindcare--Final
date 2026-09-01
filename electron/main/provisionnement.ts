/**
 * Provisionnement de la base — §C, §D du plan.
 *
 * Port de la logique déjà éprouvée dans `scripts/installer-windows.ps1`
 * (bootstrap 000, migrations dans l'ordre, bootstrap 010, mot de passe
 * engendré localement, fichier d'environnement à accès restreint) dans le
 * processus principal, pour qu'elle s'intègre à la machine à états de
 * démarrage (§H) au lieu d'un script séparé que la praticienne devrait
 * lancer elle-même. LES FICHIERS SQL NE SONT PAS DUPLIQUÉS — ce module ne
 * fait qu'appeler `psql -f` sur les mêmes fichiers que l'installateur
 * PowerShell, dans le même ordre.
 *
 * ⚠️ Ce module EXÉCUTE (spawn, écriture disque). Il n'est donc pas couvert
 * par les tests unitaires — seulement par les tests d'intégration du plan
 * (§K, étape 7) contre un vrai PostgreSQL. Les décisions PURES qu'il utilise
 * (chemins, contenu de configuration, commandes) vivent dans
 * `pg-binaires.ts` et `pg-cluster.ts`, qui eux le sont.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import type { BinairesPg } from "./pg-binaires";
import type { Commande } from "./pg-cluster";

function executer(commande: Commande, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const p = spawn(commande.cmd, [...commande.args], { env: env ?? process.env });
    let sortieErreur = "";
    p.stderr?.on("data", (d: Buffer) => {
      sortieErreur += d.toString();
    });
    p.on("error", rejeter);
    p.on("exit", (code) => {
      if (code === 0) resoudre();
      else rejeter(new Error(`${commande.cmd} a échoué (code ${code}) : ${sortieErreur.slice(0, 2000)}`));
    });
  });
}

/**
 * Les fichiers de migration triés par nom — même règle que
 * `src/server/demarrage.ts#migrationsSurDisque`, redite ici volontairement :
 * importer ce module ferait entrer `withCaller`/le pool `pg` (dépendance
 * lourde, réservée au serveur Next) dans le paquet Electron, pour trois
 * lignes de logique.
 */
export function fichiersMigrations(racineDepot: string): readonly string[] {
  const dossier = path.join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dossier, f));
}

/**
 * La cible (hôte, base, identifiants) passe entièrement par les variables
 * d'environnement `PG*` — voir `envPsql` — jamais en argument de commande :
 * la ligne de commande est visible par tout processus de la machine.
 */
function commandePsqlFichier(bin: BinairesPg, fichier: string): Commande {
  return { cmd: bin.psql, args: ["-v", "ON_ERROR_STOP=1", "-q", "-f", fichier] };
}

export interface CibleProvisionnement {
  readonly bin: BinairesPg;
  readonly hote: string;
  readonly port: number;
  readonly base: string;
  readonly superutilisateur: string;
  readonly motDePasseSuperutilisateur: string;
}

function envPsql(cible: CibleProvisionnement): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: cible.hote,
    PGPORT: String(cible.port),
    PGDATABASE: cible.base,
    PGUSER: cible.superutilisateur,
    PGPASSWORD: cible.motDePasseSuperutilisateur,
  };
}

/**
 * `CREATE DATABASE` — ICU fr-DZ, comme `installer-windows.ps1` étape 3.
 * Idempotent : ne recrée pas une base déjà présente (elle appartiendrait
 * alors à une installation existante, §E "mise à jour").
 */
async function creerBaseSiAbsente(cible: CibleProvisionnement): Promise<void> {
  const env = { ...envPsql(cible), PGDATABASE: "postgres" };
  const existe = await new Promise<boolean>((resoudre, rejeter) => {
    const p = spawn(cible.bin.psql, ["-tAX", "-c", `SELECT 1 FROM pg_database WHERE datname = '${cible.base}'`], {
      env,
    });
    let sortie = "";
    p.stdout?.on("data", (d: Buffer) => {
      sortie += d.toString();
    });
    p.on("error", rejeter);
    p.on("exit", () => resoudre(sortie.trim() === "1"));
  });
  if (existe) return;
  await executer(
    {
      cmd: cible.bin.psql,
      args: [
        "-c",
        `CREATE DATABASE "${cible.base}" LOCALE_PROVIDER icu ICU_LOCALE 'fr-DZ' TEMPLATE template0 ENCODING 'UTF8'`,
      ],
    },
    env,
  );
}

/**
 * Applique bootstrap 000, toutes les migrations dans l'ordre, puis bootstrap
 * 010 — exactement la séquence de `installer-windows.ps1` §5 à §6, à ceci
 * près que la base de production est PURGÉE de ses données synthétiques
 * juste après (voir `083_purge_fixtures.sql`, appelé par l'orchestrateur qui
 * possède déjà `app.deployment.environment`, hors de ce module qui ignore
 * délibérément la distinction dev/prod).
 */
export async function provisionnerBase(cible: CibleProvisionnement, racineDepot: string): Promise<void> {
  await creerBaseSiAbsente(cible);

  const fichiers = [
    path.join(racineDepot, "supabase", "bootstrap", "000_platform_compat.sql"),
    ...fichiersMigrations(racineDepot),
  ];
  for (const fichier of fichiers) {
    await executer(commandePsqlFichier(cible.bin, fichier), envPsql(cible));
  }
}

/**
 * Rôle applicatif + mot de passe engendré sur la machine — jamais transporté,
 * jamais dans le dépôt. 32 octets du générateur cryptographique de Node.
 * `installer-windows.ps1` §6, porté ici.
 */
export async function provisionnerRoleApplicatif(
  cible: CibleProvisionnement,
  racineDepot: string,
): Promise<string> {
  await executer(
    commandePsqlFichier(cible.bin, path.join(racineDepot, "supabase", "bootstrap", "010_app_role.sql")),
    envPsql(cible),
  );

  const motDePasse = randomBytes(32).toString("base64url");
  await executer(
    { cmd: cible.bin.psql, args: ["-c", `ALTER ROLE mindcare_app PASSWORD '${motDePasse}'`] },
    envPsql(cible),
  );
  return motDePasse;
}

/**
 * Le fichier d'environnement du cabinet — `installer-windows.ps1` §7, porté
 * ici avec `icacls` en remplacement de `Set-Acl` (même intention : seuls le
 * compte courant, les administrateurs et SYSTEM peuvent le lire).
 *
 * ⚠️ Écrit une seule variable, `MINDCARE_DATABASE_URL` — jamais un mot de
 * passe de superutilisateur, jamais une clé de fournisseur. Ce fichier est
 * exactement ce que `chemins.ts#fichierEnvironnement` pointe en production.
 */
export async function ecrireFichierEnvironnement(
  cheminFichier: string,
  hote: string,
  port: number,
  base: string,
  motDePasseApp: string,
): Promise<void> {
  mkdirSync(path.dirname(cheminFichier), { recursive: true });
  const url = `postgresql://mindcare_app:${motDePasseApp}@${hote}:${port}/${base}`;
  writeFileSync(
    cheminFichier,
    `# Engendré par MindCare — NE PAS COMMITER, NE PAS PARTAGER.\nMINDCARE_DATABASE_URL=${url}\n`,
    "utf8",
  );
  const utilisateur = process.env["USERNAME"] ?? "";
  await executer({
    cmd: "icacls",
    args: [
      cheminFichier,
      "/inheritance:r",
      "/grant:r",
      ...(utilisateur !== "" ? [`${utilisateur}:F`] : []),
      "BUILTIN\\Administrators:F",
      "NT AUTHORITY\\SYSTEM:F",
    ],
  });
}

/**
 * Un mot de passe superutilisateur temporaire pour `initdb --pwfile`, jamais
 * écrit ailleurs qu'ici, détruit aussitôt lu (§C du plan). Le superutilisateur
 * du CLUSTER n'est utilisé que par ce module, jamais par l'application.
 */
export async function avecFichierMotDePasseTemporaire<T>(
  dossierTemp: string,
  motDePasse: string,
  fn: (chemin: string) => Promise<T>,
): Promise<T> {
  mkdirSync(dossierTemp, { recursive: true });
  const chemin = path.join(dossierTemp, `pwfile-${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(chemin, motDePasse, "utf8");
  try {
    return await fn(chemin);
  } finally {
    rmSync(chemin, { force: true });
  }
}
