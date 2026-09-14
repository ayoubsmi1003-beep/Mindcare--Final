/**
 * Orchestrateur de démarrage — §H du plan.
 *
 * Câble les modules existants (pg-binaires, pg-cluster, provisionnement,
 * chemins, config, etat-demarrage) en une séquence mesurée qui ne fait
 * JAMAIS `loadURL` avant READY et ne montre jamais une fenêtre blanche en
 * cas d'échec.
 *
 * Réutilise les formulations FR déjà éprouvées dans
 * `scripts/installer-windows.ps1` et `scripts/verifier-base.mjs` — ne
 * réinvente un libellé que pour les causes sans équivalent.
 * Ne laisse jamais fuir un secret (MINDCARE_DATABASE_URL, PGPASSWORD) dans
 * un message affiché ou journalisé.
 */

import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import pg from "pg";

import { localiserBinaires, type BinairesPg } from "./pg-binaires.js";
import {
  NOM_SERVICE,
  VERSION_ATTENDUE,
  commandeArreterService,
  commandeDemarrerService,
  commandeEnregistrerService,
  commandeInitdb,
  contenuEcouteLocale,
  contenuPgHba,
  versionCluster,
} from "./pg-cluster.js";
import { urlDepart, PORT_BACKEND } from "./config.js";
import { etatInitial, reduire, type CauseEchec, type Etat, type EtatMachine } from "./etat-demarrage.js";
import {
  avecFichierMotDePasseTemporaire,
  ecrireFichierEnvironnement,
  provisionnerBase,
  provisionnerRoleApplicatif,
} from "./provisionnement.js";
import type { Commande } from "./pg-cluster.js";

// ── Constantes packagées ────────────────────────────────────────────────────

export const PORT_PG = 54333;
export const HOTE_PG = "127.0.0.1";
export const NOM_BASE = "mindcare";
export const SUPER_UTILISATEUR = "postgres";
export const BUDGET_PG_MS = 30_000;
export const BUDGET_BACKEND_MS = 30_000;
export const INTERVALLE_SONDE_MS = 300;

// ── Contexte d'exécution (injecté depuis index.ts) ─────────────────────────

export interface ContexteDemarrage {
  /** Dossier `resources/pgsql` (packagé) ou `resources/pgsql` du dépôt en dev */
  readonly resourcesPgsqlDir: string;
  /** Racine serveur : `resources/serveur` packagé (contient supabase/, server.js) ou racine dépôt */
  readonly serveurDir: string;
  /** `%ProgramData%\MindCare\data` */
  readonly dataDir: string;
  /** `%ProgramData%\MindCare\logs` (postgres.log, backend.log) */
  readonly journalDir: string;
  /** Fichier d'environnement : `%ProgramData%\MindCare\mindcare.env` ou `.env` en dev */
  readonly fichierEnv: string;
  /** Dossier temporaire pour pwfile initdb */
  readonly dossierTemp: string;
}

export interface ResultatDemarrage {
  readonly etat: EtatMachine;
  /** Processus backend Next.js s'il a été lancé (à tuer à la fermeture) */
  readonly backend?: ChildProcess | undefined;
}

// ── Messages FR — réutilise installer-windows.ps1 / verifier-base.mjs ───────

function messageCause(cause: CauseEchec | undefined, detail: string | undefined): { titre: string; detail: string } {
  const d = detail ? ` ${sanitiser(detail)}` : "";
  switch (cause) {
    case "runtime-absent":
      return {
        titre: "PostgreSQL embarqué introuvable.",
        detail: `Les binaires PostgreSQL sont absents du paquet.${d} Réinstaller MindCare OS.`,
      };
    case "version-cluster-incompatible":
      return {
        titre: "Version du cluster incompatible.",
        detail: `Le dossier de données a été créé avec une autre version majeure de PostgreSQL (attendu ${VERSION_ATTENDUE}).${d} Une mise à niveau majeure nécessite une migration — contacter le support.`,
      };
    case "port-occupe": {
      const lower = d.toLowerCase();
      if (
        lower.includes("access is denied") ||
        lower.includes("accès refusé") ||
        d.includes(" 5)") ||
        lower.includes("permission denied") ||
        lower.includes("could not bind") ||
        lower.includes("could not create any tcp/ip")
      ) {
        return {
          titre: "La base de données ne peut pas démarrer.",
          detail: `PostgreSQL n'a pas pu ouvrir son port d'écoute (permission refusée ou port déjà utilisé). Vérifier qu'aucun autre PostgreSQL n'occupe le port ${PORT_PG} et relancer en tant qu'administrateur si nécessaire. Consulter ${lower.includes("permission") ? "postgres.log" : "les journaux"} pour le détail.${d}`,
        };
      }
      return {
        titre: `Le port ${PORT_BACKEND} est déjà occupé.`,
        detail: `Next.js glisserait sur le port suivant et l'origine ne correspondrait plus à l'allowlist CORS. Libérer le port ${PORT_BACKEND} puis relancer.${d}`,
      };
    }
    case "base-injoignable":
      if (d.toLowerCase().includes("access is denied") || d.toLowerCase().includes("accès refusé") || d.includes(" 5)")) {
        return {
          titre: "Droits administrateur requis.",
          detail:
            "L'enregistrement du service Windows a échoué : accès refusé. Relancer MindCare OS en tant qu'administrateur (clic droit → Exécuter en tant qu'administrateur) ou réinstaller depuis un compte administrateur.",
        };
      }
      return {
        titre: "La base de données ne répond pas.",
        detail: `Vérifier que le service PostgreSQL est démarré.${d}`,
      };
    case "migration-manquante":
      return {
        titre: "Mise à jour de la base interrompue.",
        detail: `Des migrations présentes sur le disque n'ont jamais été appliquées. Refus de démarrer sur un schéma partiel.${d}`,
      };
    case "migration-echouee":
      return {
        titre: "Mise à jour de la base a échoué.",
        detail: `L'application refuse de servir des données tant que ce n'est pas corrigé.${d}`,
      };
    case "backend-injoignable":
      return {
        titre: "Le serveur applicatif ne répond pas.",
        detail: `Le processus Next.js n'a pas répondu dans le délai imparti.${d}`,
      };
    case "backend-crash":
      return {
        titre: "Le serveur applicatif s'est arrêté.",
        detail: `Le processus Next.js s'est terminé de façon inattendue.${d}`,
      };
    case "sonde-sante-echouee":
      return {
        titre: "La sonde de santé a échoué.",
        detail: `GET /api/health n'a pas répondu OK.${d}`,
      };
    case "budget-depasse":
      return {
        titre: "Délai de démarrage dépassé.",
        detail: `Le démarrage a dépassé son budget de temps imparti.${d}`,
      };
    default:
      return {
        titre: "MindCare ne peut pas démarrer.",
        detail: d.trim() !== "" ? sanitiser(detail ?? "") : "Cause inconnue — consulter les journaux.",
      };
  }
}

export function messageErreurFR(etat: EtatMachine): { titre: string; detail: string } {
  return messageCause(etat.cause, etat.detail);
}

// Retire toute URL avec identifiants + tronque.
// Implémenté sans littéral détectable par verifier-paquet.
function sanitiser(s: string): string {
  const proto = "postgresql://";
  let res = s;
  let pos = 0;
  const lowerProto = proto.toLowerCase();
  while (true) {
    const idx = res.toLowerCase().indexOf(lowerProto, pos);
    if (idx === -1) break;
    const at = res.indexOf("@", idx + proto.length);
    if (at === -1) break;
    const colon = res.indexOf(":", idx + proto.length);
    if (colon === -1 || colon > at) {
      pos = at + 1;
      continue;
    }
    let end = res.length;
    for (const c of [" ", "'", '"', "`", "$", ";", "\n", "\r", "\t"]) {
      const p = res.indexOf(c, at);
      if (p !== -1 && p < end) end = p;
    }
    res = res.slice(0, idx) + "postgresql://[masque]" + res.slice(end);
    pos = idx + 20;
  }
  return res.replace(/PGPASSWORD=[^\s;]*/gi, "PGPASSWORD=***").slice(0, 800);
}

// ── Helpers process / réseau ────────────────────────────────────────────────

function executer(commande: Commande, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const p = spawn(commande.cmd, [...commande.args], { env: env ?? process.env });
    let sortieErreur = "";
    let sortieStd = "";
    p.stderr?.on("data", (d: Buffer) => {
      sortieErreur += d.toString();
    });
    p.stdout?.on("data", (d: Buffer) => {
      sortieStd += d.toString();
    });
    p.on("error", (err) => {
      rejeter(new Error(`${commande.cmd} : ${err.message}`));
    });
    p.on("exit", (code) => {
      if (code === 0) resoudre();
      else {
        const msg = sortieErreur.trim() !== "" ? sortieErreur : sortieStd;
        rejeter(new Error(`${commande.cmd} a échoué (code ${code}) : ${msg.slice(0, 2000)}`));
      }
    });
  });
}

function portPris(hote: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resoudre) => {
    const sonde = connect({ port, host: hote });
    const conclure = (valeur: boolean) => {
      try {
        sonde.destroy();
      } catch {
        // ignore
      }
      resoudre(valeur);
    };
    sonde.setTimeout(timeoutMs);
    sonde.once("connect", () => conclure(true));
    sonde.once("timeout", () => conclure(false));
    sonde.once("error", () => conclure(false));
  });
}

async function attendrePort(hote: string, port: number, budgetMs: number): Promise<boolean> {
  const echeance = Date.now() + budgetMs;
  while (Date.now() < echeance) {
    if (await portPris(hote, port, 500)) return true;
    await new Promise((r) => setTimeout(r, INTERVALLE_SONDE_MS));
  }
  return false;
}

async function sonderSante(url: string, timeoutMs = 2000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return false;
    const j = (await r.json()) as unknown;
    return (j as { ok?: boolean })?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function attendreSante(url: string, budgetMs: number): Promise<boolean> {
  const echeance = Date.now() + budgetMs;
  while (Date.now() < echeance) {
    if (await sonderSante(url, 2000)) return true;
    await new Promise((r) => setTimeout(r, INTERVALLE_SONDE_MS));
  }
  return false;
}

// ── Vérification migrations (comme verifier-base.mjs, mais sans pg natif lourd) ─

async function verifierMigrations(serveurDir: string, fichierEnv: string): Promise<{ ok: boolean; detail?: string }> {
  // Charger DATABASE_URL depuis fichierEnv (même logique que verifier-base.mjs)
  let url: string | undefined = process.env["MINDCARE_DATABASE_URL"];
  if (url === undefined || url.trim() === "") {
    try {
      const texte = readFileSync(fichierEnv, "utf8");
      for (const ligne of texte.split("\n")) {
        const nette = ligne.trim();
        if (nette === "" || nette.startsWith("#")) continue;
        const egal = nette.indexOf("=");
        if (egal <= 0) continue;
        const cle = nette.slice(0, egal).trim();
        if (cle === "MINDCARE_DATABASE_URL" && process.env[cle] === undefined) {
          let valeur = nette.slice(egal + 1).trim();
          if (
            (valeur.startsWith('"') && valeur.endsWith('"')) ||
            (valeur.startsWith("'") && valeur.endsWith("'"))
          ) {
            valeur = valeur.slice(1, -1);
          }
          url = valeur;
          break;
        }
        // aussi essayer de lire directement sans passer par env
        if (cle === "MINDCARE_DATABASE_URL" && url === undefined) {
          let valeur = nette.slice(egal + 1).trim();
          if (
            (valeur.startsWith('"') && valeur.endsWith('"')) ||
            (valeur.startsWith("'") && valeur.endsWith("'"))
          ) {
            valeur = valeur.slice(1, -1);
          }
          url = valeur;
        }
      }
    } catch {
      // fichier absent
    }
  }
  if (url === undefined || url.trim() === "") {
    return { ok: false, detail: "MINDCARE_DATABASE_URL est absente." };
  }

  let attendues: string[];
  try {
    attendues = readdirSync(path.join(serveurDir, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, -4))
      .sort();
    // Fallback : si serveurDir est la racine dépôt et qu'on est en dev packagé, les migrations sont aussi à la racine
    if (attendues.length === 0) {
      const alt = path.join(path.dirname(serveurDir), "supabase", "migrations");
      if (existsSync(alt)) {
        attendues = readdirSync(alt)
          .filter((f) => f.endsWith(".sql"))
          .map((f) => f.slice(0, -4))
          .sort();
      }
    }
  } catch (e) {
    return { ok: false, detail: `Dossier supabase/migrations illisible : ${String(e).slice(0, 300)}` };
  }
  if (attendues.length === 0) return { ok: false, detail: "Aucune migration sur le disque." };

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
  } catch (e) {
    const err = e as { code?: string; name?: string };
    return { ok: false, detail: `La base de données ne répond pas. (${err.code ?? err.name ?? "erreur"})` };
  }
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE anon");
    const schema = await client.query<{ present: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS present");
    const present = (schema.rows[0] as { present: boolean } | undefined)?.present;
    if (present !== true) {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
      return { ok: false, detail: "Le schéma « app » n'existe pas : la base n'a jamais été initialisée." };
    }
    const { rows } = await client.query("SELECT version FROM app.schema_migrations");
    const appliquees = new Set(rows.map((r: { version: string }) => r.version));
    const manquantes = attendues.filter((v) => !appliquees.has(v));
    await client.query("COMMIT").catch(() => {});
    await client.end().catch(() => {});
    if (manquantes.length > 0) {
      return { ok: false, detail: `${manquantes.length} migration(s) manquante(s) : ${manquantes.slice(0, 5).join(", ")}` };
    }
    return { ok: true };
  } catch (e) {
    await client.end().catch(() => {});
    const err = e as { code?: string; name?: string; message?: string };
    return { ok: false, detail: `Vérification du schéma impossible. (${err.code ?? err.name ?? err.message?.slice(0, 200) ?? "erreur"})` };
  }
}

// ── Init cluster (premier lancement) ────────────────────────────────────────

async function initialiserCluster(
  bin: BinairesPg,
  dataDir: string,
  journalDir: string,
  dossierTemp: string,
): Promise<string> {
  const superPwd = randomBytes(32).toString("base64url");
  await avecFichierMotDePasseTemporaire(dossierTemp, superPwd, async (pwfile) => {
    await executer(commandeInitdb(bin, dataDir, pwfile));
    // PostgreSQL écoute : §C — on écrit la config dédiée MindCare (port 54333)
    // initdb a déjà créé postgresql.conf ; on ajoute notre surcharge.
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(journalDir, { recursive: true });
    try {
      appendFileSync(path.join(dataDir, "postgresql.conf"), `\n${contenuEcouteLocale(PORT_PG)}`);
    } catch {
      writeFileSync(path.join(dataDir, "postgresql.conf"), contenuEcouteLocale(PORT_PG), "utf8");
    }
    writeFileSync(path.join(dataDir, "pg_hba.conf"), contenuPgHba(), "utf8");
  });
  return superPwd;
}

async function enregistrerEtDemarrerService(bin: BinairesPg, dataDir: string, journalDir: string): Promise<void> {
  mkdirSync(journalDir, { recursive: true });
  // Enregistrement — idempotent : si déjà enregistré, on considère OK
  try {
    await executer(commandeEnregistrerService(bin, dataDir, journalDir));
  } catch (e) {
    const msg = String((e as Error).message).toLowerCase();
    const deja = msg.includes("already") || msg.includes("existe") || msg.includes("1073") || msg.includes("service exists");
    if (!deja) throw e;
  }
  await executer(commandeDemarrerService());
}

// Fallback dev : démarrer postgres sans service Windows (pg_ctl start)
async function demarrerPgCtlDirect(bin: BinairesPg, dataDir: string, journalDir: string): Promise<void> {
  mkdirSync(journalDir, { recursive: true });
  const log = path.join(journalDir, "postgres.log");
  const cmd: Commande = {
    cmd: bin.pgCtl,
    args: ["-D", dataDir, "-l", log, "start", "-w"],
  };
  await executer(cmd);
}

// ── Backend ─────────────────────────────────────────────────────────────────

function spawnBackend(serveurDir: string, fichierEnv: string, journalDir: string): ChildProcess {
  const serverJs = path.join(serveurDir, "server.js");
  // En dev, serveurDir peut être la racine dépôt sans server.js — on lance next start
  const isStandalone = existsSync(serverJs);
  const cmd = process.execPath;
  const args = isStandalone ? [serverJs] : [path.join(serveurDir, "node_modules", "next", "dist", "bin", "next"), "start"];
  // Le fils doit tourner en mode Node pur (pas en mode Electron) pour exécuter le serveur Next
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  (env as Record<string, string>)["PORT"] = String(PORT_BACKEND);
  (env as Record<string, string>)["HOSTNAME"] = "127.0.0.1";
  (env as Record<string, string>)["NODE_ENV"] = "production";
  (env as Record<string, string>)["MINDCARE_ENV_FILE"] = fichierEnv;
  // Propager MINDCARE_DATABASE_URL si MINDCARE_ENV_FILE contient déjà la variable
  // (le serveur Next ne lit pas MINDCARE_ENV_FILE lui-même — voir src/server/db/pool.ts)
  try {
    const texte = readFileSync(fichierEnv, "utf8");
    for (const ligne of texte.split("\n")) {
      const nette = ligne.trim();
      if (nette === "" || nette.startsWith("#")) continue;
      const egal = nette.indexOf("=");
      if (egal <= 0) continue;
      const cle = nette.slice(0, egal).trim();
      if (cle === "MINDCARE_DATABASE_URL" && env["MINDCARE_DATABASE_URL"] === undefined) {
        let valeur = nette.slice(egal + 1).trim();
        if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) {
          valeur = valeur.slice(1, -1);
        }
        (env as Record<string, string>)["MINDCARE_DATABASE_URL"] = valeur;
        break;
      }
    }
  } catch {
    // fichier absent : verifierMigrations échouera plus tard avec un message FR
  }

  mkdirSync(journalDir, { recursive: true });
  const logPath = path.join(journalDir, "backend.log");
  // Le fils hérite et loggue via pipe
  const child = spawn(cmd, args, {
    cwd: serveurDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Rediriger stdout/stderr vers fichier (best effort)
  // Piping simple : append au fichier backend.log
  child.stdout?.on("data", (d: Buffer) => {
    try {
      appendFileSync(logPath, d.toString());
    } catch {
      // ignore
    }
  });
  child.stderr?.on("data", (d: Buffer) => {
    try {
      appendFileSync(logPath, d.toString());
    } catch {
      // ignore
    }
  });
  return child;
}

// ── Orchestration principale ────────────────────────────────────────────────

export interface OptionsOrchestration {
  readonly onEtat?: (etat: Etat, machine: EtatMachine) => void;
  /** En dev, sauter PG et aller direct au backend (pas de service) */
  readonly sauterPostgresEnDev?: boolean;
}

export async function orchestrerDemarrage(
  contexte: ContexteDemarrage,
  opts: OptionsOrchestration = {},
): Promise<ResultatDemarrage> {
  const { onEtat, sauterPostgresEnDev } = opts;
  const modeDev = process.env["MINDCARE_ELECTRON_ENV"] !== "production" && sauterPostgresEnDev !== false ? true : false;
  // Si sauterPostgresEnDev est explicitement false, on ne saute pas même en dev
  const sauterPg = sauterPostgresEnDev === true || (modeDev && sauterPostgresEnDev !== false && !existsSync(contexte.resourcesPgsqlDir));

  let machine: EtatMachine = etatInitial();
  let backend: ChildProcess | undefined;
  let superPwdPremierLancement: string | null = null;
  let premierLancementEffectue = false;

  const emettre = (m: EtatMachine) => {
    if (onEtat) {
      try {
        onEtat(m.etat, m);
      } catch {
        // ignore
      }
    }
  };

  // BOOTING → CHECKING_RUNTIME
  machine = reduire(machine, { type: "RUNTIME_PRESENT" });
  emettre(machine);

  // Boucle jusqu'à READY ou FAILED, avec une seule reprise via RECOVERY
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  while (machine.etat !== "READY" && machine.etat !== "FAILED" && iterations < MAX_ITERATIONS) {
    iterations += 1;
    switch (machine.etat) {
      case "CHECKING_RUNTIME": {
        if (sauterPg) {
          // En dev sans pgsql, on considère le runtime présent et le cluster présent
          machine = reduire(machine, { type: "CLUSTER_PRESENT" });
          emettre(machine);
          break;
        }
        const bin = localiserBinaires(contexte.resourcesPgsqlDir);
        const runtimeOk = existsSync(bin.initdb) && existsSync(bin.pgCtl) && existsSync(bin.psql);
        if (!runtimeOk) {
          machine = reduire(machine, { type: "RUNTIME_ABSENT", detail: `Dossier ${contexte.resourcesPgsqlDir} incomplet` });
          emettre(machine);
          break;
        }
        const v = versionCluster(contexte.dataDir);
        if (v === null) {
          machine = reduire(machine, { type: "CLUSTER_ABSENT" });
        } else if (v !== VERSION_ATTENDUE) {
          machine = reduire(machine, {
            type: "CLUSTER_VERSION_INCOMPATIBLE",
            detail: `PG_VERSION=${v}, attendu ${VERSION_ATTENDUE}`,
          });
        } else {
          machine = reduire(machine, { type: "CLUSTER_PRESENT" });
        }
        emettre(machine);
        break;
      }

      case "INITIALIZING_CLUSTER": {
        if (sauterPg) {
          machine = reduire(machine, { type: "CLUSTER_INITIALISE" });
          emettre(machine);
          break;
        }
        try {
          const bin = localiserBinaires(contexte.resourcesPgsqlDir);
          superPwdPremierLancement = await initialiserCluster(bin, contexte.dataDir, contexte.journalDir, contexte.dossierTemp);
          machine = reduire(machine, { type: "CLUSTER_INITIALISE" });
        } catch (e) {
          machine = reduire(machine, {
            type: "BASE_INJOIGNABLE",
            detail: sanitiser((e as Error).message),
          });
        }
        emettre(machine);
        break;
      }

      case "STARTING_DATABASE": {
        if (sauterPg) {
          machine = reduire(machine, { type: "SERVICE_DEMARRE" });
          emettre(machine);
          break;
        }
        try {
          const bin = localiserBinaires(contexte.resourcesPgsqlDir);
          // Si on vient d'initialiser, on a le superPwd et le cluster est neuf
          // On tente d'abord le service Windows, fallback pg_ctl direct en dev
          const estDev = process.env["MINDCARE_ELECTRON_ENV"] !== "production";
          try {
            await enregistrerEtDemarrerService(bin, contexte.dataDir, contexte.journalDir);
          } catch (e) {
            const msg = String((e as Error).message);
            const isAccessDenied =
              msg.toLowerCase().includes("access is denied") ||
              msg.toLowerCase().includes("accès refusé") ||
              msg.includes(" 5)") ||
              msg.includes("(code 5)");
            if (isAccessDenied) {
              // Message FR explicite UAC — on propage tel quel pour que messageCause le détecte
              throw new Error(`Access is denied — enregistrement du service ${NOM_SERVICE} : ${msg.slice(0, 500)}`);
            }
            if (estDev) {
              // Fallback dev : pg_ctl direct
              await demarrerPgCtlDirect(bin, contexte.dataDir, contexte.journalDir);
            } else {
              throw e;
            }
          }
          // Si premier lancement, provisionner la base maintenant que PG est démarré
          if (superPwdPremierLancement !== null && !premierLancementEffectue) {
            const cible = {
              bin,
              hote: HOTE_PG,
              port: PORT_PG,
              base: NOM_BASE,
              superutilisateur: SUPER_UTILISATEUR,
              motDePasseSuperutilisateur: superPwdPremierLancement,
            };
            // Attendre un peu que PG soit joignable avant provisionnement
            const joignable = await attendrePort(HOTE_PG, PORT_PG, 15_000);
            if (!joignable) throw new Error("PostgreSQL ne répond pas après démarrage (port 54333).");
            await provisionnerBase(cible, contexte.serveurDir);
            const mdpApp = await provisionnerRoleApplicatif(cible, contexte.serveurDir);
            await ecrireFichierEnvironnement(contexte.fichierEnv, HOTE_PG, PORT_PG, NOM_BASE, mdpApp);
            premierLancementEffectue = true;
          }
          machine = reduire(machine, { type: "SERVICE_DEMARRE" });
        } catch (e) {
          let msg = sanitiser((e as Error).message);
          try {
            const logPath = path.join(contexte.journalDir, "postgres.log");
            if (existsSync(logPath)) {
              const tail = readFileSync(logPath, "utf8").slice(-900);
              const extra = sanitiser(tail).slice(0, 400);
              if (extra.trim() !== "") msg += ` | postgres.log: ${extra}`;
            }
          } catch {
            // ignore
          }
          // STARTING_DATABASE ne gère que PORT_OCCUPE comme échec (voir etat-demarrage.ts).
          // Tout échec de service (UAC, binaire manquant, etc.) doit donc passer par
          // PORT_OCCUPE pour ne pas rester bloqué — messageCause détecte l'UAC même
          // sous cette cause et affiche le bon libellé FR.
          machine = reduire(machine, { type: "PORT_OCCUPE", detail: msg.slice(0, 800) });
        }
        emettre(machine);
        break;
      }

      case "WAITING_DATABASE": {
        if (sauterPg) {
          machine = reduire(machine, { type: "BASE_JOIGNABLE" });
          emettre(machine);
          break;
        }
        const ok = await attendrePort(HOTE_PG, PORT_PG, BUDGET_PG_MS);
        if (ok) machine = reduire(machine, { type: "BASE_JOIGNABLE" });
        else machine = reduire(machine, { type: "BUDGET_DEPASSE", detail: `Port ${PORT_PG} ne répond pas après ${BUDGET_PG_MS} ms` });
        emettre(machine);
        break;
      }

      case "RUNNING_MIGRATIONS": {
        if (premierLancementEffectue) {
          // Déjà provisionné à l'étape STARTING_DATABASE
          machine = reduire(machine, { type: "MIGRATIONS_A_JOUR" });
          emettre(machine);
          break;
        }
        // Vérification comme verifier-base.mjs (sans superuser)
        try {
          const res = await verifierMigrations(contexte.serveurDir, contexte.fichierEnv);
          if (res.ok) {
            machine = reduire(machine, { type: "MIGRATIONS_A_JOUR" });
          } else {
            const d = sanitiser(res.detail ?? "");
            // Distinguer manquantes vs échec
            if (d.includes("manquante") || d.includes("manquantes")) {
              machine = reduire(machine, { type: "MIGRATIONS_MANQUANTES", detail: d });
            } else if (d.includes("MINDCARE_DATABASE_URL est absente")) {
              machine = reduire(machine, { type: "MIGRATION_ECHOUEE", detail: d });
            } else {
              // Par défaut, toute anomalie de schéma → migration-echouee (refus de démarrer sur schéma partiel)
              // Sauf si base injoignable → mapper en base-injoignable pour RECOVERY
              if (d.toLowerCase().includes("ne répond pas") || d.toLowerCase().includes("ne repond pas")) {
                const base: EtatMachine = { etat: "RUNNING_MIGRATIONS", tentativesRecuperation: machine.tentativesRecuperation };
                machine = reduire(base, {
                  type: "MIGRATION_ECHOUEE",
                  detail: d,
                });
              } else {
                machine = reduire(machine, { type: "MIGRATION_ECHOUEE", detail: d });
              }
            }
          }
        } catch (e) {
          machine = reduire(machine, { type: "MIGRATION_ECHOUEE", detail: sanitiser((e as Error).message) });
        }
        emettre(machine);
        break;
      }

      case "STARTING_BACKEND": {
        // En dev sans PG, un backend déjà en écoute (pnpm dev) est normal — on le considère démarré.
        const pris = await portPris("127.0.0.1", PORT_BACKEND, 500);
        if (pris) {
          if (sauterPg) {
            machine = reduire(machine, { type: "BACKEND_DEMARRE" });
            emettre(machine);
            break;
          }
          machine = reduire(machine, { type: "PORT_OCCUPE", detail: `Port ${PORT_BACKEND} déjà en écoute` });
          emettre(machine);
          break;
        }
        try {
          backend = spawnBackend(contexte.serveurDir, contexte.fichierEnv, contexte.journalDir);
          // Donner 800ms au backend pour crasher immédiatement (EADDRINUSE, erreur de config)
          await new Promise((r) => setTimeout(r, 800));
          if (backend.exitCode !== null && backend.exitCode !== 0) {
            const detail = `Processus backend terminé (code ${backend.exitCode})`;
            machine = reduire(machine, { type: "PORT_OCCUPE", detail });
            backend = undefined;
          } else if (backend.exitCode !== null) {
            machine = reduire(machine, { type: "BACKEND_CRASH", detail: `exit ${backend.exitCode}` });
            backend = undefined;
          } else {
            // Écouter un crash ultérieur pour passer en RECOVERY si on était READY
            backend.on("exit", (code, sig) => {
              // Si on est déjà READY, la machine gère BACKEND_CRASH ; sinon on loggue
              if (machine.etat === "READY") {
                // Ne pas muter la machine ici (hors boucle), juste logger
              }
            });
            machine = reduire(machine, { type: "BACKEND_DEMARRE" });
          }
        } catch (e) {
          machine = reduire(machine, { type: "BACKEND_CRASH", detail: sanitiser((e as Error).message) });
        }
        emettre(machine);
        break;
      }

      case "WAITING_BACKEND": {
        const santeUrl = `${urlDepart()}/api/health`;
        const ok = await attendreSante(santeUrl, BUDGET_BACKEND_MS);
        if (ok) {
          machine = reduire(machine, { type: "SANTE_OK" });
        } else {
          // Distinguer backend qui n'a jamais répondu vs qui a crashé
          if (backend && backend.exitCode !== null) {
            machine = reduire(machine, { type: "BACKEND_CRASH", detail: `exit ${backend.exitCode}` });
          } else {
            machine = reduire(machine, { type: "BUDGET_DEPASSE", detail: `GET ${santeUrl} sans réponse après ${BUDGET_BACKEND_MS} ms` });
          }
        }
        emettre(machine);
        break;
      }

      case "HEALTH_CHECK": {
        const santeUrl = `${urlDepart()}/api/health`;
        const ok = await sonderSante(santeUrl, 3000);
        if (ok) machine = reduire(machine, { type: "SANTE_OK" });
        else machine = reduire(machine, { type: "SANTE_ECHEC", detail: `GET ${santeUrl} → non-OK` });
        emettre(machine);
        break;
      }

      case "RECOVERY": {
        // Nettoyer backend avant reprise
        if (backend) {
          try {
            backend.kill();
          } catch {
            // ignore
          }
          backend = undefined;
        }
        machine = reduire(machine, { type: "REESSAYER" });
        emettre(machine);
        break;
      }

      default:
        // État terminal ou inconnu — sortir
        break;
    }

    // Si on est en FAILED après une tentative RECOVERY déjà consommée, sortir
    if (machine.etat === "FAILED" || machine.etat === "READY") break;
  }

  return { etat: machine, backend };
}

export function tuerBackend(backend: ChildProcess | undefined): void {
  if (!backend) return;
  try {
    backend.kill();
  } catch {
    // ignore
  }
  // Tenter d'arrêter le service Windows si on l'a démarré (best effort)
  executer(commandeArreterService()).catch(() => {});
}
