/**
 * Les postes appairés au cabinet — registre côté HÔTE (processus principal).
 *
 * ═══ POURQUOI UN FICHIER, ET PAS LA BASE ════════════════════════════════════
 *
 * Ce registre répond à une question que la base ne peut pas trancher :
 * « cette requête HTTPS arrive-t-elle d'un poste que le médecin a autorisé ? »
 * Elle est posée par le proxy TLS AVANT toute session — donc avant qu'une
 * identité existe. Un jeton de poste n'est pas un compte : il ne donne accès à
 * rien, il ferme la porte aux machines qui ne l'ont pas.
 *
 * Le fichier vit dans `%ProgramData%\MindCare\private`, dont les ACL sont
 * SYSTEM + Administrateurs (voir `configurer-cabinet.ps1`). Il ne contient que
 * des empreintes SHA-256 : une copie du fichier ne permet pas de rejouer un
 * poste.
 *
 * ═══ CE QUE CE MODULE DOIT GARANTIR ═════════════════════════════════════════
 *
 *   · FAIL CLOSED — un fichier illisible n'autorise AUCUN poste. On ne
 *     retombe jamais sur « tout est permis » ;
 *   · écriture ATOMIQUE — un `.tmp` puis un `rename`, pour qu'un lecteur
 *     concurrent (le proxy) ne voie jamais un JSON tronqué ;
 *   · comparaison à TEMPS CONSTANT — un jeton est un secret, même haché.
 *
 * ═══ LE FORMAT EST PARTAGÉ AVEC `src/server/cabinet/appareils.ts` ═══════════
 *
 * Le backend Next.js (routes `/api/cabinet/*`) lit et écrit le MÊME fichier,
 * avec sa propre copie du format — `src/` ne peut pas importer `electron/`.
 * Les deux implémentations sont couvertes par un test qui les fait lire le
 * même contenu : une divergence de format doit échouer, pas se découvrir en
 * cabinet.
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AppareilEnregistre {
  readonly deviceId: string;
  readonly label: string;
  readonly tokenSha256: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

/** Vue sans secret : c'est la seule forme qui sort vers l'interface. */
export interface AppareilPublic {
  readonly deviceId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

interface FichierAppareils {
  readonly version: 1;
  readonly devices: readonly AppareilEnregistre[];
}

const TAILLE_MAX = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function vide(): FichierAppareils {
  return { version: 1, devices: [] };
}

/**
 * Lit le registre. Toute anomalie rend un registre VIDE plutôt qu'une erreur :
 * le proxy doit pouvoir répondre «non» sans lever, et un fichier corrompu ne
 * doit jamais ouvrir l'accès. Le médecin réappaire le poste.
 */
export function lireAppareils(fichier: string): FichierAppareils {
  try {
    if (!existsSync(fichier)) return vide();
    if (statSync(fichier).size > TAILLE_MAX) return vide();
    const brut: unknown = JSON.parse(readFileSync(fichier, "utf8"));
    if (typeof brut !== "object" || brut === null) return vide();
    const objet = brut as Record<string, unknown>;
    if (objet["version"] !== 1 || !Array.isArray(objet["devices"])) return vide();

    const devices: AppareilEnregistre[] = [];
    for (const entree of objet["devices"]) {
      if (typeof entree !== "object" || entree === null) continue;
      const d = entree as Record<string, unknown>;
      if (typeof d["deviceId"] !== "string" || !UUID.test(d["deviceId"])) continue;
      if (typeof d["label"] !== "string" || d["label"].length === 0 || d["label"].length > 80) continue;
      if (typeof d["tokenSha256"] !== "string" || !/^[0-9a-f]{64}$/i.test(d["tokenSha256"])) continue;
      if (typeof d["createdAt"] !== "string") continue;
      devices.push({
        deviceId: d["deviceId"],
        label: d["label"],
        tokenSha256: d["tokenSha256"].toLowerCase(),
        createdAt: d["createdAt"],
        lastSeenAt: typeof d["lastSeenAt"] === "string" ? d["lastSeenAt"] : null,
        revokedAt: typeof d["revokedAt"] === "string" ? d["revokedAt"] : null,
      });
    }
    return { version: 1, devices };
  } catch {
    return vide();
  }
}

/** Écriture atomique : jamais de JSON partiel visible par le proxy. */
export function ecrireAppareils(fichier: string, contenu: FichierAppareils): void {
  mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaire, JSON.stringify(contenu), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaire, fichier);
}

export function hacherJeton(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

/** Longueur fixe (32 octets base64url) : un jeton d'appareil n'est pas un mot de passe. */
export function jetonValide(jeton: unknown): jeton is string {
  return typeof jeton === "string" && /^[A-Za-z0-9_-]{43}$/.test(jeton);
}

/**
 * Vérifie un jeton de poste. Rend l'appareil correspondant, ou `undefined`.
 * Comparaison à temps constant sur l'empreinte — un jeton est un secret.
 */
export function verifierJeton(fichier: string, jeton: string | undefined): AppareilPublic | undefined {
  if (!jetonValide(jeton)) return undefined;
  const empreinte = Buffer.from(hacherJeton(jeton), "hex");
  const registre = lireAppareils(fichier);
  for (const appareil of registre.devices) {
    if (appareil.revokedAt !== null) continue;
    const attendu = Buffer.from(appareil.tokenSha256, "hex");
    if (attendu.length !== empreinte.length) continue;
    if (timingSafeEqual(attendu, empreinte)) {
      return {
        deviceId: appareil.deviceId,
        label: appareil.label,
        createdAt: appareil.createdAt,
        lastSeenAt: appareil.lastSeenAt,
        revokedAt: appareil.revokedAt,
      };
    }
  }
  return undefined;
}

/** Enregistre un nouveau poste et rend le jeton EN CLAIR, une seule fois. */
export function enregistrerAppareil(
  fichier: string,
  label: string,
): { readonly deviceId: string; readonly deviceToken: string } {
  const nom = label.trim().slice(0, 80) || "Poste d'accueil";
  const deviceToken = randomBytes(32).toString("base64url");
  const deviceId = randomUUID();
  const registre = lireAppareils(fichier);
  ecrireAppareils(fichier, {
    version: 1,
    devices: [
      ...registre.devices,
      {
        deviceId,
        label: nom,
        tokenSha256: hacherJeton(deviceToken),
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
        revokedAt: null,
      },
    ],
  });
  return { deviceId, deviceToken };
}

export function listerAppareils(fichier: string): readonly AppareilPublic[] {
  return lireAppareils(fichier).devices.map((a) => ({
    deviceId: a.deviceId,
    label: a.label,
    createdAt: a.createdAt,
    lastSeenAt: a.lastSeenAt,
    revokedAt: a.revokedAt,
  }));
}

/** Révocation immédiate : le prochain appel du poste est refusé par le proxy. */
export function revoquerAppareil(fichier: string, deviceId: string): boolean {
  if (!UUID.test(deviceId)) return false;
  const registre = lireAppareils(fichier);
  let touche = false;
  const devices = registre.devices.map((a) => {
    if (a.deviceId !== deviceId) return a;
    touche = true;
    return { ...a, revokedAt: a.revokedAt ?? new Date().toISOString() };
  });
  if (touche) ecrireAppareils(fichier, { version: 1, devices });
  return touche;
}

/**
 * Note la dernière activité d'un poste, au plus une fois par minute : le proxy
 * appelle cette fonction à chaque requête, et réécrire le fichier à chaque
 * fois userait le disque pour un indicateur d'interface.
 */
export function toucherAppareil(fichier: string, deviceId: string): void {
  const registre = lireAppareils(fichier);
  const maintenant = Date.now();
  let modifie = false;
  const devices = registre.devices.map((a) => {
    if (a.deviceId !== deviceId || a.revokedAt !== null) return a;
    const precedent = a.lastSeenAt === null ? 0 : Date.parse(a.lastSeenAt);
    if (Number.isFinite(precedent) && maintenant - precedent < 60_000) return a;
    modifie = true;
    return { ...a, lastSeenAt: new Date(maintenant).toISOString() };
  });
  if (modifie) ecrireAppareils(fichier, { version: 1, devices });
}
