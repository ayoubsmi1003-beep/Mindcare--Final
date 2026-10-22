/**
 * La gestion des postes du cabinet — façade de service.
 *
 * Les appels réseau vivent dans `src/services/db/http.ts`, seul fichier autorisé
 * à `fetch` (`eslint.config.js`). Ce module ne fait que rendre les types et les
 * fonctions lisibles depuis un écran, sans dupliquer la frontière.
 */

export type { PosteAppaire, InvitationCabinet } from "./db/http";
export {
  demanderInvitationAppairage,
  lirePostesAppaires,
  revoquerPosteAppaire,
} from "./db/http";
