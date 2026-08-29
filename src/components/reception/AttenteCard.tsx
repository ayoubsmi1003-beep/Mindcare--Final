/**
 * Carte file d'attente — numéro, identité, attente, progression.
 * Une carte = un patient qui attend. Escalade douce >10/20min.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Bouton } from "@/components/ui/Bouton";
import type { RdvAccueil } from "@/services/reception";

interface Props {
  readonly index: number;
  readonly rdv: RdvAccueil;
  readonly minutes: number;
  readonly onAbsent: (rdv: RdvAccueil) => void;
  readonly onSelect: (id: string) => void;
}

export function AttenteCard({ index, rdv, minutes, onAbsent, onSelect }: Props): React.JSX.Element {
  const niveau = minutes > 20 ? "long" : minutes > 10 ? "amber" : "normal";
  const border = niveau === "long" ? "border-attention bg-attention-bg" : niveau === "amber" ? "border-attention bg-attention-bg" : "border-rule bg-card";
  const progression = Math.min(100, Math.round((minutes / 30) * 100));
  const nom = [rdv.lastName, rdv.firstName].filter(Boolean).join(" ") || fr.agenda.patientNonRattache;

  return (
    <div className={["relative flex flex-col gap-1 overflow-hidden rounded-md border px-3 py-2", border].join(" ")}>
      <div className="flex min-h-target items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken font-num text-label font-semibold tabular-nums text-ink-700">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onSelect(rdv.id)}
          className="min-w-0 flex-1 truncate bg-transparent text-left font-ui text-body font-medium text-ink-900 outline-none focus-visible:outline focus-visible:outline-action-600"
        >
          {nom}
        </button>
        <span className="shrink-0 font-num text-label tabular-nums text-ink-500">{minutes} min</span>
        <Bouton rang="discret" onClick={() => onAbsent(rdv)}>
          {fr.reception.arrivees.marquerAbsent}
        </Bouton>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-sunken">
        <div
          className={["h-full rounded-full transition-all duration-normal", niveau === "normal" ? "bg-positive" : "bg-attention"].join(" ")}
          style={{ width: `${progression}%` }}
        />
      </div>
    </div>
  );
}
