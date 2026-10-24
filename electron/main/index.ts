/**
 * Processus principal Electron — étapes 1 à 10 du plan.
 *
 * Étape 1 garantissait déjà : fenêtre sécurisée, verrou mono-instance,
 * garde navigation, permissions restreintes, preload CommonJS.
 * Étapes 4-10 (câblage) : avant tout `loadURL`, traverse la machine à états
 * §H (BOOTING → READY) en branchant les modules existants — PostgreSQL
 * embarqué (pg-cluster/pg-binaires), provisionnement, backend Next.js
 * autonome, sonde /api/health — puis seulement `loadURL`. Aucun `setTimeout`
 * comme synchronisation : chaque transition est un événement mesuré.
 *
 * Fenêtre principale cachée (`show:false`) pendant tout le démarrage.
 * Sur READY : `loadURL` puis `show` à `ready-to-show`.
 * Sur FAILED : fenêtre d'erreur FR actionnable, jamais une fenêtre blanche.
 *
 * ═══ CE QUE CETTE COQUILLE GARANTIT ET NE DOIT JAMAIS PERDRE ═══════════════
 * `contextIsolation` + `sandbox` + `nodeIntegration:false` : le renderer
 * reste un client NON FIABLE (règle 4). Aucune URL de base de données, aucun
 * secret ne transite vers le renderer.
 */

import { app, BrowserWindow, ipcMain, net, Notification, session, shell } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { hostname } from 'node:os';
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configurerOrigineCabinet, urlDepart } from "./config.js";
import { attendreCabinet, chargerConnexionCabinet, type ConnexionCabinet } from "./connexion-cabinet.js";
import { attendreConnexionCabinet, connecterBureauCabinet, reconnecterPoste, surveillerCabinet } from "./bureau-cabinet.js";
import { dossierDonnees, fichierEnvironnement, modeCourant } from "./chemins.js";
import { journalDesktop } from "./journal-desktop.js";
import { garantirInstallation } from "./installation-auto.js";
import {
  messageErreurFR,
  orchestrerDemarrage,
  tuerBackend,
  type ContexteDemarrage,
} from "./orchestrateur.js";

const REPERTOIRE_ICI = path.dirname(fileURLToPath(import.meta.url));
// Windows 10/11 n'affiche une notification native que si l'application porte un
// AppUserModelID stable, identique à `appId` d'electron-builder. Sans lui, le
// toast est silencieusement ignoré sur un poste installé — pas d'erreur, pas de
// notification, et l'accueil ne voit rien alors que le médecin a cliqué.
app.setAppUserModelId("os.mindcare.cabinet");
/**
 * Le PC médecin se joint TOUJOURS par son propre nom : le certificat est émis
 * pour `<nom-du-PC>`, et c'est cette identité qui est épinglée.
 *
 * ⚠️ L'ancienne version ne posait cette règle que si `desktop.json` existait
 * déjà en mode hôte. Au TOUT PREMIER démarrage — celui où l'on choisit «
 * Utiliser ce PC comme PC médecin » — le fichier n'existe pas encore : aucune
 * règle n'était posée, la résolution du nom pouvait échouer (routeur sans DNS
 * local, LLMNR désactivé), et l'écran restait sur « Connexion interrompue »
 * alors que le service tournait. On la pose donc dès le lancement, sans
 * condition de configuration.
 *
 * Inerte sur un poste d'accueil : il ne se connecte jamais à son propre nom.
 */
if (app.isPackaged) {
  const nomLocal = hostname();
  if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(nomLocal)) {
    app.commandLine.appendSwitch('host-resolver-rules', `MAP ${nomLocal} 127.0.0.1`);
  }
}

let fenetrePrincipale: BrowserWindow | null = null;
let fenetreErreur: BrowserWindow | null = null;
let processusBackend: ChildProcess | undefined;
/** Dernier échec de chargement de la trame principale (WS-3) — sinon null. */
let echecChargementPrincipal: string | null = null;
/** Contexte de démarrage courant (journaux, instantané) pour les canaux IPC. */
let contexteCourant: ContexteDemarrage | null = null;
/** Vrai une fois READY + renderer affiché — arme le rappel de crash backend. */
let applicationPrete = false;
let connexionCabinet: ConnexionCabinet = { mode: "standalone" };
let deploymentAutomatique = false;
let fermetureEnCours = false;
let demarrageEnCours = false;
let erreurLocale = false;
const annulationDemarrage = new AbortController();
let travailDemarrage: Promise<void> | undefined;
const diagnostic = (code: string, value?: number | boolean) => journalDesktop(app.getPath('userData'), code, value);
diagnostic('STARTUP', app.isPackaged);
app.on('child-process-gone', (_event, details) => diagnostic('CHILD_PROCESS_GONE', details.exitCode));
process.on('uncaughtExceptionMonitor', (_error, origin) => diagnostic(origin === 'unhandledRejection' ? 'UNHANDLED_REJECTION' : 'UNCAUGHT_EXCEPTION'));

const verrouObtenu = app.requestSingleInstanceLock();
if (!verrouObtenu) {
  app.quit();
} else {
  app.on("second-instance", () => {
    diagnostic('SECOND_INSTANCE');
    const cible = fenetreErreur ?? fenetrePrincipale;
    if (cible) {
      if (cible.isMinimized()) cible.restore();
      cible.focus();
    }
  });

  app.whenReady().then(async () => {
    // Un lancement depuis le Bureau, une clé USB ou le dossier de build ne peut
    // pas héberger le serveur : Windows refuserait la configuration. On propose
    // donc une installation vers un emplacement protégé AVANT toute fenêtre.
    // `false` = copie effectuée (ou refus) : cette instance s'arrête.
    if (!(await garantirInstallation())) {
      app.quit();
      return;
    }
    void lancerOrchestrationEtFenetre();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void lancerOrchestrationEtFenetre();
  });

  app.on("before-quit", (event) => {
    if (fermetureEnCours) return;
    fermetureEnCours = true;
    diagnostic('BEFORE_QUIT');
    annulationDemarrage.abort();
    if (!processusBackend && !travailDemarrage) return;
    event.preventDefault();
    void (async () => {
      await travailDemarrage?.catch(() => {});
      await tuerBackend(processusBackend);
    })().catch(() => console.error('[mindcare] BACKEND_STOP_FAILED')).finally(() => { processusBackend = undefined; app.quit(); });
  });
}

function construireContexte(): ContexteDemarrage {
  const racineDepot = path.resolve(REPERTOIRE_ICI, "..", "..");
  const programData = process.env["ProgramData"] ?? (process.platform === "win32" ? "C:\\ProgramData" : "/tmp");
  const estPackage = app.isPackaged;
  const mode = modeCourant();
  // En packagé : resources/pgsql et resources/serveur à côté de app.asar
  // En dev : resources/pgsql du dépôt, serveur = racine dépôt (supabase/ à la racine)
  const resourcesPgsqlDir = estPackage
    ? path.join(process.resourcesPath, "pgsql")
    : path.join(racineDepot, "resources", "pgsql");
  const serveurDir = estPackage ? path.join(process.resourcesPath, "serveur") : racineDepot;
  const dataDir = dossierDonnees(programData, "data");
  const journalDir = dossierDonnees(programData, "logs");
  // En packagé, le fichier d'environnement est TOUJOURS celui du cabinet, jamais le .env du dépôt
  // (même si MINDCARE_ELECTRON_ENV n'est pas posée, ce qui est le cas d'une installation réelle)
  const fichierEnv = fichierEnvironnement(estPackage ? "production" : mode, racineDepot, programData);
  const dossierTemp = path.join(journalDir, "tmp");
  // Instantané de production (§D) : ressource empaquetée à côté de serveur/.
  const snapshotDir = estPackage
    ? path.join(process.resourcesPath, "snapshot")
    : path.join(racineDepot, "resources", "snapshot");
  // En dev non packagé mais avec MINDCARE_ELECTRON_ENV=production, on reste en mode prod packagé simulé
  // → ne pas écraser les chemins ci-dessus qui sont déjà corrects via `estPackage`
  return { resourcesPgsqlDir, serveurDir, dataDir, journalDir, fichierEnv, dossierTemp, snapshotDir };
}

function creerFenetrePrincipaleCachee(): BrowserWindow {
  posePermissionsRestreintes();

  const fenetre = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    // Fond de la charte pendant le chargement : jamais de flash blanc (WS-7).
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(REPERTOIRE_ICI, "..", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // ⚠️ INDISPENSABLE À L'ALERTE D'ACCUEIL. Chromium gèle les minuteurs d'une
      // fenêtre réduite ; le flux SSE et le carillon cesseraient de fonctionner
      // dès que l'accueil réduit MindCare — c'est-à-dire exactement quand
      // l'alerte doit passer. Le renderer reste non fiable : ce réglage ne
      // change que la cadence, jamais la surface de privilèges.
      backgroundThrottling: false,
    },
  });
  diagnostic('WINDOW_CREATED', fenetre.id);
  fenetre.on('show', () => diagnostic('WINDOW_SHOW', fenetre.id));
  fenetre.on('hide', () => diagnostic('WINDOW_HIDE', fenetre.id));
  fenetre.on('close', () => diagnostic('WINDOW_CLOSE', fenetre.id));
  fenetre.on('closed', () => diagnostic('WINDOW_CLOSED', fenetre.id));
  fenetre.on('unresponsive', () => diagnostic('WINDOW_UNRESPONSIVE', fenetre.id));

  // Diagnostics : journaliser les échecs de chargement (preuve pour écran blanc).
  // WS-3 : un échec de la trame principale est MÉMORISÉ pour la garde
  // ci-dessous — il ne doit jamais laisser une fenêtre invisible pour toujours.
  fenetre.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) {
      echecChargementPrincipal = `did-fail-load ${code} ${desc}`;
      diagnostic('MAIN_LOAD_FAILED', code);
      console.error(`[web] ${echecChargementPrincipal}`);
    }
  });
  fenetre.webContents.on("render-process-gone", (_e, details) => {
    diagnostic('RENDER_PROCESS_GONE', details.exitCode);
    console.error(`[web] render-process-gone ${details.reason}`);
  });

  poseGardeNavigation(fenetre);
  fenetre.on("closed", () => {
    if (fenetrePrincipale === fenetre) fenetrePrincipale = null;
    if (deploymentAutomatique) app.quit();
  });
  return fenetre;
}

async function afficherFenetreErreur(
  titre: string,
  detail: string,
  journalDir: string,
): Promise<void> {
  if (deploymentAutomatique) {
    diagnostic('LOCAL_SERVICE_ERROR');
    await afficherEtatLocal(true);
    return;
  }
  if (fenetreErreur && !fenetreErreur.isDestroyed()) {
    fenetreErreur.focus();
    return;
  }

  fenetreErreur = new BrowserWindow({
    width: 640,
    height: 480,
    minWidth: 520,
    minHeight: 400,
    show: false,
    title: "MindCare OS — Erreur de démarrage",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  fenetreErreur.on("closed", () => {
    fenetreErreur = null;
    if (deploymentAutomatique) app.quit();
  });

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>MindCare — Erreur</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Segoe UI,system-ui,Arial,sans-serif;background:#fefefe;color:#1a1a1a;padding:32px;line-height:1.5}
  h1{font-size:18px;color:#9e1b1b;margin-bottom:12px}
  .detail{font-size:14px;background:#fff3f3;border:1px solid #e8b4b4;border-radius:8px;padding:14px;white-space:pre-wrap;word-break:break-word;margin-bottom:16px}
  .chemin{font-size:12px;color:#555;background:#f3f3f3;border-radius:6px;padding:10px;margin-bottom:18px;word-break:break-all}
  .actions{display:flex;gap:10px}
  button{font-size:14px;padding:9px 16px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer}
  button.primaire{background:#1a6b63;color:#fff;border-color:#1a6b63}
  small{font-size:12px;color:#777;display:block;margin-top:16px}
</style></head><body>
  <h1>${echapperHtml(titre)}</h1>
  <div class="detail">${echapperHtml(detail)}</div>
  ${deploymentAutomatique ? '' : `<div class="chemin"><strong>Journaux :</strong> ${echapperHtml(journalDir)}<br>
  <span style="color:#666">Ouvrir ce dossier dans l'Explorateur pour consulter postgres.log et backend.log</span></div>`}
  <div class="actions">
    <button class="primaire" onclick="window.close()">Fermer</button>
  </div>
  <small>${deploymentAutomatique ? 'MindCare OS — Si le problème persiste, contactez le support.' : "MindCare OS — aucune donnée patient n'est affichée dans ce message. Consulter les journaux pour le détail technique complet."}</small>
</body></html>`;

  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  fenetreErreur.once("ready-to-show", () => fenetreErreur?.show());
  await fenetreErreur.loadURL(dataUrl);
  // Fallback si ready-to-show a déjà été émis avant l'écoute (data: URL synchrone)
  if (!fenetreErreur.isDestroyed() && !fenetreErreur.isVisible()) {
    fenetreErreur.show();
  }
}

function echapperHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type ActionEtat = "retry" | "reconnect" | "logs";

interface OptionsEtatLocal {
  readonly message?: string;
  readonly detail?: string;
  readonly retryLabel?: string;
  readonly secondaire?: { readonly label: string; readonly action: ActionEtat };
}

/** Dernier état affiché : on ne recharge pas la même page toutes les 20 s. */
let dernierEtatLocal = "";
/** « Réessayer » pendant une attente : sonde immédiate, sans relancer le démarrage. */
let reessaiImmediat = false;

/**
 * L'écran d'attente et l'écran de reprise, sur UNE seule fenêtre.
 *
 * ═══ CE QUI ÉTAIT CASSÉ, ET QUI SE VOYAIT EN CABINET ═════════════════════════
 *
 *   · la politique de sécurité (`default-src 'none'`) n'autorisait AUCUNE
 *     feuille de style : la page s'affichait en texte brut, sans mise en page ;
 *   · l'écran n'avait aucun bouton tant qu'il n'était pas en erreur — un poste
 *     dont le médecin avait éteint le PC restait donc figé, sans issue ;
 *   · il ne distinguait pas « je prépare le cabinet » (premier démarrage du PC
 *     médecin, plusieurs minutes) de « je me reconnecte » (coupure réseau).
 *
 * Les trois sont corrigés ici : `style-src` avec nonce, bouton toujours
 * présent, et un message choisi par l'appelant selon la situation réelle.
 */
async function afficherEtatLocal(erreur: boolean, options: OptionsEtatLocal = {}): Promise<void> {
  if (fermetureEnCours || applicationPrete) return;
  const messages = JSON.parse(readFileSync(path.join(process.resourcesPath, 'cabinet', 'messages-fr.json'), 'utf8')) as Record<string, string>;
  const message = options.message ?? messages[erreur ? 'localUnavailable' : 'startingLocal']!;
  const detail = options.detail ?? "";
  const signature = `${String(erreur)}|${message}|${detail}|${options.secondaire?.action ?? ""}`;
  if (signature === dernierEtatLocal && fenetrePrincipale !== null && !fenetrePrincipale.isDestroyed()) return;
  dernierEtatLocal = signature;
  if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) fenetrePrincipale = creerFenetrePrincipaleCachee();
  erreurLocale = erreur;
  const nonce = randomBytes(18).toString('base64');
  const secondaire = options.secondaire === undefined ? "" : `<button id="secondaire" data-action="${options.secondaire.action}">${echapperHtml(options.secondaire.label)}</button>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>MindCare OS</title>
<style nonce="${nonce}">
  *{box-sizing:border-box}
  body{font:16px "Segoe UI",Arial,sans-serif;background:#f7f5f1;color:#1b1b1b;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px}
  main{max-width:620px;width:100%}
  h1{font-size:24px;margin:0 0 10px;color:#1a6b63}
  p{margin:0 0 10px;line-height:1.55}
  p.detail{color:#555}
  button{font:inherit;padding:10px 18px;border-radius:9px;border:1px solid #c9c9c9;background:#fff;cursor:pointer;margin:14px 10px 0 0}
  button.primaire{background:#1a6b63;border-color:#1a6b63;color:#fff}
  small{display:block;margin-top:22px;color:#777;font-size:13px}
</style></head><body><main>
  <h1>MindCare OS</h1>
  <p role="status">${echapperHtml(message)}</p>
  ${detail === "" ? "" : `<p class="detail">${echapperHtml(detail)}</p>`}
  <button class="primaire" id="retry">${echapperHtml(options.retryLabel ?? messages.retryLocal!)}</button>${secondaire}
  <small>MindCare OS — aucune donnée patient n'est affichée sur cet écran.</small>
</main>
<script nonce="${nonce}">
  document.getElementById('retry').onclick = (event) => {
    const bouton = event.currentTarget;
    bouton.disabled = true;
    // Le bouton se réactive toujours : une sonde immédiate peut ne rien changer
    // à l'écran, et un bouton grisé pour toujours serait le défaut d'origine.
    Promise.resolve(window.mindcare.retryStartup()).finally(() => { setTimeout(() => { bouton.disabled = false; }, 800); });
  };
  const secondaire = document.getElementById('secondaire');
  if (secondaire) secondaire.onclick = (event) => {
    const action = event.currentTarget.dataset.action;
    if (action === 'reconnect') window.mindcare.reconnectClinic();
    else if (action === 'logs') window.mindcare.openLogsFolder();
  };
</script></body></html>`;
  await fenetrePrincipale.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {
    // Un écran d'attente qui ne se charge pas ne doit jamais interrompre la
    // séquence : l'application principale prendra la main dès que le cabinet
    // répond. Sans ce `catch`, le rejet tuait silencieusement le minuteur.
  });
  if (!fenetrePrincipale.isDestroyed()) fenetrePrincipale.show();
}

ipcMain.handle('mindcare:retry-startup', async event => {
  if (event.sender !== fenetrePrincipale?.webContents || fermetureEnCours) return;
  if (!event.senderFrame?.url.startsWith('data:text/html;')) return;
  // Pendant une attente, « Réessayer » sonde TOUT DE SUITE au lieu de
  // relancer un démarrage déjà en cours (qui serait refusé, et le bouton
  // paraîtrait mort — exactement le défaut d'origine).
  if (demarrageEnCours) { reessaiImmediat = true; return; }
  if (!erreurLocale) return;
  await lancerOrchestrationEtFenetre();
});

/**
 * Sortie de secours d'un poste d'accueil : le PC médecin a été remplacé ou son
 * certificat a changé. On oublie l'autorisation (jamais les données) et on
 * revient à l'écran d'invitation. Impossible sur le PC médecin.
 */
ipcMain.handle('mindcare:reconnecter-poste', async event => {
  if (event.sender !== fenetrePrincipale?.webContents || fermetureEnCours) return false;
  if (!event.senderFrame?.url.startsWith('data:text/html;')) return false;
  if (connexionCabinet.mode === "host") return false;
  if (!(await reconnecterPoste(fenetrePrincipale))) return false;
  annulationDemarrage.abort();
  app.relaunch();
  app.exit(0);
  return true;
});


function lancerOrchestrationEtFenetre(): Promise<void> {
  return travailDemarrage ??= executerOrchestrationEtFenetre().finally(() => { travailDemarrage = undefined; });
}

let messagesDesktopCache: Record<string, string> | undefined;
function messagesDesktop(): Record<string, string> {
  messagesDesktopCache ??= JSON.parse(readFileSync(path.join(process.resourcesPath, 'cabinet', 'messages-fr.json'), 'utf8')) as Record<string, string>;
  return messagesDesktopCache;
}

/** Le message d'attente dépend du rôle réel de ce poste, pas du hasard. */
function messageAttenteCabinet(): OptionsEtatLocal {
  const messages = messagesDesktop();
  return connexionCabinet.mode === "host"
    ? { message: messages["preparingClinic"] ?? "", detail: messages["preparingClinicDetail"] ?? "" }
    : { message: messages["waitingClinic"] ?? "", detail: messages["waitingClinicDetail"] ?? "" };
}

/** Pause interruptible par « Réessayer » — jamais 20 s d'attente aveugle. */
function pauseCabinet(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const fin = Date.now() + ms;
    const tic = (): void => {
      if (fermetureEnCours || reessaiImmediat || Date.now() >= fin) {
        reessaiImmediat = false;
        resolve();
        return;
      }
      setTimeout(tic, 100);
    };
    tic();
  });
}

/**
 * Attend le cabinet SANS jamais aboutir à une impasse.
 *
 * Une tentative bornée (20 s), puis on recommence : le PC médecin peut mettre
 * plusieurs minutes à préparer sa base au premier démarrage, et une coupure de
 * secteur ne doit pas obliger l'accueil à fermer puis relancer MindCare.
 *
 * Après deux minutes, l'écran devient une reprise ACTIONNABLE et non plus une
 * boucle silencieuse : « Réessayer » sonde immédiatement, et sur un poste
 * d'accueil « Reconnecter ce poste » permet de repartir sur une invitation
 * quand le PC médecin a été remplacé (son certificat a alors changé, et aucune
 * reconnexion automatique n'est possible — la dire est plus honnête que de
 * tourner indéfiniment).
 */
async function attendreLeCabinet(): Promise<void> {
  const hote = connexionCabinet.mode === "host";
  const messages = messagesDesktop();
  const debut = Date.now();
  let recuperation = false;
  for (;;) {
    annulationDemarrage.signal.throwIfAborted();
    try {
      await attendreConnexionCabinet(annulationDemarrage.signal, { budgetMs: 20_000 });
      return;
    } catch (error) {
      annulationDemarrage.signal.throwIfAborted();
      // Une configuration absente n'est pas une panne réseau : elle doit
      // remonter telle quelle, sinon on masquerait un poste mal installé.
      if (error instanceof Error && error.message === "CONFIGURATION_CABINET") throw error;
      if (!recuperation && Date.now() - debut > 120_000) {
        recuperation = true;
        await afficherEtatLocal(true, hote
          ? {
              message: messages["hostUnreachable"] ?? "",
              detail: messages["hostUnreachableDetail"] ?? "",
              retryLabel: messages["retryButton"] ?? "",
              secondaire: { label: messages["openLogs"] ?? "", action: "logs" },
            }
          : {
              message: messages["clinicUnreachable"] ?? "",
              detail: messages["clinicUnreachableDetail"] ?? "",
              retryLabel: messages["retryButton"] ?? "",
              secondaire: { label: messages["reconnectStation"] ?? "", action: "reconnect" },
            });
      } else if (!recuperation && !fermetureEnCours && !applicationPrete) {
        // L'écran d'attente a déjà été affiché par le minuteur de 2,5 s ; on ne
        // le réaffiche ici que pour rafraîchir un éventuel message périmé.
        await afficherEtatLocal(false, messageAttenteCabinet());
      }
      await pauseCabinet(1500);
    }
  }
}


async function executerOrchestrationEtFenetre(): Promise<void> {
  // Si une fenêtre principale existe déjà et est prête (après READY), ne pas relancer
  if (demarrageEnCours || fermetureEnCours || applicationPrete) return;
  demarrageEnCours = true;
  const debutDemarrage = Date.now();
  const contexte = construireContexte();
  contexteCourant = contexte;
  const sauterPg = !app.isPackaged;

  // Stratégie userData EXPLICITE (§5) : la session Electron (cookies,
  // localStorage, cache) reste à l'emplacement par défaut par utilisateur et
  // est éphémère — la sauvegarde du cabinet couvre `%ProgramData%\MindCare`,
  // jamais la session. `deleteAppDataOnUninstall: false` la préserve de toute
  // façon à la désinstallation.
  console.log(`[mindcare] userData=${app.getPath("userData")} (session éphémère, hors sauvegarde)`);
  console.log(`[mindcare] démarrage — package=${String(app.isPackaged)} pgDir=${contexte.resourcesPgsqlDir} env=${contexte.fichierEnv} serveur=${contexte.serveurDir}`);

  try {
    if (app.isPackaged) {
      const definition = JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")) as { mindcareDeployment?: string };
      const programData = process.env["ProgramData"] ?? "C:\\ProgramData";
      deploymentAutomatique = definition.mindcareDeployment === "clinic-auto";
      connexionCabinet = chargerConnexionCabinet(path.join(programData, "MindCare", "desktop.json"), deploymentAutomatique ? "clinic-auto" : definition.mindcareDeployment === "clinic-client" ? "clinic-client" : definition.mindcareDeployment === "clinic-host" ? "clinic-host" : "standalone");
      if (connexionCabinet.mode === "auto") connexionCabinet = await connecterBureauCabinet();
      if ("origin" in connexionCabinet) configurerOrigineCabinet(connexionCabinet.origin);
      // ⚠️ PAS D'ÉCRAN D'ATTENTE ICI. Il était affiché AVANT de savoir si le
      // service répond : un démarrage sain montrait donc « Démarrage des
      // services… » pendant une seconde, puis l'application — exactement le
      // clignotement qu'on veut éviter. L'écran d'attente n'apparaît plus que
      // si l'attente dépasse 2,5 s (voir plus bas).
    }
    // La configuration est vérifiée avant toute fenêtre ou activité de base.
    if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) fenetrePrincipale = creerFenetrePrincipaleCachee();
    const res = connexionCabinet.mode === "standalone" ? await orchestrerDemarrage(contexte, {
      signal: annulationDemarrage.signal,
      sauterPostgresEnDev: sauterPg,
      onEtat: (etat, machine) => {
        console.log(`[mindcare] état → ${etat} ${machine.cause ?? ""} ${machine.detail ?? ""}`.trim());
        // Diffuser au renderer s'il est déjà chargé (pour un futur écran de chargement)
        if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) {
          fenetrePrincipale.webContents.send("mindcare:etat-demarrage", etat);
        }
      },
      onBackendCrash: (detail) => {
        // Crash après lancement : si l'application était affichée, le renderer
        // servirait un backend mort — afficher l'erreur FR au lieu du vide.
        if (applicationPrete && (!fenetreErreur || fenetreErreur.isDestroyed())) {
          void afficherFenetreErreur(
            "Le serveur applicatif s'est arrêté.",
            `${detail} Relancer MindCare OS. Si le problème persiste, consulter backend.log.`,
            contexte.journalDir,
          );
        }
      },
    }) : await (async () => {
      if (deploymentAutomatique) {
        // L'écran d'attente est DIFFÉRÉ : si le cabinet répond en moins de
        // 2,5 s (cas normal d'un poste déjà configuré), l'utilisateur voit
        // directement son application, sans écran intermédiaire. Le message
        // n'apparaît que si l'attente se prolonge réellement.
        const attente = attendreLeCabinet();
        const surAttente = setTimeout(() => {
          if (!fermetureEnCours && !applicationPrete) void afficherEtatLocal(false, messageAttenteCabinet());
        }, 2500);
        try {
          await attente;
        } finally {
          clearTimeout(surAttente);
        }
      } else {
        await attendreCabinet(urlDepart(), (url, options) => net.fetch(url, options));
      }
      return { etat: { etat: "READY" as const, tentativesRecuperation: 0 }, backend: undefined as ChildProcess | undefined };
    })();


    processusBackend = res.backend;
    if (fermetureEnCours || !fenetrePrincipale || fenetrePrincipale.isDestroyed()) return;

    if (res.etat.etat === "READY") {
      // Succès : charger le backend puis afficher — avec garde WS-3 : tout
      // échec de chargement devient une fenêtre d'erreur FR, jamais du vide.
      echecChargementPrincipal = null;
      let montre = false;
      if (!deploymentAutomatique) fenetrePrincipale.once("ready-to-show", () => {
        montre = true;
        applicationPrete = true;
        fenetrePrincipale?.show();
        if (deploymentAutomatique && fenetrePrincipale) surveillerCabinet(fenetrePrincipale);
      });
      try {
        if (deploymentAutomatique) {
          // ⚠️ MESURÉ SUR LE PAQUET RÉEL : le chargement de l'interface prend
          // plusieurs secondes. Pendant ce temps la fenêtre restait cachée, et
          // la praticienne ne voyait RIEN après avoir double-cliqué. Si le
          // démarrage a déjà dépassé 1,5 s, on affiche l'écran d'attente avant
          // de charger : jamais de blanc, jamais de fenêtre invisible.
          if (!fenetrePrincipale.isVisible() && Date.now() - debutDemarrage > 1500) {
            await afficherEtatLocal(false, messageAttenteCabinet());
          }
          await fenetrePrincipale.loadURL(urlDepart());
          if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) return;
          montre = true;
          applicationPrete = true;
          erreurLocale = false;
          dernierEtatLocal = "";
          // Le succès doit TOUJOURS rendre la fenêtre visible. Cette branche
          // comptait sur l'écran d'attente pour le faire ; quand le cabinet
          // répondait vite, l'application restait chargée mais invisible.
          if (!fenetrePrincipale.isVisible()) fenetrePrincipale.show();
          surveillerCabinet(fenetrePrincipale);
        } else await fenetrePrincipale.loadURL(urlDepart());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) fenetrePrincipale.hide();
        await afficherFenetreErreur(
          "L'interface n'a pas pu se charger.",
          `Le serveur répond mais la page ne s'affiche pas (${msg.slice(0, 300)}). Consulter backend.log.`,
          contexte.journalDir,
        );
        return;
      }
      // Chien de garde : si `ready-to-show` ne vient jamais (trame principale
      // en échec silencieux), ne pas laisser une fenêtre invisible pour toujours.
      if (!montre) await new Promise<void>((resolve) => {
        const terminer = () => { clearTimeout(timer); annulationDemarrage.signal.removeEventListener('abort', terminer); resolve(); };
        const timer = setTimeout(terminer, 20_000);
        annulationDemarrage.signal.addEventListener('abort', terminer, { once: true });
        if (annulationDemarrage.signal.aborted) terminer();
      });
      if (!montre && !fenetrePrincipale.isDestroyed()) {
        fenetrePrincipale.hide();
        await afficherFenetreErreur(
          "L'interface n'a pas pu se charger.",
          `${echecChargementPrincipal ?? "La fenêtre ne s'est jamais affichée après 20 s."} Consulter backend.log.`,
          contexte.journalDir,
        );
        return;
      }
      // Fermer une éventuelle fenêtre d'erreur précédente
      if (fenetreErreur && !fenetreErreur.isDestroyed()) fenetreErreur.close();
    } else {
      // Échec : fenêtre d'erreur FR actionnable, jamais de fenêtre blanche
      const { titre, detail } = messageErreurFR(res.etat);
      // Cacher / fermer la principale qui n'a jamais été montrée
      if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) {
        fenetrePrincipale.hide();
      }
      await afficherFenetreErreur(titre, detail, contexte.journalDir);
      // Ne pas quitter immédiatement : laisser l'utilisateur lire et fermer
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const safe = msg.replace(/postgresql:\/\/[^\s]+/gi, "postgresql://***");
    console.error(`[mindcare] orchestration exception: ${safe.slice(0, 600)}`);
    if (deploymentAutomatique) {
      await afficherFenetreErreur("Le cabinet MindCare est indisponible.", "Relancez MindCare sur le PC du médecin. Si le problème persiste, contactez le support.", contexte.journalDir);
      return;
    }
    if (connexionCabinet.mode !== "standalone" || safe.startsWith("CONFIGURATION_CABINET") || safe.startsWith("CABINET_INJOIGNABLE")) {
      if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) fenetrePrincipale.hide();
      await afficherFenetreErreur("Connexion au cabinet impossible.", safe.slice(0, 500), contexte.journalDir);
      return;
    }
    const { titre, detail } = messageErreurFR({
      etat: "FAILED",
      tentativesRecuperation: 0,
      cause: "base-injoignable",
      detail: safe.slice(0, 500),
    });
    if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) fenetrePrincipale.hide();
    await afficherFenetreErreur(titre, detail, contexte.journalDir);
  } finally { demarrageEnCours = false; }
}

/**
 * §G du plan — aucune navigation ni fenêtre ouverte vers autre chose que le
 * backend local. Tout le reste passe par le navigateur système, jamais par
 * une fenêtre Electron : une page externe ouverte DANS l'app hériterait
 * potentiellement des mêmes préférences web.
 */
function poseGardeNavigation(fenetre: BrowserWindow): void {
  // WS-4 : l'origine autorisée est calculée À CHAQUE navigation, pas figée à
  // la création de la fenêtre (le backend démarre après, sur un port fixe —
  // mais une URL de démarrage d'environnement ne doit jamais figer un refus).
  fenetre.webContents.on("will-navigate", (evenement, urlCible) => {
    let cibleOrigine = "";
    try {
      cibleOrigine = new URL(urlCible).origin;
    } catch {
      evenement.preventDefault();
      return;
    }
    if (cibleOrigine !== new URL(urlDepart()).origin) {
      evenement.preventDefault();
      void shell.openExternal(urlCible);
    }
  });

  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

/**
 * §G du plan — seule la permission microphone est accordée (dictée vocale,
 * §18 de la mission). Tout le reste (géolocalisation, notifications, presse-
 * papiers, MIDI…) est refusé sans exception : Electron, contrairement au
 * navigateur, n'affiche pas de bandeau de consentement par défaut.
 */
function posePermissionsRestreintes(): void {
  const memeOrigine = (url: string): boolean => {
    try { return new URL(url).origin === new URL(urlDepart()).origin; } catch { return false; }
  };
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(wc === fenetrePrincipale?.webContents && permission === "media" && memeOrigine(details.requestingUrl) && !("mediaTypes" in details && details.mediaTypes.includes("video")));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => wc === fenetrePrincipale?.webContents && permission === "media" && memeOrigine(origin));
}

ipcMain.handle("mindcare:version", () => app.getVersion());

/**
 * L'alerte « Appeler la secrétaire » côté processus principal.
 *
 * ═══ POURQUOI ELLE PASSE PAR ICI, ET PAS SEULEMENT PAR LE RENDU ═════════════
 *
 * Le renderer ne peut pas afficher une notification Windows native ni faire
 * clignoter la barre des tâches : ce sont des API du processus principal. Or
 * ces deux gestes sont ceux qui fonctionnent quand la fenêtre est RÉDUITE, ou
 * quand Windows « Ne pas déranger » masque les toasts. Un bandeau React seul
 * ne serait vu que par une personne déjà devant l'écran.
 *
 * ═══ CE QUE L'APPEL PROUVE, ET CE QU'IL NE PROUVE PAS ═══════════════════════
 *
 * `show()` rend la main sans garantir l'affichage : le système peut avoir coupé
 * les notifications de l'application. L'interface ne prétend donc jamais qu'un
 * son a été entendu ; le seul accusé fiable reste le clic « J'arrive ».
 *
 * ═══ SURFACE IPC — FERMÉE ET VALIDÉE ═══════════════════════════════════════
 *
 * Le renderer est non fiable (règle 4) : la charge est validée champ par champ,
 * et l'expéditeur doit être la fenêtre principale. Aucun chemin, aucun texte
 * libre n'est accepté — seulement un identifiant et un nom déjà affichés.
 */
const appelsSignales = new Set<string>();

ipcMain.handle("mindcare:notifier-appel", (event, valeur: unknown): boolean => {
  if (fenetrePrincipale === null || fenetrePrincipale.isDestroyed()) return false;
  if (event.sender !== fenetrePrincipale.webContents) return false;
  if (typeof valeur !== "object" || valeur === null) return false;

  const charge = valeur as Record<string, unknown>;
  const callId = charge["callId"];
  const callerName = charge["callerName"];
  if (typeof callId !== "string" || !/^[0-9a-f-]{36}$/i.test(callId)) return false;
  if (typeof callerName !== "string" || callerName.length === 0 || callerName.length > 120) return false;

  diagnostic("CALL_ALERT_RECEIVED", appelsSignales.has(callId));

  // Un appel ne notifie qu'une fois, même si le flux le repousse ou si le
  // renderer se remonte. Le renderer a son propre registre ; celui-ci est le
  // dernier rempart avant le système.
  if (appelsSignales.has(callId)) return false;
  appelsSignales.add(callId);
  if (appelsSignales.size > 200) {
    // Bornage : on oublie les plus anciens identifiants. Un appel ne dure
    // qu'une minute ; 200 entrées couvrent largement une journée.
    const premier = appelsSignales.values().next().value;
    if (typeof premier === "string") appelsSignales.delete(premier);
  }

  // Clignotement de la barre des tâches : fonctionne même si les toasts sont
  // coupés par le système, et reste visible sur un bureau chargé.
  try {
    fenetrePrincipale.flashFrame(true);
  } catch {
    /* certaines sessions Windows refusent le clignotement : le toast reste */
  }

  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: "MindCare OS — Appel du médecin",
        body: `${callerName} vous demande.`,
        urgency: "critical",
        timeoutType: "never",
      });
      notification.on("click", () => {
        try {
          if (fenetrePrincipale === null || fenetrePrincipale.isDestroyed()) return;
          if (fenetrePrincipale.isMinimized()) fenetrePrincipale.restore();
          fenetrePrincipale.show();
          fenetrePrincipale.focus();
          fenetrePrincipale.flashFrame(false);
        } catch {
          /* fenêtre disparue entre-temps */
        }
      });
      notification.show();
    }
  } catch {
    // Un toast refusé n'est pas une raison de perdre l'alerte : le bandeau et
    // le clignotement restent, et le médecin verra l'appel expirer.
    diagnostic("CALL_ALERT_NOTIFICATION_FAILED");
  }

  return true;
});

/** Arrête le clignotement (accusé reçu ou appel expiré). */
ipcMain.handle("mindcare:arreter-appel", (event): boolean => {
  if (fenetrePrincipale === null || fenetrePrincipale.isDestroyed()) return false;
  if (event.sender !== fenetrePrincipale.webContents) return false;
  try {
    fenetrePrincipale.flashFrame(false);
    return true;
  } catch {
    return false;
  }
});

interface ResultatCanal {
  readonly ok: boolean;
  readonly message: string;
}

ipcMain.handle("mindcare:ouvrir-journaux", async (): Promise<ResultatCanal> => {
  // Étape 12 du plan : ouvre le dossier des journaux dans l'Explorateur.
  // Lecture seule côté renderer — aucun chemin arbitraire accepté.
  const dossier = contexteCourant?.journalDir;
  if (!dossier) return { ok: false, message: "Dossier des journaux inconnu (démarrage incomplet)." };
  const erreur = await shell.openPath(dossier);
  if (erreur !== "") return { ok: false, message: `Ouverture impossible : ${erreur.slice(0, 200)}` };
  return { ok: true, message: dossier };
});

ipcMain.handle("mindcare:lancer-sauvegarde", async (): Promise<ResultatCanal> => {
  if (connexionCabinet.mode !== "standalone") return { ok: false, message: "La sauvegarde du cabinet est effectuée sur le poste Médecin par l'administrateur." };
  // Étape 12 du plan : exécute `sauvegarde.mjs` (chiffrée + restauration
  // rejouée) dans un fils Node pur. La phrase de passe vient de
  // l'environnement du cabinet, jamais du renderer ; le résultat est un
  // résumé typé, jamais un secret.
  const contexte = contexteCourant;
  if (!contexte) return { ok: false, message: "Contexte de démarrage inconnu." };
  const script = path.join(contexte.serveurDir, "scripts", "sauvegarde.mjs");
  if (!existsSync(script)) return { ok: false, message: "Script de sauvegarde absent du paquet." };
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1", MINDCARE_ENV_FILE: contexte.fichierEnv };
  return await new Promise<ResultatCanal>((resoudre) => {
    const fils = spawn(process.execPath, [script], { env });
    let sortie = "";
    const tail = (d: Buffer) => {
      sortie += d.toString();
      if (sortie.length > 4000) sortie = sortie.slice(-4000);
    };
    fils.stdout?.on("data", tail);
    fils.stderr?.on("data", tail);
    const minuteur = setTimeout(() => {
      try {
        fils.kill();
      } catch {
        // ignore
      }
      resoudre({ ok: false, message: "Sauvegarde interrompue (délai de 5 min dépassé)." });
    }, 300_000);
    fils.on("error", (e) => {
      clearTimeout(minuteur);
      resoudre({ ok: false, message: `Sauvegarde impossible : ${e.message.slice(0, 200)}` });
    });
    fils.on("exit", (code) => {
      clearTimeout(minuteur);
      const resume = sortie.trim().split("\n").slice(-5).join("\n").slice(0, 800);
      if (code === 0) resoudre({ ok: true, message: resume === "" ? "Sauvegarde terminée." : resume });
      else resoudre({ ok: false, message: resume === "" ? `Échec (code ${String(code)}).` : resume });
    });
  });
});
