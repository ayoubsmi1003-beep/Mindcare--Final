/**
 * L'état de la liaison avec le PC du médecin — un seul endroit, deux tons.
 *
 * ═══ POURQUOI CE N'EST PAS UN BANDEAU PERMANENT ═════════════════════════════
 *
 * Un bandeau qui crie en permanence quand tout va bien apprend à ne plus le
 * lire, et le jour où il dit quelque chose d'important il est déjà du décor.
 * L'état nominal est donc une pastille discrète ; seuls la reconnexion et le
 * mode hors ligne prennent la surface d'attention.
 *
 * ═══ CE QUE L'ÉTAT DIT EXACTEMENT ═══════════════════════════════════════════
 *
 *   connecte        le flux temps réel est ouvert ;
 *   synchronisation une relecture est en cours (le flux vient de se rouvrir) ;
 *   reconnexion     le flux est tombé, la reconnexion est en cours — les
 *                   lectures déjà chargées restent lisibles, aucune écriture
 *                   ne doit être présentée comme réussie ;
 *   hors_ligne      le poste n'a plus de réseau, ou l'hôte est muet.
 *
 * « Connecté » ne signifie PAS « tout est synchronisé » : c'est pourquoi les
 * écritures restent confirmées par leur propre réponse, jamais par cette
 * pastille.
 */

"use client";

import { Icone } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import type { EtatFlux } from "@/components/useEvenementsCabinet";

export interface EtatConnexionCabinetProps {
  readonly etat: EtatFlux;
  /** Horodatage de la dernière synchronisation réussie, si connu. */
  readonly derniereSynchro?: string | null;
  /** Compact pour la barre supérieure. */
  readonly compact?: boolean;
}

function heure(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}

export function EtatConnexionCabinet({
  etat,
  derniereSynchro = null,
  compact = false,
}: EtatConnexionCabinetProps): React.JSX.Element {
  const c = fr.collaboration.connexion;
  const degrade = etat === "reconnexion" || etat === "hors_ligne";

  const libelle =
    etat === "connecte"
      ? c.connecte
      : etat === "connexion"
        ? c.synchronisation
        : etat === "reconnexion"
          ? c.reconnexion
          : c.horsLigne;

  const marqueur = heure(derniereSynchro);

  return (
    <p
      role="status"
      aria-live="polite"
      title={degrade ? c.horsLigneDetail : libelle}
      className={[
        "m-0 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1",
        "font-ui text-label font-medium",
        degrade
          ? "border-attention bg-attention-bg text-attention-ink"
          : "border-rule bg-card text-ink-500",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "h-2 w-2 shrink-0 rounded-full",
          etat === "connecte" ? "bg-positive" : degrade ? "bg-attention" : "border border-ink-300 bg-transparent",
        ].join(" ")}
      />
      <span className="min-w-0 truncate">{libelle}</span>
      {!compact && marqueur !== null ? (
        <span className="shrink-0 font-num tabular-nums opacity-80">
          {c.derniereSynchro} {marqueur}
        </span>
      ) : null}
      {degrade ? <Icone nom="alerte" taille={16} className="shrink-0" /> : null}
    </p>
  );
}
