/**
 * DockActions — barre basse fixe du poste d'accueil.
 * Actions primaires toujours visibles, jamais sous un max-height.
 */
"use client";

import Link from "next/link";
import { fr } from "@/i18n/fr";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icones";
import type { RdvAccueil, PaiementAccueil } from "@/services/reception";
import { heure } from "@/components/AgendaPieces";

interface Props {
  readonly journee: readonly RdvAccueil[];
  readonly paiements: readonly PaiementAccueil[];
  readonly onRechercheFocus: () => void;
}

export function DockActions({ journee, paiements, onRechercheFocus }: Props): React.JSX.Element {
  const confirmes = journee.filter((r) => r.status === "confirmed");
  const premier = [...confirmes].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const restants = paiements.filter((p) => p.collectedAt === null).length;
  const annules = journee.filter((r) => r.status === "cancelled").length;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-rule bg-card px-3 py-2 shadow-lift1">
      <LienBouton href="/agenda/nouveau" rang="principal" taille="compact">
        <Icone nom="agenda" taille={16} />
        {fr.reception.dock.nouveauRdv}
      </LienBouton>
      <Bouton type="button" rang="secondaire" taille="compact" onClick={onRechercheFocus}>
        <Icone nom="recherche" taille={16} />
        {fr.reception.dock.rechercher}
      </Bouton>
      <LienBouton href="/agenda" rang="secondaire" taille="compact">
        {fr.reception.dock.voirAgenda}
      </LienBouton>
      <span className="hidden items-center gap-3 pl-2 font-ui text-label text-ink-500 desktop:inline-flex">
        <span className="h-4 w-px bg-rule" aria-hidden="true" />
        {premier ? (
          <span>
            {confirmes.length} {fr.reception.demain.rdvConfirmes} · {fr.reception.demain.premierA} {heure(premier.startsAt) ?? "--:--"}
          </span>
        ) : (
          <span>{fr.reception.frise.videJournee}</span>
        )}
        <span className="h-4 w-px bg-rule" aria-hidden="true" />
        <span>
          {restants} {fr.reception.demain.paiementsRestants}
        </span>
        {annules > 0 ? <span>· {annules} annulé(s)</span> : null}
      </span>
      <Link href="/finances" className="ml-auto hidden font-ui text-label font-medium text-action-600 hover:text-action-700 desktop:inline">
        {fr.reception.dock.voirFinances} →
      </Link>
    </div>
  );
}
