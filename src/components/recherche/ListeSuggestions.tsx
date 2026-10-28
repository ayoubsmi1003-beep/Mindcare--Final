"use client";

/**
 * ListeSuggestions — la liste commune des recherches (médicaments, patients).
 *
 * Rôle ARIA `listbox` : le champ garde le focus, `aria-activedescendant` désigne
 * l'option active, ↑/↓ déplacent, Entrée choisit, Échap ferme. Le pied de liste
 * dit le TOTAL et propose « Afficher plus » — c'est ce qui rend les 33 lignes
 * « doli » atteignables au lieu des 8 premières.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { Icone } from "@/components/ui";
import { compteResultats, recherche as t } from "@/i18n/recherche";

export interface ListeSuggestionsProps<T> {
  readonly idListe: string;
  readonly items: readonly T[];
  readonly actif: number;
  readonly onChoisir: (item: T) => void;
  readonly rendre: (item: T) => ReactNode;
  readonly requete: string;
  readonly total: number;
  readonly chargement: boolean;
  readonly chargementPlus: boolean;
  readonly erreur: string | null;
  readonly vide: string;
  readonly onPlus: () => void;
}

/** Surligne les jetons de la saisie, sans jamais réécrire le texte affiché. */
export function surligner(texte: string, requete: string): ReactNode {
  const jetons = requete
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((jeton) => jeton.length >= 2);
  if (jetons.length === 0) return texte;

  const motif = jetons
    .map((jeton) => jeton.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const decoupe = new RegExp(`(${motif})`, "gi");
  const connus = new Set(jetons.map((jeton) => jeton.toLocaleLowerCase("fr")));

  return texte.split(decoupe).map((morceau, index) =>
    connus.has(morceau.toLocaleLowerCase("fr")) ? (
      <mark key={`${morceau}-${index}`} className="rounded bg-action-50 px-0.5 text-ink-900">
        {morceau}
      </mark>
    ) : (
      morceau
    ),
  );
}

export function ListeSuggestions<T>({
  idListe,
  items,
  actif,
  onChoisir,
  rendre,
  requete,
  total,
  chargement,
  chargementPlus,
  erreur,
  vide,
  onPlus,
}: ListeSuggestionsProps<T>): React.JSX.Element {
  const actifRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    actifRef.current?.scrollIntoView({ block: "nearest" });
  }, [actif]);

  if (erreur !== null) {
    return (
      <p role="alert" className="rounded-lg border border-rule bg-card px-3 py-2 font-ui text-label text-critical">
        {erreur}
      </p>
    );
  }

  if (chargement && items.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-rule bg-card px-3 py-2 font-ui text-label text-ink-500">
        {t.chargement}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-rule bg-card px-3 py-2 font-ui text-label text-ink-500">
        {vide}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-card shadow-carte">
      <ul
        id={idListe}
        role="listbox"
        aria-busy={chargement || chargementPlus || undefined}
        aria-label={t.resultats}
        className="m-0 flex max-h-80 list-none flex-col gap-0.5 overflow-y-auto p-1"
        onMouseDown={(event) => event.preventDefault()}
      >
        {items.map((item, index) => (
          <li
            key={`${idListe}-${index}`}
            id={`${idListe}-option-${index}`}
            ref={index === actif ? actifRef : undefined}
            role="option"
            aria-selected={index === actif}
            onClick={() => onChoisir(item)}
            className={[
              "cursor-pointer rounded-lg px-3 py-2 font-ui text-body text-ink-900 transition-colors duration-quick",
              index === actif ? "bg-action-50 ring-1 ring-action-600" : "hover:bg-muted",
            ].join(" ")}
          >
            {rendre(item)}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-rule bg-muted/30 px-3 py-2">
        <span className="font-num text-label tabular-nums text-ink-500">
          {compteResultats(total)}
          {chargement || chargementPlus ? ` · ${t.miseAJour}` : ""}
        </span>
        {items.length < total ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPlus();
            }}
            disabled={chargementPlus}
            className="inline-flex items-center gap-1 font-ui text-label font-semibold text-action-600 underline-offset-4 hover:underline disabled:opacity-50"
          >
            <Icone nom="chevron" taille={16} />
            {t.afficherPlus}
          </button>
        ) : (
          <span className="font-ui text-label text-ink-300">{t.toutAffiche}</span>
        )}
      </div>
    </div>
  );
}
