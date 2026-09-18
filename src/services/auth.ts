/**
 * Ouverture et fermeture de session — RIEN D'AUTRE.
 *
 * ⚠️ CE FICHIER N'AUTORISE RIEN, exactement comme `authz.ts` ne protège rien.
 * Il fait deux choses : ouvrir une session (`signIn`), la fermer (`signOut`),
 * et dire si une session existe (`getSession`). Ce qui décide de l'accès à
 * une donnée, c'est la RLS Postgres, appliquée sur chaque relation — jamais
 * une condition ici. On ne trouvera dans ce fichier aucun `if (role === …)` :
 * ce serait un bug de conception (règle 4 de CLAUDE.md), pas une optimisation.
 *
 * Passe par `db()`, jamais par un client direct — I3, ADR-020. Côté serveur,
  * le seul import `pg` (valeur) autorisé vit dans `src/server/db/pool.ts`.
 */

import { db } from "./db";
import type { SessionInfo } from "./db/port";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

/**
 * Ouvre une session. Journalise un succès ou un échec par CODE uniquement —
 * jamais l'e-mail saisi, qui est une donnée identifiante dans un journal
 * (I5, règle 1 de CLAUDE.md). `LogFields` est une interface fermée qui
 * empêche déjà d'y ajouter un champ `email` — la protection est au type, pas
 * à la discipline de qui écrit l'appel.
 */
export async function signIn(input: SignInInput): Promise<Result<SessionInfo>> {
  const result = await db().signIn({ email: input.email, password: input.password });
  if (!result.ok) {
    log.error("auth.signIn", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("auth.signIn", { code: "ok" });
  return ok(result.data);
}

/** Ferme la session courante. */
export async function signOut(): Promise<Result<void>> {
  const result = await db().signOut();
  if (!result.ok) {
    log.error("auth.signOut", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("auth.signOut", { code: "ok" });
  return ok(undefined);
}

/** Lit la session courante, `null` si aucune n'est ouverte. */
export async function getSession(): Promise<Result<SessionInfo | null>> {
  return db().getSession();
}
