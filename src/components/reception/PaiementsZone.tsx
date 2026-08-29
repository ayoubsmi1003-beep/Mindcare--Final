/**
 * PaiementsZone — liste unique À encaisser (pas de tabs dans la même colonne).
 * La zone ATTENTION et NOTIFICATIONS n'ont plus de CTA Encaisser dupliqué :
 * elles renvoient vers cette colonne (focus). Tiroir extrait en ModalEncaissement.
 */
"use client";

import Link from "next/link";
import { fr } from "@/i18n/fr";
import { PaiementCard, PaiementEncaisseCard } from "./PaiementCard";
import type { PaiementAccueil } from "@/services/reception";

interface Props {
  readonly paiements: readonly PaiementAccueil[];
  readonly maintenant: Date;
  readonly onEncaisser: (p: PaiementAccueil) => void;
}

export function PaiementsZone({ paiements, maintenant, onEncaisser }: Props): React.JSX.Element {
  const debutJour = new Date(maintenant);
  debutJour.setHours(0, 0, 0, 0);

  const dues = paiements.filter((p) => p.collectedAt === null);
  const encaissesAujourdhui = paiements.filter((p) => p.collectedAt !== null && Date.parse(p.collectedAt) >= debutJour.getTime());
  const MAX_DUES = 5;
  const duesVisibles = dues.slice(0, MAX_DUES);
  const duesRestants = dues.length - MAX_DUES;

  return (
    <section aria-label={fr.reception.paiements.titre} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="font-ui text-heading font-semibold text-ink-900">{fr.reception.paiements.titre}</h3>
        <span className="rounded-full bg-attention-bg px-2 py-0.5 font-num text-label font-semibold tabular-nums text-attention-ink">{dues.length}</span>
        <span className="font-ui text-label text-ink-500">· {fr.reception.paiements.ongletEncaisses} {encaissesAujourdhui.length}</span>
      </div>

      {dues.length === 0 ? (
        <p className="rounded-md border border-rule bg-sunken px-3 py-3 font-ui text-body text-ink-500">{fr.reception.paiements.videDues}</p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {duesVisibles.map((p) => (
              <li key={p.paymentId}>
                <PaiementCard paiement={p} onEncaisser={onEncaisser} />
              </li>
            ))}
          </ul>
          {duesRestants > 0 ? <p className="px-1 font-ui text-label text-ink-500">+ {duesRestants} autres — voir Finances</p> : null}
        </>
      )}

      {encaissesAujourdhui.length > 0 ? (
        <details className="rounded-md border border-rule bg-sunken px-3 py-2">
          <summary className="cursor-pointer font-ui text-label font-medium text-ink-700">
            {fr.reception.paiements.ongletEncaisses} ({encaissesAujourdhui.length})
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
            {encaissesAujourdhui.slice(0, 4).map((p) => (
              <li key={p.paymentId}>
                <PaiementEncaisseCard paiement={p} />
              </li>
            ))}
          </ul>
          <Link href="/finances" className="mt-2 inline-block font-ui text-label font-medium text-action-600 hover:text-action-700">
            {fr.reception.paiements.voirTous} →
          </Link>
        </details>
      ) : null}
    </section>
  );
}

// Tiroir conservé pour compatibilité import existant — delegue au modal
export { ModalEncaissement as TiroirEncaissement } from "./ModalEncaissement";
