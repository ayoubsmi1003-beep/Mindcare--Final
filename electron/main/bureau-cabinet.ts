import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import type { Session } from 'electron';
import { execFile } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appairerCabinet, choisirCabinet, decouvrirCabinets, type CabinetDecouvert, type ConfianceCabinet } from './decouverte-cabinet.js';
import { demarrerRemappage, type Remappage } from './remappage-cabinet.js';
import { configurerOrigineCabinet } from './config.js';
import { attendreCabinet, creerSessionSondeCabinet, creerStabiliteSondeCabinet, validerOrigineCabinet, ErreurConnexionCabinet, appareilRevoque } from './connexion-cabinet.js';
import { verifierCertificatCabinet } from './confiance-cabinet.js';
import { journalDesktop } from './journal-desktop.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(process.env['ProgramData'] ?? 'C:\\ProgramData', 'MindCare');
const messages = JSON.parse(readFileSync(app.isPackaged ? path.join(process.resourcesPath, 'cabinet', 'messages-fr.json') : path.resolve(ICI, '..', '..', 'src', 'i18n', 'cabinet-desktop.fr.json'), 'utf8')) as Record<string, string>;
let ecran: BrowserWindow | undefined;
let confiance: ConfianceCabinet | undefined;
let candidats: CabinetDecouvert[] = [];
let actionEnCours = false;
let arret = false;
let sessionSonde: Session | undefined;
let etat = { message: messages.search!, premier: false, invitation: false, detail: '' };
/**
 * Remappage d'adresse (178) : activé seulement après deux échecs consécutifs,
 * quand la découverte UDP a trouvé l'adresse IPv4 courante du cabinet. Le
 * certificat épinglé et son SAN restent vérifiés — on ne change QUE l'adresse
 * vers laquelle le proxy local relaie les octets.
 */
let remappage: Remappage | undefined;
let adresseForcee: string | null = null;
let remapTente = false;
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
  try { const config: unknown = JSON.parse(readFileSync(path.join(RACINE, 'desktop.json'), 'utf8')); return !!config && typeof config === 'object' && 'mode' in config && config.mode === 'host'; } catch { return false; }
};
function lireConfiance(): ConfianceCabinet | undefined {
  if (posteHote()) {
    const identity = JSON.parse(readFileSync(path.join(RACINE, 'clinic-identity.json'), 'utf8')) as {id: string; origin: string};
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
function appliquerConfiance(value: ConfianceCabinet): void {
  confiance = value; configurerOrigineCabinet(validerOrigineCabinet(value.origin));
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

function statut(message: string, premier = false, invitation = false, detail = ''): void {
  etat = { message, premier, invitation, detail };
  if (ecran && !ecran.isDestroyed()) ecran.webContents.send('mindcare:cabinet-etat', etat);
}
async function afficherEcran(): Promise<void> {
  if (ecran && !ecran.isDestroyed()) { ecran.show(); return; }
  const nonce = randomBytes(18).toString('base64');
  ecran = new BrowserWindow({ width: 680, height: 540, title: 'MindCare OS', show: false, webPreferences: {
    preload: path.join(ICI, '..', 'preload', 'cabinet.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
  } });
  ecran.setMenu(null);
  ecran.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  ecran.webContents.on('will-navigate', event => event.preventDefault());
  ecran.webContents.once('did-finish-load', () => statut(etat.message, etat.premier, etat.invitation, etat.detail));
  ecran.on('closed', () => { ecran = undefined; if (!arret) app.quit(); });
  await ecran.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><title>MindCare OS</title><style nonce="${nonce}">body{font:16px Segoe UI,Arial;padding:40px;line-height:1.6}h1{font-size:24px}button,input{font:inherit;padding:10px;margin-top:14px}input{width:90%}[hidden]{display:none}small{display:block;margin-top:14px}.detail{margin-top:6px;color:#1a6b63;font-weight:600;word-break:break-word}</style><h1>MindCare OS</h1><p role="status" id="message">${messages.search}</p><p id="detail" class="detail" hidden></p><div id="premier" hidden><button id="host">${messages.hostButton}</button><small>${messages.hostHelp}</small></div><div id="invitation" hidden><label for="code">${messages.invitationLabel}</label><input id="code" autocomplete="off" spellcheck="false"><button id="pair">${messages.pairButton}</button><small>${messages.pairHelp}</small></div><script nonce="${nonce}">window.cabinet.onEtat(e=>{document.getElementById('message').textContent=e.message;const d=document.getElementById('detail');d.textContent=e.detail||'';d.hidden=!e.detail;document.getElementById('premier').hidden=!e.premier;document.getElementById('invitation').hidden=!e.invitation});document.getElementById('host').onclick=()=>window.cabinet.action('host');document.getElementById('pair').onclick=()=>{const input=document.getElementById('code');const code=input.value;input.value='';window.cabinet.action('pair',code)};</script></html>`)}`);
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
    await dialog.showMessageBox({type:'info', title:messages.inviteMenu!, message:messages.invitationTitle!, detail:`${messages.invitationBefore}\n\n${secret.match(/.{1,4}/g)!.join(' ')}\n\n${messages.invitationAfter}`, buttons:[messages.close!]});
  } catch (error) {
    if (error instanceof ErreurInstallation) { await afficherRefusInstallation(); }
    else { await dialog.showMessageBox({type:'error', message:messages.invitationFailed!}); }
  }
  finally { rmSync(request,{force:true}); actionEnCours = false; }
}
ipcMain.handle('mindcare:cabinet-action', async (event, value: unknown) => {
  if (!ecran || event.sender !== ecran.webContents || !value || typeof value !== 'object' || actionEnCours) return;
  const input = value as Record<string, unknown>;
  actionEnCours = true;
  try {
    if (input.action === 'host' && !confiance && candidats.length === 0 && etat.premier) {
      // Confirme un choix de machine, jamais un rôle applicatif.
      statut(messages.prepare!);
      await executerInstallation('Host'); confiance = lireConfiance();
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
      } finally { rmSync(certFile,{force:true}); }
    }
  } catch (error) {
    if (error instanceof ErreurInstallation) { await afficherRefusInstallation(); }
    statut(messages.retry!, false, true);
  }
  finally { actionEnCours = false; }
});
app.on('before-quit', () => { arret = true; });

/**
 * « Diagnostic de découverte » — la question « est-ce que ce PC voit l'autre ? »,
 * posée sans toucher à l'appairage.
 *
 * On relance une découverte UDP et on affiche le résultat dans une boîte native.
 * Aucun écran supplémentaire, aucune fenêtre à gérer : c'est un geste de
 * vérification, pas un parcours. Sur le PC médecin, il se voit lui-même ; sur le
 * PC d'accueil, il doit voir le nom du PC médecin et son adresse.
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

export async function connecterBureauCabinet(): Promise<{mode:'client'|'host'; origin:string}> {
  mkdirSync(app.getPath('userData'), {recursive:true});
  confiance = lireConfiance();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'MindCare', submenu:[
    {label:messages.inviteMenu!,click:()=>{void inviterPoste();}},
    {label:messages.diagnosticMenu!,click:()=>{void diagnosticDecouverte();}},
    {role:'quit',label:messages.quit!}]}]));
  // Trusted startup belongs to the main window; discovery is enrollment only.
  if (confiance) {
    appliquerConfiance(confiance);
    // Un poste révoqué ne doit pas continuer à croire qu'il est associé : on
    // efface la confiance et on revient à l'écran d'invitation, avec un message
    // qui dit ce qui s'est passé. Aucune donnée n'est lue avant ce contrôle.
    if (await appareilRevoque(confiance.origin, (url, options) => obtenirSessionSonde().fetch(url, options))) {
      journalDesktop(app.getPath('userData'), 'DEVICE_REVOKED');
      rmSync(fichierConfiance(), { force: true });
      confiance = undefined;
      avertissement = messages.appareilRevoque;
      statut(avertissement!, false, true);
      await afficherEcran();
    } else {
      return { mode: posteHote() ? 'host' : 'client', origin: confiance.origin };
    }
  }
  await afficherEcran();
  let recherches = 0;
  while (!arret) {
    if (actionEnCours) { await new Promise(r=>setTimeout(r,500)); continue; }
    const approuvee = lireConfiance();
    if (approuvee) {
      appliquerConfiance(approuvee);
      try {
        await attendreCabinet(approuvee.origin,(url,options)=>obtenirSessionSonde().fetch(url,options),4500);
        ecran?.hide();
        return {mode:posteHote()?'host':'client',origin:approuvee.origin};
      } catch { /* Réessaie l’origine approuvée sans exiger UDP ni créer une autre base. */ }
      statut(messages.reconnecting!);
    } else {
      candidats = await decouvrirCabinets(); recherches++;
      const baseExistante = existsSync(path.join(RACINE,'data','PG_VERSION'));
      const base = candidats.length ? messages.found! : messages.missing!;
      statut(avertissement === undefined ? base : `${avertissement} ${base}`, recherches>=3 && candidats.length===0 && !baseExistante, candidats.length>0, candidats.map(libelleCabinet).join(' · '));
    }
    await new Promise(r=>setTimeout(r,1500));
  }
  throw new Error('Application fermée.');
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

export async function attendreConnexionCabinet(signal?: AbortSignal): Promise<void> {
  if (!confiance) throw new Error('CONFIGURATION_CABINET');
  if (posteHote()) {
    try {
      await attendreCabinet(confiance.origin, (url, options) => obtenirSessionSonde().fetch(url, options), 1500, signal);
      return;
    } catch { signal?.throwIfAborted(); }
    // Start the existing, protected host task only; never provision another database.
    await new Promise<void>(resolve => execFile(path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'schtasks.exe'), ['/Run', '/TN', 'MindCare-Clinic-Server'], { windowsHide: true, timeout: 5000 }, error => {
      journalDesktop(app.getPath('userData'), error ? 'HOST_TASK_START_FAILED' : 'HOST_TASK_START_REQUESTED');
      resolve();
    }));
  }
  await attendreCabinet(confiance.origin, (url, options) => obtenirSessionSonde().fetch(url, options), 120000, signal);
}
