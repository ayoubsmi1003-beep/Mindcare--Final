/**
 * TopbarReception — le bandeau de travail du poste d'accueil.
 *
 * L'identité de page vit dans la barre de la coquille (un seul h1). Ici on
 * porte trois choses, dans cet ordre de lecture : le jour que l'on regarde,
 * la recherche, et l'action dominante. Le bandeau n'est plus une carte dans
 * une carte : c'est une ligne posée sur le canevas, ce qui retire une surface
 * et rend le bouton primaire plus net.
 *
 * La date est écrite en toutes lettres — « Aujourd'hui » seul ne dit pas quel
 * jour on regarde quand on a navigué la veille.
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

function dateLongue(iso: string): string {
  const [annee, mois, jour] = iso.split("-").map(Number);
  if (annee === undefined || mois === undefined || jour === undefined) return iso;
  const date = new Date(annee, mois - 1, jour, 12, 0, 0);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function TopbarReception({
  ancreIso,
  aujourdhuiIso,
  versSaisieJour,
  requete,
  onRequete,
  rechercheRef,
}: Props): React.JSX.Element {
  const estAujourdhui = ancreIso === aujourdhuiIso;
  return (
    <div className="flex min-h-target flex-wrap items-center gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="font-ui text-label font-medium text-ink-500">
          {estAujourdhui ? fr.agenda.aujourdhui : fr.reception.jourAffiche}
        </span>
        <span className="truncate font-ui text-body font-semibold text-ink-900">
          {dateLongue(ancreIso)}
        </span>
      </div>

      <div className="ms-auto flex items-center gap-2">
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
            placeholder={fr.reception.recherche.indicationCourte}
            value={requete}
            onChange={(e) => onRequete(e.target.value)}
            className="w-full border-0 bg-transparent font-ui text-body text-ink-900 outline-none placeholder:text-ink-500"
          />
        </div>
        <Link
          href="/agenda/nouveau"
          className="inline-flex min-h-target shrink-0 items-center justify-center gap-2 rounded-full bg-brand-600 px-4 font-ui text-body font-semibold text-on-brand shadow-douce no-underline transition duration-quick ease-out hover:bg-brand-700 hover:shadow-carte focus-visible:outline focus-visible:outline-action-600"
        >
          <Icone nom="agenda" taille={16} />
          <span className="whitespace-nowrap">{fr.reception.frise.nouveauRdv}</span>
        </Link>
      </div>
    </div>
  );
}
