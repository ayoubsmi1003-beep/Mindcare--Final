/**
 * Processus principal Electron — étape 1 du plan (squelette + coquille sûre).
 *
 * Ce fichier ne fait ENCORE que ce que l'étape 1 demande : une fenêtre
 * sécurisée qui charge le backend Next.js existant, verrou mono-instance, et
 * la frontière IPC minimale du preload. La machine à états de démarrage
 * (§H du plan), le cycle de vie PostgreSQL (§C) et la sauvegarde (§J)
 * arrivent aux étapes 4 à 12 — ne pas les anticiper ici.
 *
 * ═══ CE QUE CETTE COQUILLE GARANTIT DÉJÀ, ET NE DOIT JAMAIS PERDRE ═════════
 *
 * `contextIsolation` + `sandbox` + `nodeIntegration:false` : le renderer
 * reste un client NON FIABLE (règle 4 de CLAUDE.md — la sécurité ne vit
 * jamais en JavaScript côté client, encore moins côté Electron). Aucune
 * URL de base de données, aucun secret ne transite par ce processus vers
 * le renderer : ils n'existent nulle part dans ce fichier.
 */
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { urlDepart } from "./config.js";

const REPERTOIRE_ICI = path.dirname(fileURLToPath(import.meta.url));

let fenetrePrincipale: BrowserWindow | null = null;

const verrouObtenu = app.requestSingleInstanceLock();
if (!verrouObtenu) {
  // Une instance existe déjà : on ne touche à RIEN (ni base, ni port, ni
  // fenêtre) — §H du plan, "single instance". On se contente de sortir.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (fenetrePrincipale) {
      if (fenetrePrincipale.isMinimized()) fenetrePrincipale.restore();
      fenetrePrincipale.focus();
    }
  });

  app.whenReady().then(creerFenetre);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
}

function creerFenetre(): void {
  posePermissionsRestreintes();

  fenetrePrincipale = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    webPreferences: {
      // `.cjs`, pas `.js` : le preload compile en CommonJS pur (voir la
      // note sur `.cts` dans electron/preload/index.cts) — Electron charge
      // tout preload via `require`, quel que soit `"type"` dans package.json.
      preload: path.join(REPERTOIRE_ICI, "..", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  poseGardeNavigation(fenetrePrincipale);

  fenetrePrincipale.once("ready-to-show", () => fenetrePrincipale?.show());

  fenetrePrincipale.on("closed", () => {
    fenetrePrincipale = null;
  });

  void fenetrePrincipale.loadURL(urlDepart());
}

/**
 * §G du plan — aucune navigation ni fenêtre ouverte vers autre chose que le
 * backend local. Tout le reste passe par le navigateur système, jamais par
 * une fenêtre Electron : une page externe ouverte DANS l'app hériterait
 * potentiellement des mêmes préférences web.
 */
function poseGardeNavigation(fenetre: BrowserWindow): void {
  const origineAutorisee = new URL(urlDepart()).origin;

  fenetre.webContents.on("will-navigate", (evenement, urlCible) => {
    if (new URL(urlCible).origin !== origineAutorisee) {
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
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
}

ipcMain.handle("mindcare:version", () => app.getVersion());

ipcMain.handle("mindcare:ouvrir-journaux", () => {
  // Implémenté à l'étape 12 du plan (sauvegarde/journaux). Refus explicite
  // plutôt qu'un canal silencieusement absent, pour que le preload et le
  // renderer aient dès l'étape 1 la forme finale de l'API.
  throw new Error("ouvrirJournaux n'est pas encore implémenté (étape 12 du plan).");
});

ipcMain.handle("mindcare:lancer-sauvegarde", () => {
  throw new Error("lancerSauvegarde n'est pas encore implémenté (étape 12 du plan).");
});
