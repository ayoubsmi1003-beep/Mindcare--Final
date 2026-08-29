/**
 * TopbarReception — Meadows-inspired soft premium header.
 * Outer shell double-bezel, inner white card, search pill, primary CTA.
 * No dark gradient: Reception is operational calm, not marketing hero.
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
    <div className="rounded-xl bg-card p-1.5 shadow-lift1 ring-1 ring-rule">
      <div className="flex min-h-target items-center gap-3 rounded-lg bg-layer-ambient px-4 py-2.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-on-brand shadow-lift1">
          <Icone nom="agenda" taille={16} />
        </span>
        <div className="min-w-0">
          <h1 className="font-ui text-heading font-semibold text-ink-900">{fr.reception.titre}</h1>
          <span className="hidden items-center gap-1 font-ui text-label font-medium text-ink-500 desktop:inline-flex">
            <Icone nom="horloge" taille={16} className="text-ink-500" />
            {estAujourdhui ? fr.agenda.aujourdhui : versSaisieJour(ancreIso)} · Poste d&apos;accueil
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden min-h-target w-72 items-center gap-2 rounded-full bg-card px-3 py-1 shadow-lift1 ring-1 ring-rule focus-within:ring-action-500 tablet:flex">
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
          <div className="relative flex min-h-target w-40 items-center gap-2 rounded-full bg-card px-3 py-1 shadow-lift1 ring-1 ring-rule tablet:hidden">
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
            className="inline-flex min-h-target shrink-0 items-center justify-center rounded-full bg-brand-600 px-5 font-ui text-body font-semibold text-on-brand shadow-lift1 no-underline transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-action-600"
          >
            {fr.agenda.nouveau}
          </Link>
        </div>
      </div>
    </div>
  );
}
