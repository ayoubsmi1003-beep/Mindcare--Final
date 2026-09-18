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

import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { urlDepart } from "./config.js";
import { dossierDonnees, fichierEnvironnement, modeCourant } from "./chemins.js";
import {
  messageErreurFR,
  orchestrerDemarrage,
  tuerBackend,
  type ContexteDemarrage,
} from "./orchestrateur.js";

const REPERTOIRE_ICI = path.dirname(fileURLToPath(import.meta.url));

let fenetrePrincipale: BrowserWindow | null = null;
let fenetreErreur: BrowserWindow | null = null;
let processusBackend: ChildProcess | undefined;

const verrouObtenu = app.requestSingleInstanceLock();
if (!verrouObtenu) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const cible = fenetreErreur ?? fenetrePrincipale;
    if (cible) {
      if (cible.isMinimized()) cible.restore();
      cible.focus();
    }
  });

  app.whenReady().then(() => {
    void lancerOrchestrationEtFenetre();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void lancerOrchestrationEtFenetre();
  });

  app.on("before-quit", () => {
    if (processusBackend) tuerBackend(processusBackend);
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
  // En dev non packagé mais avec MINDCARE_ELECTRON_ENV=production, on reste en mode prod packagé simulé
  // → ne pas écraser les chemins ci-dessus qui sont déjà corrects via `estPackage`
  return { resourcesPgsqlDir, serveurDir, dataDir, journalDir, fichierEnv, dossierTemp };
}

function creerFenetrePrincipaleCachee(): BrowserWindow {
  posePermissionsRestreintes();

  const fenetre = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(REPERTOIRE_ICI, "..", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Diagnostics : journaliser les échecs de chargement (preuve pour écran blanc)
  fenetre.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) console.error(`[web] did-fail-load ${code} ${desc} ${url}`);
  });
  fenetre.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[web] render-process-gone ${details.reason}`);
  });
  fenetre.webContents.on("console-message", (_e, level, message) => {
    if (level === 2) console.error(`[renderer] ${message}`);
  });

  poseGardeNavigation(fenetre);
  fenetre.on("closed", () => {
    if (fenetrePrincipale === fenetre) fenetrePrincipale = null;
  });
  return fenetre;
}

async function afficherFenetreErreur(
  titre: string,
  detail: string,
  journalDir: string,
): Promise<void> {
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
  <div class="chemin"><strong>Journaux :</strong> ${echapperHtml(journalDir)}<br>
  <span style="color:#666">Ouvrir ce dossier dans l'Explorateur pour consulter postgres.log et backend.log</span></div>
  <div class="actions">
    <button class="primaire" onclick="window.close()">Fermer</button>
  </div>
  <small>MindCare OS — aucune donnée patient n'est affichée dans ce message. Consulter les journaux pour le détail technique complet.</small>
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

async function lancerOrchestrationEtFenetre(): Promise<void> {
  // Si une fenêtre principale existe déjà et est prête (après READY), ne pas relancer
  if (fenetrePrincipale && !fenetrePrincipale.isDestroyed() && fenetrePrincipale.isVisible()) return;
  // Créer la fenêtre principale cachée si absente
  if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) {
    fenetrePrincipale = creerFenetrePrincipaleCachee();
  }

  const contexte = construireContexte();
  const sauterPg = !app.isPackaged;

  console.log(`[mindcare] démarrage — package=${String(app.isPackaged)} pgDir=${contexte.resourcesPgsqlDir} env=${contexte.fichierEnv} serveur=${contexte.serveurDir}`);

  try {
    const res = await orchestrerDemarrage(contexte, {
      sauterPostgresEnDev: sauterPg,
      onEtat: (etat, machine) => {
        console.log(`[mindcare] état → ${etat} ${machine.cause ?? ""} ${machine.detail ?? ""}`.trim());
        // Diffuser au renderer s'il est déjà chargé (pour un futur écran de chargement)
        if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) {
          fenetrePrincipale.webContents.send("mindcare:etat-demarrage", etat);
        }
      },
    });

    processusBackend = res.backend;

    if (res.etat.etat === "READY") {
      // Succès : charger le backend puis afficher
      fenetrePrincipale.once("ready-to-show", () => fenetrePrincipale?.show());
      await fenetrePrincipale.loadURL(urlDepart());
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
    const { titre, detail } = messageErreurFR({
      etat: "FAILED",
      tentativesRecuperation: 0,
      cause: "base-injoignable",
      detail: safe.slice(0, 500),
    });
    if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) fenetrePrincipale.hide();
    await afficherFenetreErreur(titre, detail, contexte.journalDir);
  }
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
