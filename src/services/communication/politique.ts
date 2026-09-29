/**
 * Politique locale d'envoi — MIROIR du graphe SQL (112), jamais l'autorité.
 *
 * L'autorité reste `app.comm_transition_message` : ce module évite un
 * aller-retour voué à l'échec, il n'autorise rien. Toute divergence entre ce
 * miroir et la migration est un bug — le test `communication-politique`
 * fige les transitions critiques.
 */

import type { DecisionEnvoi, EntreeDecision, EtatMessage } from "./types";

/** Graphe autorisé, copié de `comm_transition_message` (112). */
const TRANSITIONS: Readonly<Record<EtatMessage, ReadonlySet<string>>> = {
  received: new Set(["classified", "blocked", "failed", "expired"]),
  classified: new Set(["awaiting_action", "draft", "blocked", "failed", "expired"]),
  awaiting_action: new Set(["draft", "blocked", "failed", "expired"]),
  draft: new Set(["approval_required", "approved", "queued", "blocked", "failed", "expired"]),
  approval_required: new Set(["approved", "rejected", "failed", "expired"]),
  approved: new Set(["queued", "sending", "blocked", "failed", "expired"]),
  queued: new Set(["sending", "expired", "failed"]),
  sending: new Set(["sent", "failed"]),
  sent: new Set(["delivered", "failed"]),
  delivered: new Set(["read", "failed"]),
  read: new Set(),
  failed: new Set(),
  blocked: new Set(),
  expired: new Set(),
  rejected: new Set(),
};

export function transitionLocale(de: EtatMessage, vers: string): boolean {
  const cibles = TRANSITIONS[de];
  if (cibles === undefined) return false;
  return cibles.has(vers);
}

/**
 * Décide d'un envoi sortant, dans l'ordre des refus (fail-closed) :
 * 1. pas de consentement → bloquer ; 2. signal patient dans la charge →
 *    bloquer (la pseudonymisation/egress tranche ensuite, ceinture + bretelles) ;
 * 3. réseau indisponible → file (état `queued`, JAMAIS un faux `sent`) ;
 * 4. sinon autoriser (la porte SQL et l'egress gardent le dernier mot).
 */
export function deciderEnvoi(entree: EntreeDecision): DecisionEnvoi {
  if (!entree.consentement) return { decision: "bloquer", motif: "consentement" };
  if (entree.signalPatient) return { decision: "bloquer", motif: "signal_patient" };
  if (entree.horsLigne || !entree.connecte) return { decision: "file", etatCible: "queued" };
  return { decision: "autoriser" };
}
