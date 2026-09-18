/**
 * Contexte patient actif — un pub/sub MINIMAL entre l'écran dossier et le
 * panneau Jarvis.
 *
 * ⚠️ LE CONTEXTE N'EST JAMAIS UNE AUTORISATION. Il pré-résout la CIBLE des
 * outils pour éviter à la praticienne de re-nommer son patient ; ce que
 * Jarvis peut voir reste entièrement décidé par la RLS sous le JWT de
 * l'appelante (L3). Effacé au démontage de l'écran : naviguer de A vers B
 * ne peut jamais laisser A « actif » en silence.
 *
 * Zéro persistance : pas de sessionStorage, pas de localStorage. Un contexte
 * qui survit à la page est un contexte oublié — c'est-à-dire le risque
 * exact que cette frontière existe pour fermer.
 */

import { fr } from "@/i18n/fr";

export interface PatientActif {
  readonly id: string;
  readonly nom: string;
  readonly numero: string;
  /**
   * Époque (ms) de pose — Phase 3. L'écran y lit l'ÂGE du contexte affiché
   * (« il y a N min ») ; la VALIDITÉ (TTL) vit dans `jarvis-contexte`.
   */
  readonly etablieA: number;
}

type Abonne = (p: PatientActif | null) => void;

let courant: PatientActif | null = null;
const abonnes = new Set<Abonne>();

function notifier(): void {
  for (const a of abonnes) a(courant);
}

export function definirPatientActif(
  patient: Omit<PatientActif, "etablieA">,
  maintenantMs: number = Date.now(),
): void {
  courant = { ...patient, etablieA: maintenantMs };
  notifier();
}

export function effacerPatientActif(): void {
  if (courant === null) return;
  courant = null;
  notifier();
}

export function patientActifCourant(): PatientActif | null {
  return courant;
}

/** Retourne la fonction de désabonnement (à appeler dans le cleanup React). */
export function abonnerPatientActif(abonne: Abonne): () => void {
  abonnes.add(abonne);
  abonne(courant);
  return () => {
    abonnes.delete(abonne);
  };
}

/** Libellé du chip — passe par i18n comme tout libellé affiché. */
export function libelleContexteActif(): string {
  return fr.jarvis.contexte.patientActif;
}
