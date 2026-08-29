/**
 * Carte paiement uni-ligne — une seule ligne par paiement à encaisser.
 * Grille fixe : nom trunc | reçu (desktop) | montant | CTA.
 * Aucun scroll horizontal, aucun chevauchement.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Bouton } from "@/components/ui/Bouton";
import { formaterDzd } from "@/services/finance";
import type { PaiementAccueil } from "@/services/reception";

interface Props {
  readonly paiement: PaiementAccueil;
  readonly onEncaisser: (p: PaiementAccueil) => void;
  readonly compact?: boolean;
}

function identite(p: PaiementAccueil): string {
  if (p.lastName === null && p.firstName === null) return fr.agenda.patientNonRattache;
  return [p.lastName, p.firstName].filter(Boolean).join(" ");
}

export function PaiementCard({ paiement, onEncaisser, compact = false }: Props): React.JSX.Element {
  return (
    <div className="flex min-h-target items-center gap-2 rounded-md border border-rule bg-card px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-ui text-body font-medium text-ink-900">
        {identite(paiement)}
      </span>
      {!compact ? (
        <span className="hidden shrink-0 truncate font-num text-label tabular-nums text-ink-500 desktop:inline">
          {fr.reception.paiements.recu} {paiement.receiptNumber}
        </span>
      ) : null}
      <span className="shrink-0 font-num text-num font-semibold tabular-nums text-ink-900">
        {formaterDzd(paiement.amountDzd)}
      </span>
      <Bouton rang="principal" onClick={() => onEncaisser(paiement)}>
        {fr.reception.paiements.encaisserCourt}
      </Bouton>
    </div>
  );
}

export function PaiementEncaisseCard({ paiement }: { readonly paiement: PaiementAccueil }): React.JSX.Element {
  const heure = paiement.collectedAt ? heureLocale(paiement.collectedAt) : null;
  return (
    <div className="flex min-h-target items-center gap-2 rounded-md border border-positive bg-positive-bg px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-ui text-body text-ink-700">
        {[paiement.lastName, paiement.firstName].filter(Boolean).join(" ") || fr.agenda.patientNonRattache}
      </span>
      {heure ? (
        <span className="shrink-0 font-num text-label tabular-nums text-ink-500">{heure}</span>
      ) : null}
      <span className="shrink-0 font-num text-num font-medium tabular-nums text-ink-900">
        {formaterDzd(paiement.amountDzd)}
      </span>
    </div>
  );
}

function heureLocale(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}
