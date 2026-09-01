/**
 * Localisation des binaires PostgreSQL empaquetés — §C du plan.
 *
 * Purement des chemins : aucun accès disque ici, pour rester testable sans
 * machine Windows ni binaires réels. `provisionnement.ts` est celui qui
 * vérifie leur existence avant de les invoquer.
 */
import path from "node:path";

export interface BinairesPg {
  readonly initdb: string;
  readonly pgCtl: string;
  readonly psql: string;
  readonly postgres: string;
}

/**
 * `resourcesDir` est le dossier `resources/pgsql` empaqueté par
 * electron-builder (§I du plan) — en développement, un dossier local du même
 * nom, peuplé manuellement (voir `docs/SELF-HOST-SETUP.md`).
 */
export function localiserBinaires(resourcesDir: string): BinairesPg {
  const bin = path.join(resourcesDir, "bin");
  return {
    initdb: path.join(bin, "initdb.exe"),
    pgCtl: path.join(bin, "pg_ctl.exe"),
    psql: path.join(bin, "psql.exe"),
    postgres: path.join(bin, "postgres.exe"),
  };
}
