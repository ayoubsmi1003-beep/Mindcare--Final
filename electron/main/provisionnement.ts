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
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import type { BinairesPg } from "./pg-binaires";
import type { Commande } from "./pg-cluster";

function executer(commande: Commande, env?: NodeJS.ProcessEnv, entree?: string): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const p = spawn(commande.cmd, [...commande.args], { env: env ?? process.env });
    if (entree !== undefined) {
      p.stdin.on("error", () => {});
      p.stdin.end(entree);
    }
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
 * `CREATE DATABASE` — ICU fr-DZ et classification C, comme la source.
 * Ne pas hériter de French_France.1252 : la colonne document_tsv générée
 * changerait lors d'une restauration Windows (preuve native 2026-10-08).
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
        `CREATE DATABASE "${cible.base}" LOCALE_PROVIDER icu ICU_LOCALE 'fr-DZ' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0 ENCODING 'UTF8'`,
      ],
    },
    env,
  );
}

/**
 * Applique bootstrap 000, les migrations jusqu'à 014, bootstrap 005
 * (référentiel déterministe — tables nées en 009, seed 015 respecté, sans quoi
 * 090 échoue sur un cluster frais), les migrations 015→072, bootstrap 005b
 * (empreintes 073 des médicaments), puis 073→127 et bootstrap 010 — la
 * séquence de `installer-windows.ps1` §5 à §6 (qui, lui, ne connaît ni 005 ni
 * 005b : limitation connue, hors périmètre), à ceci près que la base de
 * production est PURGÉE de ses données synthétiques juste après (voir
 * `083_purge_fixtures.sql`, appelé par l'orchestrateur qui possède déjà
 * `app.deployment.environment`, hors de ce module qui ignore délibérément la
 * distinction dev/prod).
 */
export async function provisionnerBase(cible: CibleProvisionnement, racineDepot: string): Promise<void> {
  await creerBaseSiAbsente(cible);

  // 005 est un bootstrap mais dépend des tables créées par 009 : il s'insère
  // donc entre les migrations (avant 015, dont le seed respecte ses ids).
  // 005b pose les empreintes 073 des médicaments : APRÈS 073 (la colonne y
  // naît), avant 074. Inverser cet ordre donne « column source_fingerprint
  // does not exist » (trouvé par échec réel du provisionnement, 2026-10-07).
  const migrations = fichiersMigrations(racineDepot);
  const nom = (f: string): string => path.basename(f);
  const avant015 = migrations.filter((f) => nom(f) < "015_seed_data");
  const de015a073 = migrations.filter((f) => nom(f) >= "015_seed_data" && nom(f) < "073_medication_catalog_enrich");
  const fichier073 = migrations.filter((f) => nom(f) === "073_medication_catalog_enrich.sql");
  const apres073 = migrations.filter((f) => nom(f) > "073_medication_catalog_enrich.sql");
  // Garde d'ancrage : si une migration est renommée, l'ordre ci-dessus
  // deviendrait silencieusement faux — refuser plutôt que mal provisionner.
  if (avant015.length === 0 || fichier073.length !== 1) {
    throw new Error("Ordre de provisionnement incalculable : ancres 015/073 introuvables sur le disque.");
  }
  const fichiers = [
    path.join(racineDepot, "supabase", "bootstrap", "000_platform_compat.sql"),
    ...avant015,
    // 005 : référentiel déterministe (échelles + 8 médicaments), sans lequel
    // 090 (UUID en dur) échoue sur un cluster frais.
    path.join(racineDepot, "supabase", "bootstrap", "005_scales_fixed_ids.sql"),
    ...de015a073,
    ...fichier073,
    path.join(racineDepot, "supabase", "bootstrap", "005b_medications_fingerprints.sql"),
    ...apres073,
  ];
  for (const fichier of fichiers) {
    await executer(commandePsqlFichier(cible.bin, fichier), envPsql(cible));
  }
}

/** Uniquement après initdb dans ce démarrage; jamais sur une base existante. */
export async function finaliserCabinetNeuf(cible: CibleProvisionnement, fichierPurge: string, clusterNeuf: boolean): Promise<void> {
  if (clusterNeuf !== true) throw new Error("Initialisation refusée sur une base existante.");
  await executer({cmd:cible.bin.psql,args:["-X","-v","ON_ERROR_STOP=1","-q"]}, envPsql(cible), "SELECT app.set_deployment_environment('self-hosted', 'Initialisation du cabinet neuf MindCare');\n");
  await executer(commandePsqlFichier(cible.bin,fichierPurge),envPsql(cible));
  await executer({cmd:cible.bin.psql,args:["-X","-v","ON_ERROR_STOP=1","-q"]},envPsql(cible), "SELECT * FROM app.purge_fixtures_015();\nDO $$ BEGIN IF EXISTS (SELECT 1 FROM app.patients) OR EXISTS (SELECT 1 FROM app.profiles) THEN RAISE EXCEPTION 'Le cabinet neuf contient encore des fixtures'; END IF; END $$;\n");
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
    { cmd: cible.bin.psql, args: ["-v", "ON_ERROR_STOP=1", "-q"] },
    envPsql(cible),
    `ALTER ROLE mindcare_app PASSWORD '${motDePasse}';\n`,
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
  const url = ["postgresql://", "mindcare_app:", motDePasseApp, "@", hote, ":", String(port), "/", base].join("");
  writeFileSync(
    cheminFichier,
    `# Engendré par MindCare — NE PAS COMMITER, NE PAS PARTAGER.\nMINDCARE_DATABASE_URL=${url}\n`,
    "utf8",
  );
  const utilisateur = process.env["USERNAME"] ?? "";
  // SIDs bien connus plutôt que noms localisés : `BUILTIN\Administrators`
  // n'existe pas sous ce nom sur un Windows français (`Administrateurs`) —
  // icacls rendait 1332 et le premier lancement échouait (trouvé par échec
  // réel, 2026-10-07). `*S-…` désigne le SID, indépendant de la langue.
  await executer({
    cmd: "icacls",
    args: [
      cheminFichier,
      "/inheritance:r",
      "/grant:r",
      ...(utilisateur !== "" ? [`${utilisateur}:F`] : []),
      "*S-1-5-32-544:F",
      "*S-1-5-18:F",
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

// ── Restauration de l'instantané de production (§D) ──────────────────────────
//
// Premier lancement packagé UNIQUEMENT : restaure `base.dump` (pg_dump -Fc de
// la base canonique, voir `scripts/snapshot-production.mjs`), conserve toutes
// les lignes source, vérifie les portes d'intégrité, puis
// écrit le marqueur `bootstrap.json`. Les lancements suivants trouvent le
// marqueur et ne restaurent JAMAIS — la base du cabinet n'est jamais
// remplacée en silence.

export interface ManifesteInstantane {
  readonly snapshot_version: string;
  readonly schema_version: string;
  readonly created_at: string;
  readonly database_version: string;
  readonly patient_count: number;
  readonly patients_total_source: number;
  readonly fixtures_exclues: number;
  readonly counts: Record<string, number>;
  readonly sha256: string;
}

function estEntierPositif(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * Valide la forme du manifeste — pure, testée unitairement. Tout écart =
 * refus (paquet incohérent), jamais de restauration approximative.
 */
export function validerManifeste(brut: unknown): ManifesteInstantane {
  if (typeof brut !== "object" || brut === null) throw new Error("Manifeste d'instantané illisible.");
  const m = brut as Record<string, unknown>;
  for (const cle of ["snapshot_version", "schema_version", "created_at", "database_version", "sha256"] as const) {
    const valeur: unknown = m[cle];
    if (typeof valeur !== "string" || valeur.trim() === "") {
      throw new Error(`Manifeste d'instantané invalide : champ « ${cle} » manquant.`);
    }
  }
  if (!estEntierPositif(m["patient_count"])) throw new Error("Manifeste d'instantané invalide : « patient_count » manquant.");
  if (typeof m["counts"] !== "object" || m["counts"] === null) {
    throw new Error("Manifeste d'instantané invalide : « counts » manquant.");
  }
  for (const [k, v] of Object.entries(m["counts"] as Record<string, unknown>)) {
    if (!/^(app|audit|auth)\.[a-z_][a-z_0-9]*$/.test(k) || !estEntierPositif(v)) {
      throw new Error("Manifeste d'instantané invalide : compteur ou nom de table invalide.");
    }
  }
  if (
    !estEntierPositif(m["patients_total_source"]) ||
    m["fixtures_exclues"] !== 0 ||
    m["patient_count"] !== m["patients_total_source"] ||
    m["patient_count"] !== (m["counts"] as Record<string, unknown>)["app.patients"]
  ) {
    throw new Error("Manifeste d'instantané refusé : préservation intégrale des patients source non prouvée.");
  }
  if (!/^[0-9a-f]{64}$/i.test(m["sha256"] as string)) {
    throw new Error("Manifeste d'instantané invalide : « sha256 » mal formé.");
  }
  return brut as ManifesteInstantane;
}

export interface ResultatRestauration {
  /** Une restauration a eu lieu pendant cet appel. */
  readonly restaure: boolean;
  /** Le marqueur existait déjà : base du cabinet préservée, rien touché. */
  readonly dejaFait: boolean;
  readonly patientCount?: number | undefined;
}

export function cheminMarqueurBootstrap(dossierRacineDonnees: string): string {
  return path.join(dossierRacineDonnees, "bootstrap.json");
}

function sha256Fichier(chemin: string): string {
  return createHash("sha256").update(readFileSync(chemin)).digest("hex");
}

function interroger(commande: Commande, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const p = spawn(commande.cmd, [...commande.args], { env: env ?? process.env });
    let sortie = "";
    let sortieErreur = "";
    p.stdout?.on("data", (d: Buffer) => {
      sortie += d.toString();
    });
    p.stderr?.on("data", (d: Buffer) => {
      sortieErreur += d.toString();
    });
    p.on("error", rejeter);
    p.on("exit", (code) => {
      if (code === 0) resoudre(sortie.trim());
      else rejeter(new Error(`${commande.cmd} a échoué (code ${code}) : ${sortieErreur.slice(0, 1000)}`));
    });
  });
}

export async function restaurerInstantaneSiPresent(
  bin: BinairesPg,
  cible: CibleProvisionnement,
  dossierInstantane: string,
  dossierRacineDonnees: string,
  options: { readonly clusterNeuf?: boolean } = {},
): Promise<ResultatRestauration> {
  const marqueur = cheminMarqueurBootstrap(dossierRacineDonnees);
  if (existsSync(marqueur)) return { restaure: false, dejaFait: true };

  const dump = path.join(dossierInstantane, "base.dump");
  const manifesteChemin = path.join(dossierInstantane, "manifest.json");
  if (!existsSync(dump) || !existsSync(manifesteChemin)) {
    // Développement ou paquet sans instantané : base vide provisionnée, on continue.
    return { restaure: false, dejaFait: false };
  }
  // L'appelant doit avoir exécuté initdb dans ce démarrage. Un marqueur
  // absent ne prouve jamais qu'un cluster existant est vide ou remplaçable.
  if (options.clusterNeuf !== true) {
    throw new Error("Restauration refusée : cluster non confirmé neuf ; il peut contenir déjà des données du cabinet. Aucun écrasement.");
  }
  const portes = path.join(dossierInstantane, "gates.sql");
  if (!existsSync(portes)) {
    throw new Error("Restauration de l'instantané impossible : gates.sql absent du paquet.");
  }

  let manifeste: ManifesteInstantane;
  try {
    manifeste = validerManifeste(JSON.parse(readFileSync(manifesteChemin, "utf8")) as unknown);
  } catch (e) {
    throw new Error(`Restauration de l'instantané impossible : ${(e as Error).message}`);
  }
  const empreinte = sha256Fichier(dump);
  if (empreinte.toLowerCase() !== manifeste.sha256.toLowerCase()) {
    throw new Error("Restauration de l'instantané impossible : l'empreinte sha256 de base.dump ne correspond pas au manifeste.");
  }

  const env = envPsql(cible);
  try {
    // Sécurité anti-effacement : sans marqueur mais avec des données issues
    // d'un import (legacy_id_map non vide), quelqu'un a supprimé le marqueur
    // — on refuse de restaurer plutôt que d'écraser le cabinet. `--clean`
    // ci-dessous n'est sûr QUE sur une base qui sort du provisionnement.
    const importExistants = await interroger(
      { cmd: bin.psql, args: ["-tAX", "-c", "SELECT count(*) FROM app.legacy_id_map"] },
      env,
    );
    if (!/^\d+$/.test(importExistants.trim())) throw new Error("Vérification des données existantes impossible : restauration refusée.");
    if (Number.parseInt(importExistants, 10) > 0) {
      throw new Error(
        "Restauration refusée : la base contient déjà des données du cabinet alors que le marqueur est absent. Ne jamais écraser — restaurer à la main si c'est volontaire.",
      );
    }
    // Restauration COMPLÈTE (schéma + données), propriétaires et privilèges
    // d'origine conservés (SANS --no-owner : les 98 portes DEFINER doivent
    // rester propriété d'app_gatekeeper, jamais de postgres — sinon elles
    // s'exécuteraient en superutilisateur). `--clean --if-exists` remplace le
    // schéma du provisionnement, vide par construction à ce stade.
    await executer(
      { cmd: bin.pgRestore, args: ["--clean", "--if-exists", "--exit-on-error", "--dbname", cible.base, dump] },
      env,
    );
    await executer(commandePsqlFichier(bin, portes), env);
    const mesures = Object.keys(manifeste.counts).map(
      (table) => `SELECT '${table}' || '|' || count(*)::text FROM ${table}`,
    ).join(" UNION ALL ");
    const comptesRestaures = await interroger(
      { cmd: bin.psql, args: ["-tAX", "-c", mesures] }, env,
    );
    const compteParTable = new Map(comptesRestaures.split(/\r?\n/).map((ligne) => {
      const [table, nombre] = ligne.split("|");
      return [table, Number(nombre)] as const;
    }));
    for (const [table, attendu] of Object.entries(manifeste.counts)) {
      if (compteParTable.get(table) !== attendu) {
        throw new Error(`Restauration incohérente : compteur de ${table} différent du manifeste.`);
      }
    }
    const compte = await interroger(
      { cmd: bin.psql, args: ["-tAX", "-c", "SELECT count(*) FROM app.patients"] },
      env,
    );
    if (Number.parseInt(compte, 10) !== manifeste.patient_count) {
      throw new Error(
        `Restauration de l'instantané incohérente : ${compte} patients en base contre ${manifeste.patient_count} au manifeste.`,
      );
    }
  } catch (e) {
    // Jamais de secret : envPsql ne transite que par l'environnement du fils.
    throw new Error(`Restauration de l'instantané de production : ${(e as Error).message}`.slice(0, 600));
  }

  mkdirSync(dossierRacineDonnees, { recursive: true });
  writeFileSync(
    marqueur,
    JSON.stringify(
      {
        snapshot_version: manifeste.snapshot_version,
        schema_version: manifeste.schema_version,
        patient_count: manifeste.patient_count,
        sha256: manifeste.sha256,
        restored_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return { restaure: true, dejaFait: false, patientCount: manifeste.patient_count };
}
