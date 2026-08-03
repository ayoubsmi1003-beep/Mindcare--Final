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
 * `app.profiles` porte sa propre policy : chacun ne lit que l'annuaire de son
 * cabinet. On ne filtre donc pas sur l'identité ici — la base l'a déjà fait, et
 * refaire son travail en JavaScript donnerait l'illusion que c'est ce filtre
 * qui protège.
 */
export async function getCurrentUser(): Promise<Result<CurrentUser | null>> {
  const result = await db().select<ProfileRow>({
    relation: "profiles",
    columns: ["id", "role", "full_name", "cabinet_id"],
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
