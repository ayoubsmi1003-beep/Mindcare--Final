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

import type { DbPort } from "./port";
import { supabaseDbPort } from "./supabase";

let current: DbPort | undefined;

export function db(): DbPort {
  return current ?? supabaseDbPort;
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
