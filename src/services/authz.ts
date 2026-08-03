/**
 * Rôle de l'utilisateur courant — POUR L'AFFICHAGE, ET RIEN D'AUTRE.
 *
 * ⚠️ CE FICHIER NE PROTÈGE RIEN. Lisez cette phrase avant d'utiliser ce qu'il
 * exporte.
 *
 * Il sert à choisir QUELLE COMPOSITION afficher : le tableau de bord assistante
 * est un écran séparé, pas le tableau de bord praticienne avec des champs
 * masqués (I12). Un champ masqué en CSS ou en JavaScript est présent dans la
 * réponse réseau, donc lisible en trois clics dans les outils de développement.
 *
 * Ce qui décide de l'accès aux données, c'est la RLS Postgres — toujours, sans
 * exception. Écrire `if (role === "assistant")` pour CACHER une donnée clinique
 * est un bug de conception : la bonne correction est une policy, jamais une
 * condition ici (règle 4 de CLAUDE.md, R4).
 *
 * Test simple avant d'appeler `getCurrentRole()` : « si cette condition
 * disparaissait, une donnée fuiterait-elle ? » Si oui, la protection est au
 * mauvais endroit.
 */

import { db } from "./db";
import { err, ok, type Result } from "./result";

export type UserRole = "owner" | "practitioner" | "assistant";

interface ProfileRow {
  readonly id: string;
  readonly role: string;
  readonly full_name: string;
  readonly cabinet_id: string;
}

export interface CurrentUser {
  readonly id: string;
  readonly role: UserRole;
  readonly fullName: string;
  readonly cabinetId: string;
}

function toRole(value: string): UserRole | null {
  return value === "owner" || value === "practitioner" || value === "assistant" ? value : null;
}

/**
 * `app.profiles` porte sa propre policy : chacun lit l'annuaire de SON CABINET
 * — donc plusieurs lignes, pas seulement la sienne.
 *
 * ⚠️ C'EST POURQUOI LE FILTRE SUR `id` EST INDISPENSABLE, ET CE N'EST PAS UNE
 * DÉCISION D'AUTORISATION. Une version antérieure faisait `limit: 1` sans
 * filtre ni tri, en s'appuyant sur « la base a déjà filtré ». Elle avait
 * filtré : elle avait rendu tout le cabinet. Sans `ORDER BY`, PostgreSQL ne
 * garantit aucun ordre, et `data[0]` était donc une ligne ARBITRAIRE de
 * l'annuaire. L'assistante pouvait recevoir la ligne de la Dr Larbi : la
 * coquille composait alors la navigation praticienne et affichait le nom d'une
 * collègue comme « compte connecté ». Aucune donnée patient ne fuyait — la RLS
 * tient — mais l'écran affirmait une identité qu'il n'avait pas vérifiée.
 *
 * Le filtre ne protège donc rien et ne prétend rien protéger : il DÉSIGNE la
 * ligne voulue parmi celles que la base a légitimement rendues. La distinction
 * est celle de tout ce fichier : choisir quoi afficher n'est pas décider qui a
 * le droit de voir.
 */
export async function getCurrentUser(): Promise<Result<CurrentUser | null>> {
  const session = await db().getSession();
  if (!session.ok) return err(session.error);
  if (session.data === null) return ok(null);

  const result = await db().select<ProfileRow>({
    relation: "profiles",
    columns: ["id", "role", "full_name", "cabinet_id"],
    filters: [{ column: "id", op: "eq", value: session.data.userId }],
    limit: 1,
  });

  if (!result.ok) return err(result.error);

  const row = result.data[0];
  if (row === undefined) return ok(null);

  const role = toRole(row.role);
  if (role === null) return ok(null);

  return ok({
    id: row.id,
    role,
    fullName: row.full_name,
    cabinetId: row.cabinet_id,
  });
}
