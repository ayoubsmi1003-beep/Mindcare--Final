/**
 * Annuaire du cabinet — les praticiennes, pour le sélecteur de l'agenda.
 *
 * CE FICHIER NE SERT QU'À CHOISIR. Les noms AFFICHÉS dans l'agenda viennent de
 * `app.list_agenda`, qui les rend en même temps que les rendez-vous. Recomposer
 * l'affichage à partir d'ici demanderait une jointure côté client, c'est-à-dire
 * une seconde source pour la même information.
 *
 * PAS DE PORTE, ET C'EST NORMAL. `app.profiles` n'est pas un dossier patient :
 * la policy `profiles_read` de la migration 003 rend l'annuaire du cabinet à
 * tout membre authentifié, et rien n'y est révoqué. ADR-019 ne couvre que
 * `app.patients` — étendre son dispositif ici journaliserait la lecture d'un
 * nom de collègue au même titre qu'une consultation de dossier médical, ce qui
 * diluerait exactement la distinction que le journal doit préserver.
 *
 * ⚠️ PIÈGE MESURÉ EN S3, À NE PAS REJOUER : `limit 1` sans `ORDER BY` élit une
 * ligne au hasard sur cette table. `getCurrentUser()` pouvait afficher le nom
 * d'une collègue comme compte connecté. Le tri ci-dessous est explicite, et
 * aucune fonction de ce fichier ne rend « la première ligne ».
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export type PractitionerRole = "owner" | "practitioner";

export interface Practitioner {
  readonly id: string;
  readonly fullName: string;
  readonly role: PractitionerRole;
}

interface ProfileRow {
  readonly id: string;
  readonly full_name: string;
  readonly role: string;
}

/**
 * Les praticiennes du cabinet, triées par nom.
 *
 * L'assistante n'est pas dans la liste : un rendez-vous se prend AVEC une
 * praticienne. Ce n'est pas une décision d'autorisation déguisée — l'assistante
 * lit parfaitement cette ligne, elle n'est simplement pas un choix valide pour
 * ce champ, et la contrainte réelle est portée par la RLS de `app.appointments`
 * (`can_see_clinical` rend faux pour elle, toujours).
 */
export async function listPractitioners(): Promise<Result<readonly Practitioner[]>> {
  const result = await db().select<ProfileRow>({
    relation: "profiles",
    columns: ["id", "full_name", "role"],
    order: [{ column: "full_name", ascending: true }],
  });

  if (!result.ok) {
    log.error("praticiennes.liste", logFieldsFor(result.error));
    return err(result.error);
  }

  const rows = result.data
    .filter((row): row is ProfileRow & { role: PractitionerRole } =>
      row.role === "owner" || row.role === "practitioner",
    )
    .map((row) => ({ id: row.id, fullName: row.full_name, role: row.role }));

  log.info("praticiennes.liste", { count: rows.length });
  return ok(rows);
}
