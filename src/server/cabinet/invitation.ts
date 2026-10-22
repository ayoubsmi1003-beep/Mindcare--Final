/**
 * Création d'une invitation d'appairage — côté BACKEND (hôte).
 *
 * ═══ POURQUOI CETTE ROUTE EXISTE ════════════════════════════════════════════
 *
 * L'ancien parcours générait l'invitation dans le processus principal Electron,
 * qui devait écrire dans `%ProgramData%\MindCare\private` — un dossier réservé à
 * SYSTEM et aux administrateurs. Il lui fallait donc une élévation UAC à CHAQUE
 * invitation : une fenêtre administrateur pour afficher huit caractères.
 *
 * Le backend Next.js tourne déjà sous le compte SYSTEM de la tâche
 * `MindCare-Clinic-Server`. Il peut écrire ce fichier sans élévation. La route
 * ci-dessous est donc le seul chemin de création, et elle est réservée au
 * médecin par `app.autoriser_gestion_postes()`, et à la machine hôte par
 * `proxy-cabinet.ts`.
 *
 * ═══ CE QUE L'INVITATION NE DONNE PAS ═══════════════════════════════════════
 *
 * Aucun accès clinique. Elle sert à prouver au poste d'accueil qu'il parle au
 * bon cabinet et à lui remettre un jeton de poste. Les comptes et les sessions
 * restent obligatoires, et la RLS ne bouge pas.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { dossierPrive, fichierInvitation } from "./appareils";

/** 144 bits, comme le secret d'appairage historique (`configurer-cabinet.ps1`). */
const DUREE_MS = 5 * 60_000;

export interface InvitationCreee {
  /** 24 caractères base64url — affichés par groupes de quatre à l'écran. */
  readonly code: string;
  readonly expiresAt: string;
}

export class CabinetNonConfigure extends Error {
  constructor() {
    super("CABINET_NON_CONFIGURE");
    this.name = "CabinetNonConfigure";
  }
}

/**
 * Écrit une invitation neuve. Une invitation précédente non consommée est
 * remplacée : le médecin qui reclique obtient un code neuf, et l'ancien meurt.
 * C'est le comportement attendu d'un bouton « régénérer ».
 */
export function creerInvitation(maintenant = Date.now()): InvitationCreee {
  const dossier = dossierPrive();
  if (!existsSync(path.join(dossier, "clinic-server.json"))) {
    throw new CabinetNonConfigure();
  }

  const secret = randomBytes(18).toString("base64url");
  const expiresAt = maintenant + DUREE_MS;
  const fichier = fichierInvitation();

  mkdirSync(dossier, { recursive: true });
  // `consumedAt: null` et `attempts: 0` sont explicites : une invitation
  // régénérée ne doit jamais hériter du compteur d'échecs de la précédente.
  const contenu = JSON.stringify({ secret, expiresAt, attempts: 0, consumedAt: null });
  const temporaire = `${fichier}.${process.pid}.tmp`;
  writeFileSync(temporaire, contenu, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaire, fichier);

  return { code: secret, expiresAt: new Date(expiresAt).toISOString() };
}
