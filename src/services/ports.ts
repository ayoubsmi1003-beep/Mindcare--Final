/**
 * Points d'extension — SIGNATURES SEULES, AUCUNE IMPLÉMENTATION.
 *
 * ⚠️ RIEN DE CE FICHIER N'EST BRANCHÉ. Aucune des fonctionnalités décrites ici
 * n'existe, et ce n'est pas un oubli : Jarvis, la voix, les agents, les tâches
 * de fond, les notifications sortantes et l'inférence locale sont hors du
 * périmètre de la Phase 1. Ce fichier n'est là que pour que leur arrivée ne
 * demande pas de retourner la couche services.
 *
 * DEUX RÈGLES QUI S'APPLIQUENT À TOUTE IMPLÉMENTATION FUTURE, écrites ici parce
 * que c'est ici qu'on les lira :
 *
 *   1. **Une seule sortie réseau** (I13). Toute implémentation de
 *      `ExternalCallPort` passe par `supabase/functions/_shared/external-call.ts`
 *      et par nulle part ailleurs. Un appel réseau direct vers une URL externe,
 *      écrit ailleurs, est une rupture d'architecture — le contrôle 1 du
 *      préflight le refuse.
 *
 *   2. **Jarvis propose, l'humain décide** (I6, I16). Toute écriture déclenchée
 *      par la voix ou l'IA passe par une carte de confirmation et attend un
 *      clic. `jarvis_actions.state = 'executed'` sans `confirmed_at` est une
 *      violation de contrainte EN BASE, par conception — ne pas chercher à la
 *      contourner côté client, elle est là pour ça.
 *
 * Et une interdiction : `send_message_to_patient` n'est pas dans ce fichier et
 * n'y entrera pas. Aucun message automatisé à un patient psychiatrique.
 */

import type { Result } from "./result";

/** La passerelle unique vers l'extérieur (I13). Aucune implémentation en Phase 1. */
export interface ExternalCallPort {
  readonly call: <T>(
    service: "stt" | "llm",
    payload: Readonly<Record<string, unknown>>,
  ) => Promise<Result<T>>;
}

/**
 * Notifications INTERNES (table `app.notifications`), à destination du cabinet.
 * Rien à voir avec l'envoi d'un message à un patient, qui reste interdit.
 */
export interface NotificationPort {
  readonly notify: (kind: string, payload: Readonly<Record<string, string>>) => Promise<Result<void>>;
}

/** Tâches de fond : purges, sauvegardes, surveillance disque (migration 014). */
export interface JobPort {
  readonly schedule: (job: string, runAt: string) => Promise<Result<void>>;
}

/**
 * Inférence locale (Mois 2, à l'arrivée du GPU). Le même contrat que
 * l'inférence distante : c'est ce qui rend le basculement configurable plutôt
 * que réécrit, exactement comme `DbPort` pour la base (ADR-020).
 */
export interface InferencePort {
  readonly transcribe: (audio: ArrayBuffer, language: "ar" | "fr") => Promise<Result<string>>;
  readonly complete: (prompt: string) => Promise<Result<string>>;
}
