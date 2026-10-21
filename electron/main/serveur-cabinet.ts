import { execFile, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSecureContext } from "node:tls";
import { PORT_BACKEND } from "./config.js";
import { validerOrigineCabinet } from "./connexion-cabinet.js";
import { orchestrerDemarrage } from "./orchestrateur.js";
import { arreterBackend } from "./processus-backend.js";
import { journalDesktop } from "./journal-desktop.js";
import { demarrerProxyCabinet } from "./proxy-cabinet.js";
import { annoncerCabinet } from "./decouverte-cabinet.js";
import type { Socket } from "node:dgram";
import { X509Certificate } from "node:crypto";

const VARIABLES_SERVEUR = new Set([
  "ALEXA_HMAC_KEY", "ALEXA_NATIVE_AGENT_ENABLED", "ALEXA_LIVE_DEBUG", "ALEXA_LOCAL_VOICE", "ALEXA_VOICE_ASSETS", "ALEXA_VOICE_PACKAGES", "ALEXA_VOICE_PYTHON", "ALEXA_VOICE_WORKER_DIR",
  "COMM_WEBHOOK_SECRET", "COMPOSIO_API_KEY", "COMPOSIO_BASE_URL", "COMPOSIO_ENTITY_ID", "COMPOSIO_LIST_PATH",
  "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "GEMINI_API_KEY", "GEMINI_FREE_QUALIFICATION_FILE", "GOOGLE_API_KEY", "GROQ_API_KEY", "GROQ_FREE_QUALIFICATION_FILE",
  "INTENT_CLASSIFIER_ENABLED", "JARVIS_CHAT_MODEL", "JARVIS_ENABLED", "JARVIS_JEV_ENABLED", "JARVIS_RESOLUTION_ENABLED", "JARVIS_RESUME_MODEL", "JARVIS_STREAMING", "JARVIS_VOICE_ENABLED", "JEV_MODEL", "LLM_MODEL",
  "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_MODEL_TIMEOUT_MS", "OPENROUTER_QUALIFICATION_FILE", "STT_MODEL", "TTS_MODEL", "VOICE_PROVIDER",
]);

/** Fichier optionnel serveur uniquement; pas de variables de processus ou de base. */
export function lireVariablesServeur(texte: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const ligne of texte.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!ligne.trim() || ligne.trimStart().startsWith("#")) continue;
    const egal = ligne.indexOf("=");
    const nom = ligne.slice(0, egal).trim();
    if (egal < 1 || !VARIABLES_SERVEUR.has(nom) || Object.hasOwn(variables, nom)) throw new Error("CONFIGURATION_CABINET: variable serveur inconnue ou dupliquée dans private/runtime.env.");
    let valeur = ligne.slice(egal + 1).trim();
    if ((valeur.startsWith('"') && valeur.endsWith('"')) || (valeur.startsWith("'") && valeur.endsWith("'"))) valeur = valeur.slice(1, -1);
    variables[nom] = valeur;
  }
  return variables;
}

export function chargerServeurCabinet(fichier: string): { origin: string; resourcesDir: string; racineDonnees: string } {
  try {
    if (!path.isAbsolute(fichier) || path.basename(fichier) !== "clinic-server.json" || path.basename(path.dirname(fichier)) !== "private" || path.basename(path.dirname(path.dirname(fichier))).toLowerCase() !== "mindcare" || statSync(fichier).size > 8192) throw new Error("chemin");
    const config = JSON.parse(readFileSync(fichier, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
    if (!config || config.version !== 1 || typeof config.origin !== "string" || typeof config.resourcesDir !== "string" || !path.isAbsolute(config.resourcesDir) || Object.keys(config).some(key => !["version", "origin", "resourcesDir"].includes(key))) throw new Error("format");
    return { origin: validerOrigineCabinet(config.origin), resourcesDir: config.resourcesDir, racineDonnees: path.dirname(path.dirname(fichier)) };
  } catch { throw new Error("CONFIGURATION_CABINET: configuration privée du serveur absente ou invalide."); }
}

/** DPAPI LocalMachine, avec fichier protégé SYSTEM/Administrateurs par l'installation. */
export async function descelerSecretTls(fichier: string): Promise<string> {
  if (!path.isAbsolute(fichier) || !existsSync(fichier) || statSync(fichier).size > 8192) throw new Error("CERTIFICAT_CABINET: secret TLS absent ou invalide.");
  const executable = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const commande = "Add-Type -AssemblyName System.Security; try { $value = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:MINDCARE_TLS_SECRET_FILE), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($value)) } catch { exit 1 }";
  return await new Promise<string>((resolve, reject) => {
    execFile(executable, ["-NoProfile", "-NonInteractive", "-Command", commande], { env: { ...process.env, MINDCARE_TLS_SECRET_FILE: fichier }, windowsHide: true, timeout: 10_000, maxBuffer: 8192, encoding: "utf8" }, (error, stdout) => {
      if (error || !stdout || /[\r\n]/.test(stdout) || stdout.length > 512) reject(new Error("CERTIFICAT_CABINET: secret TLS illisible sur ce poste."));
      else resolve(stdout);
    });
  });
}

async function demarrerServeur(fichier: string): Promise<void> {
  const config = chargerServeurCabinet(fichier);
  if (existsSync(path.join(config.racineDonnees, "clinic-initialization.pending"))) throw new Error("Initialisation du cabinet interrompue; reprise contrôlée requise.");
  const prive = path.dirname(fichier);
  const pfx = readFileSync(path.join(prive, "clinic.pfx"));
  const passphrase = await descelerSecretTls(path.join(prive, "clinic-pfx-password.dpapi"));
  createSecureContext({ pfx, passphrase, minVersion: "TLSv1.2" });
  for (const nom of VARIABLES_SERVEUR) delete process.env[nom];
  const runtime = path.join(prive, "runtime.env");
  if (existsSync(runtime)) {
    if (statSync(runtime).size > 64 * 1024) throw new Error("CONFIGURATION_CABINET: runtime.env trop volumineux.");
    Object.assign(process.env, lireVariablesServeur(readFileSync(runtime, "utf8")));
  }
  delete process.env["MINDCARE_DATABASE_URL"];
  delete process.env["MINDCARE_START_URL"];
  delete process.env["NODE_OPTIONS"];
  process.env["MINDCARE_ELECTRON_ENV"] = "production";
  process.env["MC_HTTPS"] = "1";
  process.env["CORS_ORIGINS"] = config.origin;
  const journalDir = path.join(config.racineDonnees, "logs");
  mkdirSync(journalDir, { recursive: true });
  const journal = (message: string) => journalDesktop(journalDir, message);
  let backend: ChildProcess | undefined;
  let proxy: Awaited<ReturnType<typeof demarrerProxyCabinet>> | undefined;
  let annonce: Socket | undefined;
  let fermeture = false;
  const annulation = new AbortController();
  let demarrage: ReturnType<typeof orchestrerDemarrage> | undefined;
  const arreter = (code: number) => {
    if (fermeture) return;
    fermeture = true;
    annulation.abort();
    journal(code === 0 ? 'SERVER_STOP' : 'SERVER_FAILED');
    proxy?.closeAllConnections(); proxy?.close();
    annonce?.close();
    void (async () => {
      const resultat = await demarrage;
      await arreterBackend(backend ?? resultat?.backend);
    })().catch(() => journal('BACKEND_STOP_FAILED')).finally(() => { process.exit(code); });
    // Le service PostgreSQL persiste; il n'appartient pas à une fenêtre Electron.
  };
  process.once("SIGTERM", () => arreter(0)); process.once("SIGINT", () => arreter(0));
  journal('SERVER_START');
  demarrage = orchestrerDemarrage({
    resourcesPgsqlDir: path.join(config.resourcesDir, "pgsql"), serveurDir: path.join(config.resourcesDir, "serveur"),
    snapshotDir: path.join(config.resourcesDir, "snapshot"), dataDir: path.join(config.racineDonnees, "data"),
    fichierEnv: path.join(config.racineDonnees, "mindcare.env"), journalDir, dossierTemp: path.join(journalDir, "tmp"),
  }, { signal: annulation.signal, sauterPostgresEnDev: false, onEtat: etat => journal(`STATE_${etat}`), onBackendCrash: () => { journal('BACKEND_UNEXPECTED_EXIT'); arreter(1); } });
  const resultat = await demarrage;
  backend = resultat.backend;
  if (fermeture) return;
  if (resultat.etat.etat !== "READY") { journal('STARTUP_REFUSED'); arreter(1); return; }
  try {
    proxy = await demarrerProxyCabinet({ origin: config.origin, pfx, passphrase, upstreamPort: PORT_BACKEND });
    proxy.on("error", () => { journal('HTTPS_FAILED'); arreter(1); });
    try {
    const identity = JSON.parse(readFileSync(path.join(config.racineDonnees, "clinic-identity.json"), "utf8")) as {id: string};
    const publicCertificate = new X509Certificate(readFileSync(path.join(config.racineDonnees, "clinic-public.cer"))).toString();
    annonce = await annoncerCabinet({id:identity.id, origin:config.origin}, publicCertificate, () => {
      try {
        const file = path.join(prive, "clinic-invitation.json");
        if (statSync(file).size > 512) return undefined;
        const invitation = JSON.parse(readFileSync(file, "utf8")) as {secret:string; expiresAt:number};
        return invitation;
      } catch { return undefined; }
    });
    annonce.on("error", () => { journal('DISCOVERY_UNAVAILABLE'); annonce?.close(); annonce = undefined; });
    } catch { journal('DISCOVERY_UNAVAILABLE'); }
    journal('HTTPS_READY');
  } catch { journal('HTTPS_START_FAILED'); arreter(1); }
}

// Importable pour vérification sans lancer de service, créer de base ou lire de secret.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const fichier = process.env["MINDCARE_CLINIC_CONFIG"];
  if (!fichier) { console.error("CONFIGURATION_CABINET: lancer le serveur via la tâche Windows du cabinet."); process.exitCode = 1; }
  else void demarrerServeur(fichier).catch(() => { console.error(`${new Date().toISOString()} [cabinet] échec de configuration ou de certificat; consulter les journaux protégés.`); process.exitCode = 1; });
}
