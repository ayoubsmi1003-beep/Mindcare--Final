/**
 * TopbarReception — barre d'outils inline de la réception.
 * L'identité de page vit dans la Topbar de la coquille (un seul h1) : ici,
 * uniquement le contexte de jour, la recherche et l'action — sans 2e barre.
 */
"use client";

import Link from "next/link";
import { fr } from "@/i18n/fr";
import { Icone } from "@/components/ui/Icones";
import type { RefObject } from "react";

interface Props {
  readonly ancreIso: string;
  readonly aujourdhuiIso: string;
  readonly versSaisieJour: (iso: string) => string;
  readonly requete: string;
  readonly onRequete: (v: string) => void;
  readonly rechercheRef: RefObject<HTMLInputElement | null>;
}

export function TopbarReception({ ancreIso, aujourdhuiIso, versSaisieJour, requete, onRequete, rechercheRef }: Props): React.JSX.Element {
  const estAujourdhui = ancreIso === aujourdhuiIso;
  return (
    <div className="flex min-h-target flex-wrap items-center gap-2 rounded-xl border border-rule bg-card px-3 py-2 shadow-douce">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 font-ui text-label font-medium text-ink-700">
        <Icone nom="horloge" taille={16} className="text-ink-500" />
        {estAujourdhui ? fr.agenda.aujourdhui : versSaisieJour(ancreIso)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative hidden min-h-target w-64 items-center gap-2 rounded-full bg-muted px-3 py-1 ring-1 ring-rule focus-within:ring-action-500 tablet:flex">
          <Icone nom="recherche" taille={16} className="shrink-0 text-ink-500" />
          <input
            ref={rechercheRef}
            type="search"
            aria-label={fr.reception.recherche.libelle}
            placeholder={fr.reception.recherche.indicationCourte}
            value={requete}
            onChange={(e) => onRequete(e.target.value)}
            className="w-full border-0 bg-transparent font-ui text-body text-ink-900 outline-none placeholder:text-ink-500"
          />
        </div>
        <div className="relative flex min-h-target w-40 items-center gap-2 rounded-full bg-muted px-3 py-1 ring-1 ring-rule tablet:hidden">
          <Icone nom="recherche" taille={16} className="shrink-0 text-ink-500" />
          <input
            type="search"
            aria-label={fr.reception.recherche.libelle}
            placeholder="Rechercher"
            value={requete}
            onChange={(e) => onRequete(e.target.value)}
            className="w-full border-0 bg-transparent font-ui text-body text-ink-900 outline-none placeholder:text-ink-500"
          />
        </div>
        <Link
          href="/agenda/nouveau"
          className="inline-flex min-h-target shrink-0 items-center justify-center rounded-full bg-brand-600 px-4 font-ui text-body font-semibold text-on-brand shadow-douce no-underline transition duration-quick ease-out hover:bg-brand-700 hover:shadow-carte focus-visible:outline focus-visible:outline-action-600"
        >
          {fr.agenda.nouveau}
        </Link>
      </div>
    </div>
  );
}
