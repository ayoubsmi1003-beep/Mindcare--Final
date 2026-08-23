/**
 * Onglets — la navigation d'un dossier qui a plusieurs faces.
 *
 * ⚠️ POURQUOI CE COMPOSANT EXISTE ALORS QUE `index.ts` REFUSE LES PRIMITIVES
 * SANS APPELANT. Il en a un, et un seul pour l'instant : l'espace de travail
 * patient. Il n'est pas ajouté « pour plus tard ».
 *
 * ═══ LE CLAVIER N'EST PAS UNE OPTION ══════════════════════════════════════
 *
 * Un `role="tablist"` impose un contrat que la souris ne révèle jamais : les
 * flèches déplacent la sélection, `Home`/`End` vont aux extrémités, et UN SEUL
 * onglet est atteignable par `Tab` — c'est le « roving tabindex ». Sans lui,
 * `Tab` traverse les six onglets un par un avant d'atteindre le contenu, ce qui
 * transforme la navigation clavier en épreuve. Les composants d'onglets écrits
 * à la va-vite oublient systématiquement cette partie, et le défaut ne se voit
 * pas à la souris.
 *
 * ═══ LA SÉLECTION SUIT LE FOCUS ═══════════════════════════════════════════
 *
 * Modèle « automatic activation » (le plus courant, et celui que l'ARIA
 * recommande quand changer d'onglet est instantané) : déplacer le focus change
 * l'onglet. Ce n'est PAS anodin ici — chaque panneau de l'espace patient qui
 * charge en différé écrit une trace d'audit. Le composant ne charge donc RIEN
 * lui-même : il rend un panneau, et c'est l'appelant qui décide si ce panneau
 * lit quelque chose. La règle est écrite dans l'écran, pas ici.
 *
 * ═══ CE QU'IL NE FAIT PAS ═════════════════════════════════════════════════
 *
 * Il ne cache aucune donnée pour raison de sécurité. Un onglet absent de la
 * liste est un onglet que l'APPELANT n'a pas construit, parce que la porte a
 * rendu `null` — la frontière reste la RLS, jamais ce fichier (règle 4).
 */

"use client";

import { useRef } from "react";

import { Icone, type NomIcone } from "./Icones";

export interface Onglet {
  readonly cle: string;
  readonly libelle: string;
  readonly icone?: NomIcone;
}

export function Onglets({
  onglets,
  actif,
  onChanger,
  etiquette,
}: {
  readonly onglets: readonly Onglet[];
  readonly actif: string;
  readonly onChanger: (cle: string) => void;
  /** Ce que la barre d'onglets navigue, pour un lecteur d'écran. */
  readonly etiquette: string;
}): React.JSX.Element {
  const boutons = useRef<Map<string, HTMLButtonElement>>(new Map());

  function deplacer(indexCible: number): void {
    // Bouclage : depuis le dernier onglet, `→` revient au premier. C'est le
    // comportement attendu d'un tablist, et il évite l'impression de butée.
    const total = onglets.length;
    const cible = onglets[(indexCible + total) % total];
    if (cible === undefined) return;
    onChanger(cible.cle);
    // Le focus SUIT la sélection : sans cela, les flèches suivantes
    // repartiraient de l'ancien onglet et la navigation deviendrait erratique.
    boutons.current.get(cible.cle)?.focus();
  }

  function auClavier(evenement: React.KeyboardEvent, index: number): void {
    switch (evenement.key) {
      case "ArrowRight":
        evenement.preventDefault();
        deplacer(index + 1);
        break;
      case "ArrowLeft":
        evenement.preventDefault();
        deplacer(index - 1);
        break;
      case "Home":
        evenement.preventDefault();
        deplacer(0);
        break;
      case "End":
        evenement.preventDefault();
        deplacer(onglets.length - 1);
        break;
      default:
        // Tout le reste appartient au navigateur — surtout `Tab`, qui doit
        // sortir de la barre pour atteindre le panneau.
        break;
    }
  }

  return (
    <div
      role="tablist"
      aria-label={etiquette}
      // Sous la rupture `tablet`, la barre défile DANS SON PROPRE conteneur
      // plutôt que de faire défiler la page : un espace de travail dont la page
      // part de travers à cause d'une barre de navigation est inutilisable.
      className="flex gap-1 overflow-x-auto border-b border-rule"
    >
      {onglets.map((onglet, index) => {
        const selectionne = onglet.cle === actif;
        return (
          <button
            key={onglet.cle}
            ref={(noeud) => {
              if (noeud === null) boutons.current.delete(onglet.cle);
              else boutons.current.set(onglet.cle, noeud);
            }}
            type="button"
            role="tab"
            id={`onglet-${onglet.cle}`}
            aria-selected={selectionne}
            aria-controls={`panneau-${onglet.cle}`}
            // Le roving tabindex — voir l'en-tête.
            tabIndex={selectionne ? 0 : -1}
            onClick={() => onChanger(onglet.cle)}
            onKeyDown={(e) => auClavier(e, index)}
            className={[
              "inline-flex min-h-target-lg shrink-0 items-center gap-2 whitespace-nowrap",
              "rounded-t-md px-4 py-3 font-ui text-body transition-colors duration-quick ease-out",
              // ⚠️ LE SOULIGNÉ N'EST PAS DÉCORATIF : c'est le second porteur de
              // l'état, à côté de la couleur et de `aria-selected`. La couleur
              // seule ne porte jamais un sens (§4 règle 4).
              selectionne
                ? "border-b-2 border-brand-600 font-semibold text-brand-700"
                : "border-b-2 border-transparent text-ink-500 hover:bg-sunken hover:text-ink-700",
            ].join(" ")}
          >
            {onglet.icone === undefined ? null : <Icone nom={onglet.icone} taille={20} />}
            {onglet.libelle}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Le panneau associé. Séparé du `tablist` pour que l'appelant puisse le placer
 * où il veut dans la page — et surtout, pour qu'il puisse n'en monter qu'UN :
 * monter les six et les masquer en CSS ferait lire six fois le dossier.
 */
export function PanneauOnglet({
  cle,
  children,
}: {
  readonly cle: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`panneau-${cle}`}
      aria-labelledby={`onglet-${cle}`}
      // `tabIndex={0}` : le panneau doit pouvoir recevoir le focus au `Tab`
      // suivant, sinon un panneau sans élément focalisable est inatteignable au
      // clavier et son contenu n'est jamais annoncé.
      tabIndex={0}
      className="pt-6"
    >
      {children}
    </div>
  );
}
