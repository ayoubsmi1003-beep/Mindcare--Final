/**
 * Le fichier de confiance d'un poste d'accueil — stockage scellé.
 *
 * ═══ POURQUOI CE MODULE EXISTE ══════════════════════════════════════════════
 *
 * `clinic-trust.json` contient le jeton de poste, un secret de 32 octets qui
 * autorise la MACHINE auprès du proxy du cabinet. Il était écrit en clair dans
 * le profil Windows. Le dossier est déjà lisible par ce seul compte, mais un
 * fichier copié, une sauvegarde de profil ou un autre processus du même compte
 * pouvait le lire. La documentation le disait « DPAPI reste à faire » : ce
 * module ferme cette limite.
 *
 * Le jeton est scellé par DPAPI de portée UTILISATEUR (`safeStorage` d'Electron
 * sur Windows). Un fichier copié vers un autre compte Windows ne se déchiffre
 * pas ; un fichier copié vers une autre machine non plus. Le certificat et
 * l'origine restent dans le même objet scellé : ce ne sont pas des secrets,
 * mais les séparer compliquerait la lecture sans rien protéger de plus.
 *
 * ═══ CE QUE CE MODULE NE FAIT PAS ═══════════════════════════════════════════
 *
 * Il ne décide d'aucune confiance. Il lit et écrit un objet déjà validé par
 * l'appelant (`bureau-cabinet.ts` vérifie le certificat épinglé et l'origine).
 * Il ne remplace pas la session utilisateur : le jeton de poste autorise la
 * machine, jamais une personne.
 *
 * Le format v1 (JSON en clair) reste LU pour migrer une installation existante.
 * Il n'est plus jamais ÉCRIT : si le chiffrement n'est pas disponible, l'écriture
 * échoue au lieu de retomber silencieusement sur du clair.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

import { validerOrigineCabinet } from "./connexion-cabinet.js";
import type { ConfianceCabinet } from "./decouverte-cabinet.js";

export class ConfianceIllisible extends Error {
  constructor() {
    super("CONFIANCE_ILLISIBLE");
    this.name = "ConfianceIllisible";
  }
}

export class ChiffrementIndisponible extends Error {
  constructor() {
    super("CHIFFREMENT_INDISPONIBLE");
    this.name = "ChiffrementIndisponible";
  }
}

/** Le strict nécessaire : ce que `safeStorage` d'Electron expose sur Windows. */
export interface Scelleur {
  readonly disponible: () => boolean;
  readonly sceller: (texte: string) => Buffer;
  readonly desceller: (donnees: Buffer) => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JETON = /^[A-Za-z0-9_-]{43}$/;
const TAILLE_MAX = 32 * 1024;

export interface ConfianceLue {
  readonly value: ConfianceCabinet;
  /** Le fichier était au format v1 : l'appelant doit le réécrire scellé. */
  readonly migrer: boolean;
}

function valider(valeur: unknown): ConfianceCabinet {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) throw new ConfianceIllisible();
  const objet = valeur as Record<string, unknown>;
  const id = objet["id"];
  const origin = objet["origin"];
  const certificate = objet["certificate"];
  if (typeof id !== "string" || !UUID.test(id)) throw new ConfianceIllisible();
  if (typeof origin !== "string") throw new ConfianceIllisible();
  if (typeof certificate !== "string" || certificate.length === 0 || certificate.length > 8192) throw new ConfianceIllisible();

  const deviceId = objet["deviceId"];
  const deviceToken = objet["deviceToken"];
  if (deviceId === undefined && deviceToken === undefined) {
    return { id, origin: validerOrigineCabinet(origin), certificate };
  }
  // Les deux champs vont ensemble. Un demi-jeton est ignoré — le poste se
  // réappairera — plutôt que d'être conservé comme s'il était valide.
  if (typeof deviceId !== "string" || !UUID.test(deviceId)) {
    return { id, origin: validerOrigineCabinet(origin), certificate };
  }
  if (typeof deviceToken !== "string" || !JETON.test(deviceToken)) {
    return { id, origin: validerOrigineCabinet(origin), certificate };
  }
  return { id, origin: validerOrigineCabinet(origin), certificate, deviceId, deviceToken };
}

function lireTexte(fichier: string): string | undefined {
  try {
    if (!existsSync(fichier)) return undefined;
    const texte = readFileSync(fichier, "utf8");
    if (Buffer.byteLength(texte, "utf8") > TAILLE_MAX) return undefined;
    return texte;
  } catch {
    return undefined;
  }
}

/**
 * Lit la confiance. Rend `undefined` si le fichier est absent ou illisible —
 * l'appelant traite ce cas comme « pas encore appairé ». Un fichier scellé qui
 * ne se déchiffre pas lève `ConfianceIllisible` : c'est un cas différent, et le
 * poste doit redemander une invitation sans effacer aucune donnée patient.
 */
export function lireConfianceStockee(fichier: string, scelleur: Scelleur): ConfianceLue | undefined {
  const texte = lireTexte(fichier);
  if (texte === undefined) return undefined;

  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    throw new ConfianceIllisible();
  }
  if (typeof brut !== "object" || brut === null || Array.isArray(brut)) throw new ConfianceIllisible();
  const objet = brut as Record<string, unknown>;

  if (objet["version"] === 2) {
    const scelle = objet["sealed"];
    if (typeof scelle !== "string" || scelle.length === 0) throw new ConfianceIllisible();
    let clair: string;
    try {
      clair = scelleur.desceller(Buffer.from(scelle, "base64"));
    } catch {
      throw new ConfianceIllisible();
    }
    let valeur: unknown;
    try {
      valeur = JSON.parse(clair);
    } catch {
      throw new ConfianceIllisible();
    }
    return { value: valider(valeur), migrer: false };
  }

  // Format v1 : un JSON en clair. Il n'est accepté qu'en lecture, le temps de
  // le réécrire scellé. Aucun autre numéro de version n'est interprété.
  if (objet["version"] !== undefined) throw new ConfianceIllisible();
  return { value: valider(objet), migrer: true };
}

/** Écrit la confiance scellée, atomiquement. Ne retombe jamais sur du clair. */
export function ecrireConfianceStockee(fichier: string, value: ConfianceCabinet, scelleur: Scelleur): void {
  if (!scelleur.disponible()) throw new ChiffrementIndisponible();
  const enveloppe = JSON.stringify({
    version: 2,
    sealed: scelleur.sceller(JSON.stringify(value)).toString("base64"),
  });
  mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaire, enveloppe, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(temporaire, fichier);
  } catch (error) {
    rmSync(temporaire, { force: true });
    throw error;
  }
}
