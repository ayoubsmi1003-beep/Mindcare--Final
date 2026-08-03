/**
 * Dossiers patients — ADR-019.
 *
 * ⚠️ AUCUN `select` SUR LA TABLE `patients` DANS CE FICHIER, ET NULLE PART
 * AILLEURS. La migration 017 a révoqué `SELECT ON app.patients` à
 * `authenticated` et à `service_role`. Un accès direct ne rendrait pas une
 * liste vide — il rendrait `42501 permission denied`. Ce n'est pas une
 * restriction qu'on s'impose par discipline : c'est la base qui refuse.
 *
 * Les deux fonctions ci-dessous appellent les deux seules portes ouvertes, qui
 * journalisent la lecture dans `audit.log` avant de retourner, dans la même
 * transaction (I4). Il n'existe pas de chemin qui lise un dossier sans laisser
 * de trace, et c'est la raison d'être de tout le dispositif.
 *
 * Conséquence à connaître avant d'écrire un écran : les filtres et la
 * pagination de PostgREST ne s'appliquent plus ici. Ce sont des PARAMÈTRES, et
 * `p_limit` est borné à 100 EN BASE — une pagination que l'appelant choisit
 * sans limite est un export.
 */

import { db } from "./db";
import { log } from "./log";
import { err, ok, type Page, type Result } from "./result";

/** Ligne de liste. Volontairement pauvre : une liste n'a pas besoin du dossier. */
export interface PatientListItem {
  readonly id: string;
  readonly recordNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string | null;
  readonly phone: string;
  readonly isActive: boolean;
}

export interface Patient extends PatientListItem {
  readonly cabinetId: string;
  readonly practitionerId: string;
  readonly address: string | null;
  readonly phoneAlt: string | null;
  readonly notesAdmin: string | null;
}

export interface PatientSearchFilters {
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}

interface SearchRow {
  readonly id: string;
  readonly record_number: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly birth_date: string | null;
  readonly phone: string;
  readonly is_active: boolean;
  readonly total_count: number;
}

interface PatientRow extends SearchRow {
  readonly cabinet_id: string;
  readonly practitioner_id: string;
  readonly address: string | null;
  readonly phone_alt: string | null;
  readonly notes_admin: string | null;
}

function toListItem(row: SearchRow): PatientListItem {
  return {
    id: row.id,
    recordNumber: row.record_number,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    phone: row.phone,
    isActive: row.is_active,
  };
}

export async function searchPatients(
  filters: PatientSearchFilters = {},
): Promise<Result<Page<PatientListItem>>> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  const result = await db().rpc<SearchRow>("search_patients", {
    p_query: filters.query ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (!result.ok) {
    log.error("patients.recherche", { code: result.error.code });
    return err(result.error);
  }

  const rows = result.data.map(toListItem);
  // `total_count` est identique sur toutes les lignes (CROSS JOIN en base).
  // Zéro ligne signifie zéro résultat VISIBLE — pas zéro patient : la RLS a pu
  // filtrer l'intégralité du résultat, et c'est un fonctionnement normal.
  const total = result.data[0]?.total_count ?? 0;

  log.info("patients.recherche", { count: rows.length });
  return ok({ rows, total, offset, limit });
}

export async function getPatient(id: string): Promise<Result<Patient | null>> {
  const result = await db().rpc<PatientRow>("get_patient", { p_id: id });

  if (!result.ok) {
    // Pas de `patientId` ici : règle 1 et I5. L'événement et le code suffisent
    // à diagnostiquer ; la trace nominative légale est dans `audit.log`, écrite
    // par `app.get_patient` avant même que cette erreur ne survienne.
    log.error("patients.fiche", { code: result.error.code });
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // Dossier inexistant OU hors du périmètre de l'appelant : la base ne
    // distingue pas les deux, et l'interface ne doit pas non plus. Répondre
    // « ce dossier existe mais ne vous est pas accessible » divulguerait
    // l'existence d'un patient d'une autre praticienne (cloison ADR-003).
    return ok(null);
  }

  return ok({
    ...toListItem(row),
    cabinetId: row.cabinet_id,
    practitionerId: row.practitioner_id,
    address: row.address,
    phoneAlt: row.phone_alt,
    notesAdmin: row.notes_admin,
  });
}
