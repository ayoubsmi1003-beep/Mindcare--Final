/**
 * Résolution des chemins et de la source d'environnement — §F du plan.
 *
 * ⚠️ LA RÈGLE QUI JUSTIFIE CE FICHIER À LUI SEUL : le processus principal
 * PACKAGÉ ne doit JAMAIS pouvoir résoudre le `.env` du dépôt de développement.
 * C'est la seule chose qui empêche une installation cabinet de se retrouver,
 * par accident, pointée sur la base d'un développeur. La fonction
 * `fichierEnvironnement` ci-dessous encode cette séparation : elle ne lit
 * JAMAIS `process.cwd()` ni un chemin relatif au dépôt en mode production.
 *
 * Ces fonctions sont pures (pas d'accès disque, sauf `app.getPath`, déjà
 * fourni par Electron) pour rester testables sans environnement Electron réel.
 */
import path from "node:path";

export type ModeElectron = "development" | "production";

export function modeCourant(): ModeElectron {
  return process.env["MINDCARE_ELECTRON_ENV"] === "production" ? "production" : "development";
}

/**
 * Le fichier d'environnement à charger.
 *
 * · développement : le `.env` du dépôt, exactement ce que `pnpm dev` charge
 *   déjà (voir `scripts/verifier-base.mjs`) — comportement inchangé ;
 * · production : `%ProgramData%\MindCare\mindcare.env`, écrit par le
 *   provisionnement PostgreSQL (§C, §D du plan). Jamais un autre chemin.
 *
 * `programDataDir` est injecté (plutôt que lu via `process.env["ProgramData"]`
 * ici) pour que ce module reste testable sur une machine qui n'est pas
 * Windows, et pour que l'appelant (qui connaît déjà `app.getPath`) reste la
 * seule source de vérité sur l'emplacement réel.
 */
export function fichierEnvironnement(mode: ModeElectron, racineDepot: string, programDataDir: string): string {
  if (mode === "production") {
    return path.join(programDataDir, "MindCare", "mindcare.env");
  }
  return path.join(racineDepot, ".env");
}

/**
 * `%ProgramData%\MindCare\<sous-dossier>` — jamais sous le dossier
 * d'installation de l'application (§7 de la mission : le binaire et les
 * données persistantes du cabinet sont deux choses séparées, qui ne
 * disparaissent pas ensemble à la désinstallation).
 */
export function dossierDonnees(programDataDir: string, sousDossier: string): string {
  return path.join(programDataDir, "MindCare", sousDossier);
}
