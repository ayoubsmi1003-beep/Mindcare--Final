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

import { app, BrowserWindow, ipcMain, net, session, shell } from "electron";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configurerOrigineCabinet, urlDepart } from "./config.js";
import { attendreCabinet, chargerConnexionCabinet, chargerAvecReconnexion, type ConnexionCabinet } from "./connexion-cabinet.js";
import { connecterBureauCabinet, surveillerCabinet } from "./bureau-cabinet.js";
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
/** Dernier échec de chargement de la trame principale (WS-3) — sinon null. */
let echecChargementPrincipal: string | null = null;
/** Contexte de démarrage courant (journaux, instantané) pour les canaux IPC. */
let contexteCourant: ContexteDemarrage | null = null;
/** Vrai une fois READY + renderer affiché — arme le rappel de crash backend. */
let applicationPrete = false;
let connexionCabinet: ConnexionCabinet = { mode: "standalone" };
let deploymentAutomatique = false;

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
    },
  });

  // Diagnostics : journaliser les échecs de chargement (preuve pour écran blanc).
  // WS-3 : un échec de la trame principale est MÉMORISÉ pour la garde
  // ci-dessous — il ne doit jamais laisser une fenêtre invisible pour toujours.
  fenetre.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) {
      echecChargementPrincipal = `did-fail-load ${code} ${desc}`;
      console.error(`[web] ${echecChargementPrincipal}`);
    }
  });
  fenetre.webContents.on("render-process-gone", (_e, details) => {
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
    titre = "Le cabinet MindCare est indisponible.";
    detail = "Relancez MindCare sur le PC du médecin. Si le problème persiste, contactez le support.";
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

async function lancerOrchestrationEtFenetre(): Promise<void> {
  // Si une fenêtre principale existe déjà et est prête (après READY), ne pas relancer
  if (fenetrePrincipale && !fenetrePrincipale.isDestroyed() && fenetrePrincipale.isVisible()) return;
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
    }
    // La configuration est vérifiée avant toute fenêtre ou activité de base.
    if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) fenetrePrincipale = creerFenetrePrincipaleCachee();
    const res = connexionCabinet.mode === "standalone" ? await orchestrerDemarrage(contexte, {
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
      if (!deploymentAutomatique) await attendreCabinet(urlDepart(), (url, options) => net.fetch(url, options));
      return { etat: { etat: "READY" as const, tentativesRecuperation: 0 }, backend: undefined };
    })();

    processusBackend = res.backend;

    if (res.etat.etat === "READY") {
      // Succès : charger le backend puis afficher — avec garde WS-3 : tout
      // échec de chargement devient une fenêtre d'erreur FR, jamais du vide.
      echecChargementPrincipal = null;
      let montre = false;
      fenetrePrincipale.once("ready-to-show", () => {
        montre = true;
        applicationPrete = true;
        fenetrePrincipale?.show();
        if (deploymentAutomatique && fenetrePrincipale) surveillerCabinet(fenetrePrincipale);
      });
      try {
        if (deploymentAutomatique) {
          await chargerAvecReconnexion(() => fenetrePrincipale!.loadURL(urlDepart()), () => connecterBureauCabinet(), () => !fenetrePrincipale || fenetrePrincipale.isDestroyed());
          if (!fenetrePrincipale || fenetrePrincipale.isDestroyed()) return;
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
      await new Promise((r) => setTimeout(r, 20_000));
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
  }
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
