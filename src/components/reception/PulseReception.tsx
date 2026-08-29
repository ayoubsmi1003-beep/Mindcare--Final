/**
 * PulseReception — Meadows 4 pastel squares.
 * Square, icon top-right, large number, label, soft shadow, ink text.
 * Not dark gradients: operational calm, 4.5:1 text contrast.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Icone, type NomIcone } from "@/components/ui/Icones";

interface Props {
  readonly attente: number;
  readonly retards: number;
  readonly aEncaisser: number;
  readonly demandes: number;
  readonly onFocusAttente?: () => void;
  readonly onFocusEncaisser?: () => void;
  readonly onFocusDemandes?: () => void;
}

function Square({
  valeur,
  libelle,
  sousLibelle,
  icone,
  bg,
  accent,
  onClick,
}: {
  readonly valeur: number;
  readonly libelle: string;
  readonly sousLibelle: string;
  readonly icone: NomIcone;
  readonly bg: string;
  readonly accent: string;
  readonly onClick?: (() => void) | undefined;
}) {
  const inner = (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${accent} text-on-brand shadow-lift1`}>
          <Icone nom={icone} taille={16} />
        </span>
        <span className="font-num text-label tabular-nums text-ink-500">{valeur === 0 ? "—" : `${valeur}`}</span>
      </div>
      <span className="mt-2 font-ui text-body font-semibold text-ink-900">{libelle}</span>
      <span className="font-ui text-label text-ink-500">{sousLibelle}</span>
      <span className="mt-auto flex items-baseline gap-2">
        <span className="font-num text-title font-semibold tabular-nums text-ink-900">{valeur}</span>
        <span className={`inline-flex h-1.5 w-1.5 rounded-full ${valeur > 0 ? accent : "bg-ink-100"}`} aria-hidden="true" />
      </span>
    </div>
  );

  const cls = `group relative flex flex-col rounded-2xl border border-rule p-4 shadow-lift1 transition hover:shadow-lift2 hover:-translate-y-px ${bg} ${onClick ? "cursor-pointer focus-visible:outline focus-visible:outline-action-600" : ""}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function PulseReception({ attente, retards, aEncaisser, demandes, onFocusAttente, onFocusEncaisser, onFocusDemandes }: Props): React.JSX.Element {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-4 tablet:grid-cols-quatre">
      <Square
        valeur={attente}
        libelle="Salle d'attente"
        sousLibelle="Patients arrivés"
        icone="patients"
        bg="bg-info-50"
        accent="bg-info-600"
        onClick={onFocusAttente}
      />
      <Square valeur={retards} libelle="Retards" sousLibelle="Heure dépassée" icone="horloge" bg="bg-attention-bg" accent="bg-attention" />
      <Square
        valeur={aEncaisser}
        libelle="À encaisser"
        sousLibelle="Paiements dus"
        icone="finances"
        bg="bg-brand-50"
        accent="bg-brand-600"
        onClick={onFocusEncaisser}
      />
      <Square
        valeur={demandes}
        libelle="Demandes"
        sousLibelle="En attente"
        icone="agenda"
        bg="bg-ai-50"
        accent="bg-ai-600"
        onClick={onFocusDemandes}
      />
    </div>
  );
}
