import { createSocket, type Socket } from 'node:dgram';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { validerOrigineCabinet } from './connexion-cabinet.js';
export interface CabinetDecouvert { id: string; origin: string; address?: string }
export interface ConfianceCabinet {
  id: string;
  origin: string;
  certificate: string;
  /**
   * Jeton du poste, remis UNE SEULE FOIS à l'appairage (178). Il n'accorde
   * aucun droit : il prouve au proxy que la requête vient d'une machine que le
   * médecin a autorisée. Absent pour un poste appairé avant cette version.
   */
  deviceId?: string;
  deviceToken?: string;
}
export const PORT_DECOUVERTE = 43119;
const GROUPE = '239.255.77.67';
const SERVICE = 'mindcare-clinic-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXE = Buffer.from('MC-PAIR-1:');
export function choisirCabinet(items: CabinetDecouvert[], id: string | undefined): CabinetDecouvert | undefined {
  const candidats = items.filter(item => id === undefined || item.id === id);
  return candidats.length === 1 ? candidats[0] : undefined;
}
function cle(secret: string): Buffer {
  if (!/^[A-Za-z0-9_-]{24}$/.test(secret)) throw new Error('Invitation invalide.');
  return createHash('sha256').update('mindcare-invitation-v1:').update(secret).digest();
}
// Invitation aléatoire de 144 bits, pas un mot de passe humain ni une empreinte.
export function scellerInvitation(secret: string, value: unknown): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cle(secret), nonce);
  cipher.setAAD(PREFIXE);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([PREFIXE, nonce, cipher.getAuthTag(), data]);
}
export function ouvrirInvitation(secret: string, bytes: Buffer): unknown {
  if (bytes.length < PREFIXE.length + 29 || bytes.length > 12000 || !bytes.subarray(0, PREFIXE.length).equals(PREFIXE)) throw new Error('Invitation invalide.');
  const offset = PREFIXE.length;
  const cipher = createDecipheriv('aes-256-gcm', cle(secret), bytes.subarray(offset, offset + 12));
  cipher.setAAD(PREFIXE); cipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(offset + 28)), cipher.final()]).toString('utf8')) as unknown;
}
function adresseLocale(address: string): boolean {
  try { validerOrigineCabinet(`https://${address}`); return /^\d+\.\d+\.\d+\.\d+$/.test(address); } catch { return false; }
}
function interfacesLocales(): {address: string; broadcast: string}[] {
  return Object.values(networkInterfaces()).flatMap(items => items ?? []).filter(item => item.family === 'IPv4' && !item.internal && adresseLocale(item.address)).map(item => {
    const ip = item.address.split('.').map(Number); const mask = item.netmask.split('.').map(Number);
    return { address: item.address, broadcast: ip.map((n, i) => n | (~mask[i]! & 255)).join('.') };
  });
}
function lireCabinet(value: unknown): CabinetDecouvert {
  if (!value || typeof value !== 'object') throw new Error('Annonce invalide.');
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !UUID.test(item.id) || typeof item.origin !== 'string') throw new Error('Annonce invalide.');
  return { id: item.id, origin: validerOrigineCabinet(item.origin) };
}
async function lier(socket: Socket, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.bind(port, '0.0.0.0', () => { socket.removeListener('error', reject); resolve(); }); });
}
export async function decouvrirCabinets(ms = 1800, port = PORT_DECOUVERTE, targets?: string[]): Promise<CabinetDecouvert[]> {
  const socket = createSocket('udp4'); const challenge = randomBytes(18).toString('base64url');
  const found = new Map<string, CabinetDecouvert>(); const conflictuels = new Set<string>();
  try {
    await lier(socket, 0); socket.setBroadcast(true); socket.setMulticastTTL(1);
    socket.on('error', () => {});
    socket.on('message', (bytes, remote) => {
      try {
        if (bytes.length > 2048 || remote.port !== port || !adresseLocale(remote.address)) return;
        const value = JSON.parse(bytes.toString()) as Record<string, unknown>;
        if (value.service !== SERVICE || value.challenge !== challenge) return;
        const item = lireCabinet(value); const previous = found.get(item.id);
        if (previous && previous.origin !== item.origin) { conflictuels.add(item.id); return; }
        if (!previous || previous.address === '127.0.0.1') found.set(item.id, { ...item, address: remote.address });
      } catch { /* Annonce inconnue : aucune confiance ni donnée patient. */ }
    });
    const query = Buffer.from(JSON.stringify({ service: SERVICE, challenge }));
    const send = () => {
      if (targets) { for (const target of targets) socket.send(query, port, target, () => {}); return; }
      socket.send(query, port, '127.0.0.1', () => {});
      for (const iface of interfacesLocales()) {
        try { socket.setMulticastInterface(iface.address); socket.send(query, port, GROUPE, () => {}); } catch { /* Autre interface. */ }
        socket.send(query, port, iface.broadcast, () => {});
      }
    };
    send(); const retry = setInterval(send, 400);
    try { await new Promise(r => setTimeout(r, ms)); } finally { clearInterval(retry); }
    return [...found.values()].filter(item => !conflictuels.has(item.id));
  } finally { try { socket.close(); } catch { /* Pas encore lié. */ } }
}
export type Invite = () => { secret: string; expiresAt: number } | undefined;

/**
 * Options d'annonce — l'objet remplace peu à peu le simple callback.
 *
 * L'ancienne signature (`invite` seul) reste acceptée : les tests existants et
 * `scripts/configurer-cabinet.ps1` continuent de fonctionner sans modification.
 * Les callbacks ajoutés portent les garanties de la 178 : usage unique, verrou
 * après cinq échecs, et remise d'un jeton de poste.
 */
export interface OptionsAnnonce {
  readonly invitation: Invite;
  /** Appelé AVANT l'envoi de la réponse : le code est brûlé. */
  readonly consommer?: (secret: string) => void;
  /** Un paquet d'appairage invalide (déchiffrement ou forme). */
  readonly echec?: () => void;
  /** Enregistre le poste et rend son jeton, une seule fois. */
  readonly enregistrerAppareil?: (label: string) => { readonly deviceId: string; readonly deviceToken: string } | undefined;
}

function estOptions(valeur: Invite | OptionsAnnonce): valeur is OptionsAnnonce {
  return typeof valeur === "object" && valeur !== null && typeof valeur.invitation === "function";
}

export async function annoncerCabinet(
  host: CabinetDecouvert,
  cert: string,
  invite: Invite | OptionsAnnonce,
  port = PORT_DECOUVERTE,
): Promise<Socket> {
  const options: OptionsAnnonce = estOptions(invite) ? invite : { invitation: invite };
  lireCabinet(host);
  const socket = createSocket({ type: 'udp4', reuseAddr: false });
  try { await lier(socket, port); } catch (error) { socket.close(); throw error; }
  socket.setMulticastTTL(1);
  for (const iface of interfacesLocales()) { try { socket.addMembership(GROUPE, iface.address); } catch { /* Broadcast disponible. */ } }
  let budget = 0; let fenetre = Date.now();
  socket.on('error', () => {});
  socket.on('message', (bytes, remote) => {
    try {
      if (!adresseLocale(remote.address) || bytes.length > 2048) return;
      if (Date.now() - fenetre > 1000) { budget = 0; fenetre = Date.now(); }
      if (++budget > 40) return;
      if (bytes.subarray(0, PREFIXE.length).equals(PREFIXE)) {
        const invitation = options.invitation();
        if (!invitation || invitation.expiresAt < Date.now() || invitation.expiresAt > Date.now() + 310000) return;

        let request: Record<string, unknown>;
        try {
          const ouvert = ouvrirInvitation(invitation.secret, bytes);
          if (typeof ouvert !== 'object' || ouvert === null) { options.echec?.(); return; }
          request = ouvert as Record<string, unknown>;
        } catch {
          // Le paquet porte le préfixe mais ne se déchiffre pas : tentative
          // hostile ou code périmé. On compte, on ne répond rien.
          options.echec?.();
          return;
        }

        if (request.kind !== 'request' || request.id !== host.id || typeof request.challenge !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(request.challenge)) {
          options.echec?.();
          return;
        }

        // Le code est brûlé AVANT la réponse. Si le paquet se perd, le médecin
        // en génère un autre — une fenêtre de rejeu fermée vaut mieux qu'un
        // code qui traîne cinq minutes.
        options.consommer?.(invitation.secret);
        const label = typeof request.label === 'string' && request.label.length > 0 && request.label.length <= 80
          ? request.label
          : "Poste d'accueil";
        const appareil = options.enregistrerAppareil?.(label);
        socket.send(scellerInvitation(invitation.secret, {
          kind: 'response',
          ...host,
          certificate: cert,
          challenge: request.challenge,
          ...(appareil === undefined ? {} : { deviceId: appareil.deviceId, deviceToken: appareil.deviceToken }),
        }), remote.port, remote.address, () => {});
      } else {
        const query = JSON.parse(bytes.toString()) as Record<string, unknown>;
        if (query.service !== SERVICE || typeof query.challenge !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(query.challenge)) return;
        socket.send(Buffer.from(JSON.stringify({ service: SERVICE, id: host.id, origin: host.origin, challenge: query.challenge })), remote.port, remote.address, () => {});
      }
    } catch { /* Aucun détail cryptographique ni secret dans les logs. */ }
  });
  return socket;
}
export async function appairerCabinet(host: CabinetDecouvert, secret: string, port = PORT_DECOUVERTE, ms = 3000, label?: string): Promise<ConfianceCabinet> {
  lireCabinet(host); cle(secret);
  if (!host.address || !adresseLocale(host.address)) throw new Error('Cabinet introuvable.');
  const socket = createSocket('udp4'); const challenge = randomBytes(18).toString('base64url');
  try {
    await lier(socket, 0);
    return await new Promise<ConfianceCabinet>((resolve, reject) => {
      const finish = (value?: ConfianceCabinet) => { clearTimeout(timer); clearInterval(retry); value ? resolve(value) : reject(new Error('Invitation expirée ou incorrecte.')); };
      const timer = setTimeout(() => finish(), ms);
      // `label` est le nom du poste, choisi par le poste lui-même. Il sert au
      // médecin à reconnaître un appareil dans la liste, jamais à autoriser.
      const packet = scellerInvitation(secret, { kind: 'request', id: host.id, challenge, label: typeof label === 'string' ? label.slice(0, 80) : undefined });
      const send = () => socket.send(packet, port, host.address, () => {});
      const retry = setInterval(send, 400);
      socket.on('error', () => finish());
      socket.on('message', (bytes, remote) => {
        try {
          if (remote.address !== host.address || remote.port !== port) return;
          const value = ouvrirInvitation(secret, bytes) as Record<string, unknown>;
          const item = lireCabinet(value);
          if (value.kind !== 'response' || item.id !== host.id || item.origin !== host.origin || value.challenge !== challenge || typeof value.certificate !== 'string' || value.certificate.length > 8192) return;
          // Jeton de poste (178) : facultatif pour rester compatible avec un
          // hôte qui n'aurait pas encore la migration. Un jeton mal formé est
          // ignoré plutôt que de faire échouer tout l'appairage — le poste
          // fonctionnera, mais le proxy le refusera jusqu'à un nouvel appairage.
          const deviceId = typeof value.deviceId === 'string' && UUID.test(value.deviceId) ? value.deviceId : undefined;
          const deviceToken = typeof value.deviceToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.deviceToken) ? value.deviceToken : undefined;
          finish({
            ...item,
            certificate: value.certificate,
            ...(deviceId !== undefined && deviceToken !== undefined ? { deviceId, deviceToken } : {}),
          });
        } catch { /* Réponse non authentifiée refusée. */ }
      });
      send();
    });
  } finally { socket.close(); }
}
