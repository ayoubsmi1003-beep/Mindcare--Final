import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import type { Session } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appairerCabinet,
  decouvrirCabinets,
  PORT_DECOUVERTE,
  type CabinetDecouvert,
  type ConfianceCabinet,
} from './decouverte-cabinet.js';
import { demarrerRemappage, type Remappage } from './remappage-cabinet.js';
import { configurerOrigineCabinet } from './config.js';
import { attendreCabinet, creerSessionSondeCabinet, creerStabiliteSondeCabinet, validerOrigineCabinet, ErreurConnexionCabinet, appareilRevoque } from './connexion-cabinet.js';
import { verifierCertificatCabinet } from './confiance-cabinet.js';
import { journalDesktop } from './journal-desktop.js';
import { htmlEcranCabinet } from './ecran-cabinet.js';
import {
  RECHERCHES_RAPIDES,
  creerResolveur,
  delaiEntreRecherches,
  fenetreRecherche,
  nomHoteValide,
  proposerHote,
} from './recherche-cabinet.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'MindCare');
const messages = JSON.parse(readFileSync(app.isPackaged ? path.join(process.resourcesPath, 'cabinet', 'messages-fr.json') : path.resolve(ICI, '..', '..', 'src', 'i18n', 'cabinet-desktop.fr.json'), 'utf8')) as Record<string, string>;
const resoudreCabinet = creerResolveur();

let ecran: BrowserWindow | undefined;
let confiance: ConfianceCabinet | undefined;
let candidats: CabinetDecouvert[] = [];
let actionEnCours = false;
let arret = false;
let sessionSonde: Session | undefined;
/**
 * L'état de l'écran d'appairage.
 *
 * `recherche` et `manuelle` s'ajoutent aux quatre champs historiques : sans
 * eux, l'écran ne pouvait pas distinguer « je cherche » de « je suis gelé » —
 * c'était exactement le défaut signalé en cabinet.
 */
interface EtatEcran {
  message: string;
  premier: boolean;
  invitation: boolean;
  detail: string;
  manuelle: boolean;
}
let etat: EtatEcran = { message: messages.search!, premier: false, invitation: false, detail: messages.searchHelp!, manuelle: true };
/** Une action « Rechercher à nouveau » interrompt la pause en cours. */
let rechercheImmediate = false;
/**
 * Un cabinet trouvé par nom (unicast) ne doit pas être effacé par la
 * découverte de diffusion suivante : sur un réseau qui bloque multicast ET
 * broadcast, la recherche automatique rendrait une liste vide toutes les
 * quatre secondes et l'écran d'invitation disparaîtrait sous les doigts de
 * l'utilisatrice. On garde donc le résultat manuel jusqu'à l'appairage.
 */
let candidatManuel = false;
/**
 * Remappage d'adresse (178) : activé seulement après deux échecs consécutifs,
 * quand la découverte UDP a trouvé l'adresse IPv4 courante du cabinet. Le
 * certificat épinglé et son SAN restent vérifiés — on ne change QUE l'adresse
 * vers laquelle le proxy local relaie les octets.
 */
let remappage: Remappage | undefined;
/** Empreinte de la confiance déjà appliquée aux sessions Electron. */
let confianceAppliquee: string | undefined;
let adresseForcee: string | null = null;
/**
 * Message persistant affiché au-dessus de l'écran d'appairage après une
 * révocation. Sans lui, le poste verrait « cabinet trouvé » sans comprendre
 * pourquoi il doit ressaisir une invitation.
 */
let avertissement: string | undefined;
const fichierConfiance = () => path.join(app.getPath('userData'), 'clinic-trust.json');
function obtenirSessionSonde(): Session {
  sessionSonde ??= creerSessionSondeCabinet((partition, options) => session.fromPartition(partition, options));
  return sessionSonde;
}
const posteHote = () => {
  try {
    // Le BOM est retiré : un `desktop.json` réécrit par un outil Windows
    // (PowerShell, éditeur) peut en porter un, et `JSON.parse` le refuse. Le
    // poste se croirait alors « non configuré » et reproposerait de créer une
    // base — exactement ce qui ne doit jamais arriver.
    const texte = readFileSync(path.join(RACINE, 'desktop.json'), 'utf8').replace(/^\uFEFF/, '');
    const config: unknown = JSON.parse(texte);
    return !!config && typeof config === 'object' && 'mode' in config && (config as { mode?: unknown }).mode === 'host';
  } catch { return false; }
};
function lireConfiance(): ConfianceCabinet | undefined {
  if (posteHote()) {
    const identity = JSON.parse(readFileSync(path.join(RACINE, 'clinic-identity.json'), 'utf8').replace(/^\uFEFF/, '')) as {id: string; origin: string};
    const certificate = new X509Certificate(readFileSync(path.join(RACINE, 'clinic-public.cer'))).toString();
    if (!verifierCertificatCabinet(certificate, identity.origin, certificate)) throw new Error('Certificat du cabinet à renouveler.');
    return { ...identity, certificate };
  }
  if (!existsSync(fichierConfiance())) return undefined;
  const text = readFileSync(fichierConfiance(), 'utf8');
  if (text.length > 12000) throw new Error('Connexion du cabinet à vérifier.');
  const value = JSON.parse(text) as ConfianceCabinet;
  if (!/^[0-9a-f-]{36}$/i.test(value.id) || !verifierCertificatCabinet(value.certificate, value.origin, value.certificate)) throw new Error('Connexion du cabinet à vérifier.');
  // Jeton de poste (178) : optionnel, pour qu'un `clinic-trust.json` écrit par
  // une version antérieure reste lisible. Un jeton mal formé est ignoré — le
  // poste devra être réappairé, mais rien n'est inventé.
  const deviceId = typeof value.deviceId === 'string' && /^[0-9a-f-]{36}$/i.test(value.deviceId) ? value.deviceId : undefined;
  const deviceToken = typeof value.deviceToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.deviceToken) ? value.deviceToken : undefined;
  return {
    id: value.id,
    origin: value.origin,
    certificate: value.certificate,
    ...(deviceId !== undefined && deviceToken !== undefined ? { deviceId, deviceToken } : {}),
  };
}
/**
 * La confiance d'un POSTE D'ACCUEIL illisible ne doit pas condamner
 * l'application : on efface l'état en mémoire et on rend la main à l'écran
 * d'appairage, qui proposera une nouvelle invitation. Sur le PC médecin, la
 * même anomalie reste FATALE : elle signifie que le certificat du cabinet ne
 * correspond plus, et proposer de « réappairer » risquerait de recréer un
 * cabinet là où il y a déjà une base.
 */
function lireConfianceOuReappairer(): ConfianceCabinet | undefined {
  try {
    return lireConfiance();
  } catch (error) {
    if (posteHote()) throw error;
    journalDesktop(app.getPath('userData'), 'CLINIC_TRUST_INVALID');
    avertissement = messages.trustInvalid;
    return undefined;
  }
}
async function appliquerConfiance(value: ConfianceCabinet): Promise<void> {
  confiance = value; configurerOrigineCabinet(validerOrigineCabinet(value.origin));
  // La sonde et la boucle d'appairage appellent cette fonction à chaque tour :
  // réinstaller les mêmes gestionnaires à chaque passage serait du bruit (et
  // l'en-tête de poste serait réenregistré indéfiniment). On ne réapplique que
  // si l'identité, l'origine, le jeton ou le certificat ont changé.
  const empreinte = `${value.id}|${value.origin}|${value.deviceToken ?? ""}|${value.certificate}`;
  if (empreinte === confianceAppliquee) return;
  confianceAppliquee = empreinte;
  // Le certificat doit être épinglé ET approuvé par Chromium/Windows.
  // -3 conserve la validation normale (chaîne, nom, expiration), jamais callback(0).
  for (const cible of [session.defaultSession, obtenirSessionSonde()]) {
    cible.setCertificateVerifyProc((request, callback) => {
      callback(request.hostname === new URL(value.origin).hostname
        && verifierCertificatCabinet(request.certificate.data, value.origin, value.certificate) ? -3 : -2);
    });
    poserEnteteAppareil(cible, value);
  }
}

/**
 * Le jeton de poste accompagne CHAQUE requête vers l'origine du cabinet.
 *
 * Pourquoi un en-tête et pas un cookie : le cookie de session appartient à
 * l'utilisateur (il change à la connexion), le jeton appartient à la MACHINE
 * (il survit aux comptes et aux sessions). Les deux sont nécessaires : l'un dit
 * « ce poste est autorisé », l'autre « cette personne est connectée ».
 *
 * Le filtre `urls` limite l'en-tête à l'origine épinglée : il ne fuit vers
 * aucun autre hôte.
 */
function poserEnteteAppareil(cible: Session, value: ConfianceCabinet): void {
  const jeton = value.deviceToken;
  if (jeton === undefined) return;
  let origine: string;
  try {
    origine = new URL(value.origin).origin;
  } catch {
    return;
  }
  cible.webRequest.onBeforeSendHeaders({ urls: [`${origine}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'X-MindCare-Device': jeton } });
  });
}
/**
 * Le nom lisible d'un cabinet découvert : le nom réseau du PC médecin, suivi de
 * l'adresse IPv4 qu'il a réellement annoncée. C'est ce que l'écran de
 * configuration affiche pour que l'on VOIE que la détection a fonctionné — sans
 * avoir à ouvrir un journal ni à saisir une adresse.
 */
function libelleCabinet(cabinet: CabinetDecouvert): string {
  let nom = cabinet.origin;
  try {
    nom = new URL(cabinet.origin).hostname;
  } catch {
    /* garde l'origine brute */
  }
  return cabinet.address === undefined ? nom : `${nom} (${cabinet.address})`;
}

/** Fusion partielle : un appel ne réécrit que ce qu'il change. */
function statut(patch: Partial<EtatEcran>): void {
  etat = { ...etat, ...patch };
  if (ecran && !ecran.isDestroyed()) ecran.webContents.send('mindcare:cabinet-etat', etat);
}

async function afficherEcran(): Promise<void> {
  if (ecran && !ecran.isDestroyed()) { ecran.show(); return; }
  const nonce = randomBytes(18).toString('base64');
  ecran = new BrowserWindow({ width: 760, height: 720, minWidth: 680, minHeight: 620, title: 'MindCare OS', show: false, backgroundColor: '#ffffff', webPreferences: {
    preload: path.join(ICI, '..', 'preload', 'cabinet.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
  } });
  ecran.setMenu(null);
  ecran.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  ecran.webContents.on('will-navigate', event => event.preventDefault());
  ecran.webContents.once('did-finish-load', () => statut({}));
  ecran.on('closed', () => { ecran = undefined; if (!arret) app.quit(); });
  await ecran.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlEcranCabinet(messages, nonce, hostname()))}`);
  ecran.show();
}
function psQuote(value: string): string { return "'" + value.replaceAll("'", "''") + "'"; }

/**
 * L'installation du cabinet a été refusée par Windows (emplacement modifiable,
 * ACL insuffisantes, UAC annulé). Distincte d'une invitation invalide : le
 * message affiché doit dire quoi faire du dossier, pas « réessayez ».
 */
class ErreurInstallation extends Error {
  constructor() {
    super('CONFIGURATION_REFUSEE');
    this.name = 'ErreurInstallation';
  }
}

async function executerInstallation(mode: 'Host' | 'Client', extra = ''): Promise<void> {
  const install = path.dirname(process.execPath);
  const script = path.join(process.resourcesPath, 'cabinet', 'configurer-cabinet.ps1');
  // Script local livré avec l'application, exécuté par UAC sans changer la politique Windows.
  const command = `$ErrorActionPreference='Stop'; try { & ([ScriptBlock]::Create([IO.File]::ReadAllText(${psQuote(script)}))) -Mode ${mode} -InstallDir ${psQuote(install)} ${extra} | Out-Null; exit 0 } catch { exit 1 }`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const powershell = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const launch = `$p=Start-Process -FilePath ${psQuote(powershell)} -WindowStyle Hidden -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',${psQuote(encoded)}); exit $p.ExitCode`;
  await new Promise<void>((resolve, reject) => execFile(powershell, ['-NoProfile','-NonInteractive','-Command',launch], {windowsHide:true, timeout:180000}, error => error ? reject(new ErreurInstallation()) : resolve()));
}

async function afficherRefusInstallation(): Promise<void> {
  await dialog.showMessageBox({
    type: 'error',
    title: messages.installationRefuseeTitre!,
    message: messages.installationRefusee!,
    buttons: [messages.close!],
  });
}
async function inviterPoste(): Promise<void> {
  if (!posteHote() || actionEnCours) return;
  actionEnCours = true;
  const secret = randomBytes(18).toString('base64url');
  const request = path.join(app.getPath('userData'), 'clinic-invitation-request.json');
  try {
    writeFileSync(request, JSON.stringify({secret, expiresAt:Date.now()+300000}), {mode:0o600});
    await executerInstallation('Host', `-InvitationFile ${psQuote(request)}`);
    await dialog.showMessageBox({
      type:'info',
      title: messages.inviteMenu!,
      message: messages.invitationTitle!,
      // Le nom du PC est affiché ici parce que c'est la seule information que
      // l'accueil peut avoir besoin de saisir si la découverte automatique est
      // bloquée par le routeur. Il est lisible, jamais secret.
      detail: `${messages.invitationBefore}\n\n${secret.match(/.{1,4}/g)!.join(' ')}\n\n${messages.invitationAfter}\n\n${messages.invitationComputerName!.replace('{nom}', hostname())}`,
      buttons:[messages.close!],
    });
  } catch (error) {
    if (error instanceof ErreurInstallation) { await afficherRefusInstallation(); }
    else { await dialog.showMessageBox({type:'error', message: messages.invitationFailed!}); }
  }
  finally { rmSync(request,{force:true}); actionEnCours = false; }
}

/**
 * Le diagnostic de découverte — la question « est-ce que ce PC voit l'autre ? »,
 * posée sans toucher à l'appairage.
 *
 * Il est désormais joignable DEPUIS l'écran d'appairage, et plus seulement par
 * le menu : c'est l'écran où l'utilisatrice se trouve quand elle en a besoin.
 */
async function diagnosticDecouverte(): Promise<void> {
  if (actionEnCours) return;
  actionEnCours = true;
  try {
    const trouves = await decouvrirCabinets();
    const corps = trouves.length === 0
      ? messages.diagnosticNone!
      : `${messages.diagnosticFound!}\n\n${trouves.map(libelleCabinet).join('\n')}`;
    await dialog.showMessageBox({
      type: trouves.length === 0 ? 'warning' : 'info',
      title: messages.diagnosticTitle!,
      message: corps,
      detail: messages.diagnosticHint!,
      buttons: [messages.close!],
    });
  } finally {
    actionEnCours = false;
  }
}

async function confirmerDevenirHote(parent: BrowserWindow | null): Promise<boolean> {
  const options = {
    type: 'question' as const,
    title: messages.hostConfirmTitle!,
    message: messages.hostConfirmBody!,
    detail: messages.hostConfirmDetail!,
    buttons: [messages.hostConfirmYes!, messages.hostConfirmNo!],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const reponse = parent === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
  return reponse.response === 0;
}

ipcMain.handle('mindcare:cabinet-action', async (event, value: unknown) => {
  if (!ecran || event.sender !== ecran.webContents || !value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;

  // Deux actions non bloquantes : elles ne modifient rien et doivent répondre
  // même pendant qu'une installation est en cours.
  if (input.action === 'retry') {
    rechercheImmediate = true;
    return;
  }
  if (input.action === 'diagnostic') {
    await diagnosticDecouverte();
    return;
  }
  if (actionEnCours) return;

  actionEnCours = true;
  try {
    if (input.action === 'host' && !confiance && candidats.length === 0 && etat.premier) {
      // Le bouton reste atteignable immédiatement, mais la conséquence est
      // confirmée en toutes lettres : c'est ce qui empêche un poste d'accueil
      // de créer une seconde base par curiosité.
      if (!(await confirmerDevenirHote(BrowserWindow.fromWebContents(event.sender)))) return;
      statut({ message: messages.prepare!, detail: '' });
      await executerInstallation('Host'); confiance = lireConfiance();
      avertissement = undefined;
      statut({ message: messages.preparingClinic!, detail: messages.preparingClinicDetail!, premier: false, invitation: false, manuelle: false });
    } else if (input.action === 'pair' && !confiance && typeof input.code === 'string') {
      const code = input.code.replace(/\s/g,'');
      if (!/^[A-Za-z0-9_-]{24}$/.test(code)) throw new Error('Invitation incorrecte.');
      let paired: ConfianceCabinet | undefined;
      for (const host of candidats.slice(0,10)) {
        try { paired = await appairerCabinet(host,code,undefined,undefined,hostname()); break; } catch { /* Prochain cabinet, aucune connexion clinique. */ }
      }
      if (!paired || !verifierCertificatCabinet(paired.certificate,paired.origin,paired.certificate)) throw new Error('Invitation expirée ou incorrecte.');
      const certificate = new X509Certificate(paired.certificate);
      const certFile = path.join(app.getPath('userData'),'clinic-pairing.cer');
      writeFileSync(certFile,certificate.raw);
      try {
        await executerInstallation('Client', `-Origin ${psQuote(paired.origin)} -PublicCertificate ${psQuote(certFile)} -CertificateSha256 ${psQuote(certificate.fingerprint256.replaceAll(':','').toLowerCase())}`);
        writeFileSync(fichierConfiance(),JSON.stringify(paired),{mode:0o600}); confiance = paired; avertissement = undefined;
        statut({ message: messages.waitingClinic!, detail: messages.waitingClinicDetail!, premier: false, invitation: false, manuelle: false });
      } finally { rmSync(certFile,{force:true}); }
    } else if (input.action === 'manual' && !confiance && typeof input.code === 'string') {
      await connecterManuellement(input.code, etat.premier);
    }
  } catch (error) {
    if (error instanceof ErreurInstallation) { await afficherRefusInstallation(); }
    else if (input.action === 'pair') { statut({ message: messages.retry!, invitation: candidats.length > 0 }); }
    else { statut({ message: messages.missing!, detail: messages.searchHelp!, premier: etat.premier, invitation: candidats.length > 0 }); }
  }
  finally { actionEnCours = false; }
});

/**
 * « Le cabinet n'apparaît pas ? » — la connexion par nom de PC.
 *
 * Elle n'introduit AUCUNE nouvelle route réseau : on résout le nom, puis on
 * envoie la requête de découverte en UNICAST à cette adresse
 * (`decouvrirCabinets(..., [adresse])`). L'appairage qui suit est celui de
 * toujours — chiffré, à usage unique. C'est le recours prévu pour les routeurs
 * qui coupent multicast et broadcast ; il ne remplace jamais le parcours normal.
 */
async function connecterManuellement(nom: string, premier: boolean): Promise<boolean> {
  const propre = nom.trim();
  if (!nomHoteValide(propre)) {
    statut({ message: messages.manualInvalid!, invitation: candidats.length > 0 });
    return false;
  }
  statut({ message: messages.manualSearch!, detail: propre, premier: false });
  const adresse = await resoudreCabinet(propre);
  const trouves = adresse === null
    ? []
    : await decouvrirCabinets(1500, PORT_DECOUVERTE, [adresse]);
  if (trouves.length === 0) {
    statut({ message: messages.manualNotFound!, detail: '', premier, invitation: candidats.length > 0 });
    return false;
  }
  candidats = trouves;
  candidatManuel = true;
  journalDesktop(app.getPath('userData'), 'CLINIC_MANUAL_FOUND');
  statut({ message: messages.found!, detail: trouves.map(libelleCabinet).join(' · '), premier: false, invitation: true });
  return true;
}

app.on('before-quit', () => { arret = true; });

export async function connecterBureauCabinet(): Promise<{mode:'client'|'host'; origin:string}> {
  mkdirSync(app.getPath('userData'), {recursive:true});
  confiance = lireConfianceOuReappairer();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'MindCare', submenu:[
    {label:messages.inviteMenu!,click:()=>{void inviterPoste();}},
    {label:messages.diagnosticMenu!,click:()=>{void diagnosticDecouverte();}},
    {role:'quit',label:messages.quit!}]}]));
  // Trusted startup belongs to the main window; discovery is enrollment only.
  if (confiance) {
    await appliquerConfiance(confiance);
    // Un poste révoqué ne doit pas continuer à croire qu'il est associé : on
    // efface la confiance et on revient à l'écran d'invitation, avec un message
    // qui dit ce qui s'est passé. Aucune donnée n'est lue avant ce contrôle.
    if (await appareilRevoque(confiance.origin, (url, options) => obtenirSessionSonde().fetch(url, options))) {
      journalDesktop(app.getPath('userData'), 'DEVICE_REVOKED');
      rmSync(fichierConfiance(), { force: true });
      confiance = undefined;
      avertissement = messages.appareilRevoque;
      statut({ message: messages.appareilRevoque!, premier: false, invitation: true });
      await afficherEcran();
    } else {
      return { mode: posteHote() ? 'host' : 'client', origin: confiance.origin };
    }
  }
  await afficherEcran();
  let recherches = 0;
  while (!arret) {
    if (actionEnCours) { await pauseEcran(300); continue; }
    if (rechercheImmediate) { rechercheImmediate = false; recherches = 0; candidatManuel = false; }

    // Une confiance existe (hôte fraîchement configuré, ou poste qui vient
    // d'être appairé) : on ne redécouvre rien, on attend que le service
    // réponde. Sur le PC médecin, la première préparation prend des minutes —
    // l'écran doit le DIRE, pas afficher « connexion interrompue ».
    if (confiance !== undefined) {
      // `confiance` est réaffectée par le gestionnaire IPC (appairage, hôte) :
      // la copie locale empêche TypeScript de la figer à `undefined` après le
      // retour anticipé ci-dessus.
      const courante = confiance as ConfianceCabinet | undefined;
      if (courante !== undefined) {
        await appliquerConfiance(courante);
        try {
          await attendreCabinet(courante.origin,(url,options)=>obtenirSessionSonde().fetch(url,options),4000);
          ecran?.hide();
          return {mode:posteHote()?'host':'client',origin:courante.origin};
        } catch {
          statut(posteHote()
            ? { message: messages.preparingClinic!, detail: messages.preparingClinicDetail!, premier: false, invitation: false, manuelle: false }
            : { message: messages.reconnecting!, detail: '', premier: false, invitation: false, manuelle: false });
          await pauseEcran(posteHote() ? 2000 : 1500);
          continue;
        }
      }
    }

    const baseExistante = existsSync(path.join(RACINE,'data','PG_VERSION'));
    // Un cabinet trouvé par nom reste affiché : la découverte de diffusion ne
    // doit pas le remplacer par une liste vide.
    if (candidatManuel && candidats.length > 0) {
      await pauseEcran(1500);
      continue;
    }
    if (recherches < RECHERCHES_RAPIDES) {
      statut({
        message: messages.search!,
        detail: messages.searchCount!.replace('{n}', String(recherches + 1)).replace('{total}', String(RECHERCHES_RAPIDES)),
        premier: false,
        invitation: false,
      });
    }
    candidats = await decouvrirCabinets(fenetreRecherche(recherches));
    recherches += 1;
    if (candidats.length > 0) {
      statut({
        message: avertissement === undefined ? messages.found! : `${avertissement} ${messages.found!}`,
        detail: candidats.map(libelleCabinet).join(' · '),
        premier: false,
        invitation: true,
      });
    } else if (recherches >= RECHERCHES_RAPIDES) {
      statut({
        message: avertissement === undefined ? messages.missing! : `${avertissement} ${messages.missing!}`,
        detail: messages.searchHelp!,
        premier: proposerHote(recherches, 0, baseExistante),
        invitation: false,
      });
    }
    await pauseEcran(delaiEntreRecherches(recherches));
  }
  throw new Error('Application fermée.');
}

/** Pause interruptible : « Rechercher à nouveau » ne doit pas attendre 2,5 s. */
function pauseEcran(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const fin = Date.now() + ms;
    const tic = (): void => {
      if (arret || rechercheImmediate || Date.now() >= fin) { resolve(); return; }
      setTimeout(tic, 100);
    };
    tic();
  });
}

/**
 * Redécouverte et remappage après un changement d'adresse du cabinet.
 *
 * Déclenchée seulement quand la sonde a échoué au moins deux fois de suite —
 * une coupure d'un seul cycle ne justifie pas de toucher au transport. Le
 * certificat épinglé reste vérifié par Chromium : ce module ne fait que
 * changer l'adresse vers laquelle le proxy local relaie les octets.
 */
async function forcerAdresseDecouverte(): Promise<void> {
  const courant = confiance;
  if (courant === undefined || posteHote()) return;

  let origine: URL;
  try {
    origine = new URL(courant.origin);
  } catch {
    return;
  }

  try {
    const candidats = await decouvrirCabinets();
    const trouve = candidats.find((c) => c.id === courant.id && typeof c.address === 'string');
    if (trouve?.address === undefined) {
      journalDesktop(app.getPath('userData'), 'HOST_IP_NOT_DISCOVERED');
      return;
    }

    adresseForcee = trouve.address;
    if (remappage === undefined) {
      remappage = await demarrerRemappage({
        hostname: origine.hostname,
        port: Number(origine.port === '' ? '443' : origine.port),
        resolve: () => adresseForcee,
      });
      journalDesktop(app.getPath('userData'), 'HOST_IP_REMAP_STARTED');
    }

    // `setProxy` n'affecte que les connexions NOUVELLES : on ferme les
    // existantes pour que le flux SSE et les sondes repassent tout de suite.
    for (const cible of [session.defaultSession, obtenirSessionSonde()]) {
      await cible.setProxy({ proxyRules: `https=127.0.0.1:${remappage.port}` });
      cible.closeAllConnections();
    }
    journalDesktop(app.getPath('userData'), 'HOST_IP_REMAPPED');
  } catch {
    journalDesktop(app.getPath('userData'), 'HOST_IP_REMAP_FAILED');
  }
}

export function surveillerCabinet(fenetre: BrowserWindow): void {
  let busy = false;
  let echecsConsecutifs = 0;
  const stabilite = creerStabiliteSondeCabinet();
  const titre = fenetre.getTitle();
  const timer = setInterval(async () => {
    if (busy || arret || fenetre.isDestroyed() || !confiance) return;
    busy = true;
    try {
      await attendreCabinet(confiance.origin,(url,options)=>obtenirSessionSonde().fetch(url,options),3000);
      journalDesktop(app.getPath('userData'), 'HEALTH_OK');
      echecsConsecutifs = 0;
      if (stabilite.succes()) fenetre.setTitle(titre);
    } catch (error) {
      journalDesktop(app.getPath('userData'), error instanceof ErreurConnexionCabinet ? error.code : 'HEALTH_FAILED');
      echecsConsecutifs += 1;
      if (stabilite.echec()) {
        fenetre.setTitle(messages.reconnecting!);
      }
      // Un poste révoqué est refusé par le proxy (403) sur toute route
      // protégée, alors que `/api/health` reste ouvert : la sonde de santé ne
      // peut donc pas le voir. On interroge une route protégée une seule fois
      // par panne, pour ne pas confondre une coupure réseau avec une
      // révocation.
      if (echecsConsecutifs === 2) {
        const courant = confiance;
        if (courant !== undefined) {
          void appareilRevoque(courant.origin, (url, options) => obtenirSessionSonde().fetch(url, options)).then((revoque) => {
            if (revoque && !fenetre.isDestroyed()) {
              journalDesktop(app.getPath('userData'), 'DEVICE_REVOKED_LIVE');
              fenetre.setTitle(messages.appareilRevoque!);
            }
          });
        }
      }
      // Deux échecs pour la première tentative, puis une toutes les six : une
      // adresse qui change deux fois de suite ne doit pas condamner la session,
      // et une découverte toutes les cinq secondes serait du bruit réseau.
      if (echecsConsecutifs >= 2 && (echecsConsecutifs === 2 || echecsConsecutifs % 6 === 0)) {
        void forcerAdresseDecouverte();
      }
    } finally { busy=false; }
  },5000);
  timer.unref(); fenetre.once('closed',()=>clearInterval(timer));
}

/**
 * UNE tentative bornée de joindre le cabinet. Lève en cas d'échec : c'est
 * l'appelant (`index.ts`) qui décide combien de fois réessayer et ce qu'affiche
 * l'écran. Une fonction qui boucle indéfiniment ici empêcherait l'application
 * de proposer une sortie de secours quand le PC médecin a été remplacé.
 */
export async function attendreConnexionCabinet(
  signal?: AbortSignal,
  options: { readonly budgetMs?: number } = {},
): Promise<void> {
  if (!confiance) throw new Error('CONFIGURATION_CABINET');
  const budget = options.budgetMs ?? 120_000;
  if (posteHote()) {
    try {
      await attendreCabinet(confiance.origin, (url, optionsFetch) => obtenirSessionSonde().fetch(url, optionsFetch), 1500, signal);
      return;
    } catch { signal?.throwIfAborted(); }
    // Start the existing, protected host task only; never provision another database.
    await demanderDemarrageTache();
  }
  await attendreCabinet(confiance.origin, (url, optionsFetch) => obtenirSessionSonde().fetch(url, optionsFetch), budget, signal);
}

let tacheDemandee = false;
function demanderDemarrageTache(): Promise<void> {
  if (tacheDemandee) return Promise.resolve();
  tacheDemandee = true;
  return new Promise<void>(resolve => execFile(path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'schtasks.exe'), ['/Run', '/TN', 'MindCare-Clinic-Server'], { windowsHide: true, timeout: 5000 }, error => {
    journalDesktop(app.getPath('userData'), error ? 'HOST_TASK_START_FAILED' : 'HOST_TASK_START_REQUESTED');
    resolve();
  }));
}

/**
 * Sortie de secours d'un poste d'accueil : oublier l'autorisation et revenir à
 * l'écran d'invitation. Appelée UNIQUEMENT depuis le processus principal, après
 * confirmation native — jamais depuis le renderer.
 */
export async function reconnecterPoste(parent: BrowserWindow | null): Promise<boolean> {
  const options = {
    type: 'question' as const,
    title: messages.reconnectConfirmTitle!,
    message: messages.reconnectConfirmBody!,
    detail: messages.reconnectConfirmDetail!,
    buttons: [messages.reconnectStation!, messages.close!],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const reponse = parent === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
  if (reponse.response !== 0) return false;
  try { rmSync(fichierConfiance(), { force: true }); } catch { /* absent = résultat voulu */ }
  journalDesktop(app.getPath('userData'), 'DEVICE_FORGOTTEN');
  return true;
}
