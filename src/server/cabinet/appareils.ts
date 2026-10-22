/**
 * Le registre des postes appairés — côté BACKEND (routes `/api/cabinet/*`).
 *
 * ═══ POURQUOI UNE SECONDE LECTURE DU MÊME FICHIER ═══════════════════════════
 *
 * `src/` ne peut pas importer `electron/` (deux cibles de compilation, deux
 * runtimes). Le registre est donc lu ici avec le MÊME format que
 * `electron/main/paired-devices.ts`, et un test unitaire fait lire le même
 * contenu aux deux implémentations : une divergence de format doit échouer en
 * intégration, jamais se découvrir en cabinet.
 *
 * ═══ CE QUE CE MODULE NE FAIT PAS ═══════════════════════════════════════════
 *
 * Il ne VÉRIFIE aucun jeton de poste : cette décision appartient au proxy TLS
 * (`electron/main/proxy-cabinet.ts`), qui s'exécute avant toute session. Ici on
 * ne fait qu'afficher et révoquer — deux gestes d'administration, réservés au
 * médecin par la porte `app.autoriser_gestion_postes()`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AppareilPoste {
  readonly deviceId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

interface AppareilStocke extends AppareilPoste {
  readonly tokenSha256: string;
}

interface FichierAppareils {
  readonly version: 1;
  readonly devices: readonly AppareilStocke[];
}

const TAILLE_MAX = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `%ProgramData%\MindCare\private` — le dossier protégé de l'hôte. */
export function dossierPrive(): string {
  const base = process.env["ProgramData"] ?? (process.platform === "win32" ? "C:\\ProgramData" : "/tmp");
  return path.join(base, "MindCare", "private");
}

export function fichierAppareils(): string {
  return path.join(dossierPrive(), "paired-devices.json");
}

export function fichierInvitation(): string {
  return path.join(dossierPrive(), "clinic-invitation.json");
}

/**
 * Vrai quand ce processus tourne sur un hôte de cabinet configuré. En
 * développement web, le dossier n'existe pas : les routes répondent alors un
 * refus explicite au lieu d'écrire dans un chemin inventé.
 */
export function hoteConfigure(): boolean {
  return existsSync(path.join(dossierPrive(), "clinic-server.json"));
}

function lire(): FichierAppareils {
  try {
    const fichier = fichierAppareils();
    if (!existsSync(fichier) || statSync(fichier).size > TAILLE_MAX) {
      return { version: 1, devices: [] };
    }
    const brut: unknown = JSON.parse(readFileSync(fichier, "utf8"));
    if (typeof brut !== "object" || brut === null) return { version: 1, devices: [] };
    const objet = brut as Record<string, unknown>;
    if (objet["version"] !== 1 || !Array.isArray(objet["devices"])) return { version: 1, devices: [] };

    const devices: AppareilStocke[] = [];
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
    return { version: 1, devices: [] };
  }
}

function ecrire(contenu: FichierAppareils): void {
  const fichier = fichierAppareils();
  mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${process.pid}.tmp`;
  writeFileSync(temporaire, JSON.stringify(contenu), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaire, fichier);
}

export function hacherJeton(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

export function listerPostes(): readonly AppareilPoste[] {
  return lire().devices.map((a) => ({
    deviceId: a.deviceId,
    label: a.label,
    createdAt: a.createdAt,
    lastSeenAt: a.lastSeenAt,
    revokedAt: a.revokedAt,
  }));
}

export function revoquerPoste(deviceId: string): boolean {
  if (!UUID.test(deviceId)) return false;
  const registre = lire();
  let touche = false;
  const devices = registre.devices.map((a) => {
    if (a.deviceId !== deviceId) return a;
    touche = true;
    return { ...a, revokedAt: a.revokedAt ?? new Date().toISOString() };
  });
  if (touche) ecrire({ version: 1, devices });
  return touche;
}

/**
 * Le poste courant, identifié par le jeton que le client Electron a joint à la
 * requête. Sert à l'interface (« ce poste-ci »), jamais à autoriser.
 */
export function posteCourant(jeton: string | undefined): string | null {
  if (typeof jeton !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(jeton)) return null;
  const empreinte = hacherJeton(jeton);
  const trouve = lire().devices.find((a) => a.revokedAt === null && a.tokenSha256 === empreinte);
  return trouve?.deviceId ?? null;
}
