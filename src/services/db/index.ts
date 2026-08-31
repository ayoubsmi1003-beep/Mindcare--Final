/**
 * Résolution du `DbPort` (ADR-020).
 *
 * Les services appellent `db()`, jamais un client. Trois usages, un seul point
 * de bascule :
 *   - aujourd'hui, Supabase Cloud (ADR-016) ;
 *   - demain, Postgres local sur le PC du cabinet (ADR-001) ;
 *   - dans un test ou un checkpoint, un port factice, sans réseau ni clé.
 *
 * `setDbPort` existe pour les deux derniers cas. Elle est volontairement
 * banale : si brancher un autre adaptateur demandait une réorganisation, la
 * promesse d'ADR-016 (« un changement de configuration, pas une
 * reconstruction ») ne serait pas tenable, et on s'en apercevrait le jour du
 * basculement — c'est-à-dire trop tard.
 */

import { httpDbPort } from "./http";
import type { DbPort } from "./port";

let current: DbPort | undefined;

/**
 * ═══ ADR-001 · LE PORT PAR DÉFAUT EST DÉSORMAIS HTTP ═══════════════════════
 *
 * `supabaseDbPort` n'est plus résolu ici. Ce qui a changé n'est pas seulement
 * la destination : c'est ce que le NAVIGATEUR détient. Avant, il portait la clé
 * `anon` et un JWT en `localStorage` ; maintenant il ne porte qu'un cookie
 * `httpOnly` qu'il ne peut pas lire, et la base n'est joignable que par
 * `/api/db/*`.
 *
 * ⚠️ `db()` NE BASCULE PAS VERS `pg` CÔTÉ SERVEUR, et ce n'est pas un oubli.
 * On aurait pu détecter `typeof window === "undefined"` et rendre l'adaptateur
 * `pg` — c'est même le réflexe. Ce serait un piège : un service importé par
 * mégarde dans un Route Handler court-circuiterait alors la frontière HTTP et
 * s'exécuterait avec le rôle que le pool porte à cet instant, SANS que
 * `withCaller` ait posé d'identité. Une seule règle de résolution, pas de
 * contexte ambiant : côté serveur, on construit `faireePgPort(q)`
 * EXPLICITEMENT, à partir d'un `Querier` qu'on a dû obtenir de `withCaller`.
 */
export function db(): DbPort {
  return current ?? httpDbPort;
}

export function setDbPort(port: DbPort | undefined): void {
  current = port;
}

export type {
  DbPort,
  SelectSpec,
  Filter,
  Order,
  RpcArgs,
  SessionInfo,
  SignInCredentials,
} from "./port";
