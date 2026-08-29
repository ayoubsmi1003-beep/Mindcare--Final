/**
 * Zone d'attention — ≤9 items, carte compacte + CTA lien-focus (pas encaisser dupliqué).
 * Paiement → "Voir" focus colonne encaissements. Retard → Marquer arrivé. Attente → Voir file.
 */
"use client";

import { fr } from "@/i18n/fr";
import { Badge } from "@/components/ui/Badge";
import { Bouton } from "@/components/ui/Bouton";
import { formaterDzd } from "@/services/finance";
import { itemsAttention, type ItemAttention } from "./attention";
import type { PaiementAccueil, RdvAccueil } from "@/services/reception";

export type { ResultatAttention } from "./attention";

interface Props {
  readonly journee: readonly RdvAccueil[];
  readonly demandes: readonly RdvAccueil[];
  readonly paiements: readonly PaiementAccueil[];
  readonly maintenant: Date;
  readonly onFocusEncaissement: (p: PaiementAccueil) => void;
  readonly onArrivee: (rdv: RdvAccueil) => void;
  readonly onConfirmationDemande: (rdv: RdvAccueil) => void;
  readonly onSelectRdv: (id: string) => void;
}

function identite(rdv: RdvAccueil): string {
  if (rdv.lastName === null && rdv.firstName === null) return fr.agenda.patientNonRattache;
  return [rdv.lastName, rdv.firstName].filter(Boolean).join(" ");
}

export function ZoneAttention({ journee, demandes, paiements, maintenant, onFocusEncaissement, onArrivee, onConfirmationDemande, onSelectRdv }: Props): React.JSX.Element {
  const { affiches, restants } = itemsAttention(journee, demandes, paiements, maintenant);

  if (affiches.length === 0) {
    return (
      <section aria-label={fr.reception.attention.titre} className="flex flex-col gap-2">
        <TitreZone>{fr.reception.attention.titre}</TitreZone>
        <p className="rounded-md border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">{fr.reception.attention.vide}</p>
      </section>
    );
  }

  return (
    <section aria-label={fr.reception.attention.titre} className="flex flex-col gap-2">
      <TitreZone>
        {fr.reception.attention.titre}
        <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 font-num text-label tabular-nums text-ink-500">{affiches.length}/9</span>
      </TitreZone>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {affiches.map((item) => (
          <li key={item.cle}>
            <CarteAttention item={item} onFocusEncaissement={onFocusEncaissement} onArrivee={onArrivee} onConfirmationDemande={onConfirmationDemande} onSelectRdv={onSelectRdv} />
          </li>
        ))}
      </ul>
      {restants > 0 ? (
        <p role="status" className="px-1 font-ui text-label text-ink-500">
          + {restants} {fr.reception.attention.autres}
        </p>
      ) : null}
    </section>
  );
}

function TitreZone({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <h3 className="flex items-center gap-2 font-ui text-heading font-semibold text-ink-900">{children}</h3>;
}

function CarteAttention({
  item,
  onFocusEncaissement,
  onArrivee,
  onConfirmationDemande,
  onSelectRdv,
}: {
  readonly item: ItemAttention;
  readonly onFocusEncaissement: (p: PaiementAccueil) => void;
  readonly onArrivee: (rdv: RdvAccueil) => void;
  readonly onConfirmationDemande: (rdv: RdvAccueil) => void;
  readonly onSelectRdv: (id: string) => void;
}): React.JSX.Element {
  const base = "flex min-h-target items-center gap-2 rounded-md border px-2 py-1.5 border-attention bg-attention-bg";

  switch (item.type) {
    case "paiement":
      return (
        <div className={base}>
          <Badge ton="attention">{fr.reception.paiements.ongletDues}</Badge>
          <span className="min-w-0 flex-1 truncate font-ui text-body font-medium text-ink-900">{identiteDe(item.paiement)}</span>
          <span className="shrink-0 font-num text-label font-semibold tabular-nums text-ink-900">{formaterDzd(item.paiement.amountDzd)}</span>
          <Bouton rang="discret" onClick={() => onFocusEncaissement(item.paiement)}>
            {fr.reception.attention.voirEncaissement}
          </Bouton>
        </div>
      );
    case "retard":
      return (
        <div className={base}>
          <Badge ton="attention">{fr.reception.pulse.retards}</Badge>
          <button type="button" onClick={() => onSelectRdv(item.rdv.id)} className="min-w-0 flex-1 truncate text-left font-ui text-body text-ink-900 focus-visible:outline focus-visible:outline-action-600">
            {identite(item.rdv)}
          </button>
          <Bouton rang="secondaire" onClick={() => onArrivee(item.rdv)}>
            {fr.reception.arrivees.marquerArrivee}
          </Bouton>
        </div>
      );
    case "attente":
      return (
        <div className={base}>
          <Badge ton="information">{fr.reception.arrivees.titre}</Badge>
          <button type="button" onClick={() => onSelectRdv(item.rdv.id)} className="min-w-0 flex-1 truncate text-left font-ui text-body text-ink-900 focus-visible:outline focus-visible:outline-action-600">
            {identite(item.rdv)}
          </button>
          <span className="shrink-0 font-num text-label tabular-nums text-attention-ink">{item.minutesAttente} min</span>
        </div>
      );
    case "imminent":
      return (
        <div className={base}>
          <Badge ton="neutre">{fr.reception.frise.maintenant}</Badge>
          <button type="button" onClick={() => onSelectRdv(item.rdv.id)} className="min-w-0 flex-1 truncate text-left font-ui text-body text-ink-700 focus-visible:outline focus-visible:outline-action-600">
            {identite(item.rdv)}
          </button>
          <Bouton rang="discret" onClick={() => onSelectRdv(item.rdv.id)}>
            {fr.reception.attention.voir}
          </Bouton>
        </div>
      );
    case "demande":
      return (
        <div className={base}>
          <Badge ton="neutre">{fr.reception.pulse.demandes}</Badge>
          <button type="button" onClick={() => onSelectRdv(item.rdv.id)} className="min-w-0 flex-1 truncate text-left font-ui text-body text-ink-700 focus-visible:outline focus-visible:outline-action-600">
            {identite(item.rdv)}
          </button>
          <Bouton rang="secondaire" onClick={() => onConfirmationDemande(item.rdv)}>
            {fr.actions.confirmer}
          </Bouton>
        </div>
      );
  }
}

function identiteDe(p: PaiementAccueil): string {
  if (p.lastName === null && p.firstName === null) return fr.agenda.patientNonRattache;
  return [p.lastName, p.firstName].filter(Boolean).join(" ");
}
