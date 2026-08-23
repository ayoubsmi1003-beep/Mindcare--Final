/**
 * La zone d'attention — les NEUF items au plus, chacun avec UNE action.
 *
 * ⚠️ PLAFOND DUR (critère d'acceptation du lot) : `itemsAttention` tronque à
 * 9 ; ce composant affiche le débord en phrase honnête et ne rend JAMAIS un
 * dixième item. Le checkpoint compte les cartes de cette zone dans le DOM.
 *
 * Chaque carte porte : QUOI (le type), QUI (identité permise), QUOI FAIRE
 * (une action principale). Un montant s'affiche par `formaterDzd`, en
 * `font-num tabular-nums`, jamais posé sur un verre ou un dégradé (§4 règle 2,
 * ADR-022). Le ton est `attention` — jamais `critical` : rien n'est perdu.
 */

"use client";

import { fr } from "@/i18n/fr";

import { Badge } from "@/components/ui/Badge";
import { Bouton } from "@/components/ui/Bouton";
import { formaterDzd } from "@/services/finance";
import {
  itemsAttention,
  type ItemAttention,
  type ResultatAttention,
} from "./attention";
import type { PaiementAccueil, RdvAccueil } from "@/services/reception";

export type { ResultatAttention };

interface ZoneAttentionProps {
  readonly journee: readonly RdvAccueil[];
  readonly demandes: readonly RdvAccueil[];
  readonly paiements: readonly PaiementAccueil[];
  readonly maintenant: Date;
  readonly onEncaisser: (paiement: PaiementAccueil) => void;
  readonly onArrivee: (rdv: RdvAccueil) => void;
  readonly onConfirmationDemande: (rdv: RdvAccueil) => void;
  readonly onSelectRdv: (id: string) => void;
}

function identite(rdv: RdvAccueil): string {
  if (rdv.lastName === null && rdv.firstName === null) return fr.agenda.patientNonRattache;
  return [rdv.lastName, rdv.firstName].filter(Boolean).join(" ");
}

export function ZoneAttention({
  journee,
  demandes,
  paiements,
  maintenant,
  onEncaisser,
  onArrivee,
  onConfirmationDemande,
  onSelectRdv,
}: ZoneAttentionProps): React.JSX.Element {
  const { affiches, restants } = itemsAttention(
    journee,
    demandes,
    paiements,
    maintenant,
  );

  if (affiches.length === 0) {
    return (
      <section aria-label={fr.reception.attention.titre} className="flex flex-col gap-2">
        <TitreZone>{fr.reception.attention.titre}</TitreZone>
        <p className="rounded-md border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">
          {fr.reception.attention.vide}
        </p>
      </section>
    );
  }

  return (
    <section aria-label={fr.reception.attention.titre} className="flex flex-col gap-2">
      <TitreZone>
        {fr.reception.attention.titre}
        <span className="ml-auto font-num text-num tabular-nums text-ink-500">
          {affiches.length}/9
        </span>
      </TitreZone>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {affiches.map((item) => (
          <li key={item.cle}>
            <CarteAttention
              item={item}
              onEncaisser={onEncaisser}
              onArrivee={onArrivee}
              onConfirmationDemande={onConfirmationDemande}
              onSelectRdv={onSelectRdv}
            />
          </li>
        ))}
      </ul>

      {/* Débord HONNÊTE : compté, annoncé, renvoyé aux files. Jamais un dixième
          item entassé ici (plafond ≤ 9, critère du lot). */}
      {restants > 0 ? (
        <p role="status" className="px-1 font-ui text-label text-ink-500">
          + {restants} {fr.reception.attention.autres}
        </p>
      ) : null}
    </section>
  );
}

function TitreZone({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className="flex items-center gap-2 font-ui text-heading font-semibold text-ink-900">
      {children}
    </h3>
  );
}

function CarteAttention({
  item,
  onEncaisser,
  onArrivee,
  onConfirmationDemande,
  onSelectRdv,
}: {
  readonly item: ItemAttention;
  readonly onEncaisser: (paiement: PaiementAccueil) => void;
  readonly onArrivee: (rdv: RdvAccueil) => void;
  readonly onConfirmationDemande: (rdv: RdvAccueil) => void;
  readonly onSelectRdv: (id: string) => void;
}): React.JSX.Element {
  const commun = [
    "flex min-h-target items-center gap-3 rounded-md border px-3 py-2",
    "border-attention bg-attention-bg",
  ].join(" ");

  switch (item.type) {
    case "paiement":
      return (
        <div className={[commun, "flex-wrap"].join(" ")}>
          <Badge ton="attention">{fr.reception.paiements.ongletDues}</Badge>
          <span className="min-w-0 flex-auto truncate font-ui text-body font-semibold text-ink-900">
            {identiteDe(item.paiement)}
          </span>
          <span className="font-num text-num font-medium tabular-nums text-ink-900">
            {formaterDzd(item.paiement.amountDzd)}
          </span>
          <Bouton rang="principal" onClick={() => onEncaisser(item.paiement)}>
            {fr.reception.paiements.encaisser}
          </Bouton>
        </div>
      );

    case "retard":
      return (
        <div className={commun}>
          <Badge ton="attention">{fr.reception.pulse.retards}</Badge>
          <button
            type="button"
            onClick={() => onSelectRdv(item.rdv.id)}
            className="min-w-0 flex-auto truncate bg-transparent text-left font-ui text-body text-ink-900 outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            {identite(item.rdv)} · {item.rdv.practitionerName ?? fr.etats.texteAbsent}
          </button>
          <Bouton rang="secondaire" onClick={() => onArrivee(item.rdv)}>
            {fr.reception.arrivees.marquerArrivee}
          </Bouton>
        </div>
      );

    case "attente":
      return (
        <div className={commun}>
          <Badge ton="information">{fr.reception.arrivees.titre}</Badge>
          <button
            type="button"
            onClick={() => onSelectRdv(item.rdv.id)}
            className="min-w-0 flex-auto truncate bg-transparent text-left font-ui text-body text-ink-900 outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            {identite(item.rdv)}
          </button>
          <span className="shrink-0 font-num text-num tabular-nums text-attention-ink">
            {item.minutesAttente} min
          </span>
        </div>
      );

    case "imminent":
      return (
        <div className={commun}>
          <Badge ton="neutre">{fr.reception.frise.maintenant}</Badge>
          <button
            type="button"
            onClick={() => onSelectRdv(item.rdv.id)}
            className="min-w-0 flex-auto truncate bg-transparent text-left font-ui text-body text-ink-700 outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            {identite(item.rdv)}
          </button>
        </div>
      );

    case "demande":
      return (
        <div className={commun}>
          <Badge ton="neutre">{fr.reception.pulse.demandes}</Badge>
          <button
            type="button"
            onClick={() => onSelectRdv(item.rdv.id)}
            className="min-w-0 flex-auto truncate bg-transparent text-left font-ui text-body text-ink-700 outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            {identite(item.rdv)}
          </button>
          <Bouton rang="secondaire" onClick={() => onConfirmationDemande(item.rdv)}>
            {fr.actions.confirmer}
          </Bouton>
        </div>
      );
  }
}

function identiteDe(paiement: PaiementAccueil): string {
  if (paiement.lastName === null && paiement.firstName === null)
    return fr.agenda.patientNonRattache;
  return [paiement.lastName, paiement.firstName].filter(Boolean).join(" ");
}
