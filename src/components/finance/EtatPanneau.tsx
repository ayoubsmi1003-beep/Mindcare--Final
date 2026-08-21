"use client";

/**
 * Les cinq états d'un panneau — MUTUELLEMENT EXCLUSIFS, par construction.
 *
 * ═══ LE DÉFAUT QUE CE COMPOSANT EXISTE POUR RENDRE IMPOSSIBLE ══════════════
 *
 * L'écran précédent pouvait afficher un bloc d'erreur ET un état vide EN MÊME
 * TEMPS : deux booléens indépendants (`erreur`, `vide`) rendus par deux `&&`
 * successifs. Rien dans le type n'interdisait la combinaison, donc elle est
 * arrivée. La médecin lisait « impossible de charger » au-dessus de « aucune
 * donnée sur la période » et ne pouvait pas savoir laquelle des deux phrases
 * décrivait sa situation.
 *
 * La correction n'est pas un `if` de plus, c'est un TYPE : `EtatDonnees` est une
 * union discriminée. Un panneau est dans UN état, jamais dans deux — le
 * compilateur refuse le reste, et aucune relecture future ne peut réintroduire
 * la superposition par distraction.
 *
 * ═══ POURQUOI PAR PANNEAU, ET NON PAR ÉCRAN ════════════════════════════════
 *
 * Un panneau en erreur montre SON propre bouton « Réessayer ». Une échéance qui
 * ne se charge pas ne doit pas effacer la recette du jour : quand un seul bloc
 * échoue, la médecin garde les quatre autres. C'est aussi ce qui donne un sens
 * à l'état `partiel` — des données affichées, plus une réserve visible.
 */

import type { ReactNode } from "react";

import { fr } from "@/i18n/fr";
import { BlocErreur, Bouton, EtatVide, Squelette } from "@/components/ui";

/**
 * ⚠️ UNION DISCRIMINÉE, PAS UN OBJET DE BOOLÉENS. C'est tout l'intérêt :
 * `{ chargement: true, erreur: "…" }` ne peut pas s'écrire.
 */
export type EtatDonnees<T> =
  | { readonly statut: "chargement" }
  | { readonly statut: "vide" }
  | { readonly statut: "erreur"; readonly message: string }
  /** Des données lisibles, ET une réserve à afficher (hors ligne, page partielle). */
  | { readonly statut: "partiel"; readonly donnees: T; readonly reserve: string }
  | { readonly statut: "charge"; readonly donnees: T };

export function PanneauEtat<T>({
  etat,
  onReessayer,
  lignesSquelette = 3,
  messageVide,
  children,
}: {
  readonly etat: EtatDonnees<T>;
  readonly onReessayer?: () => void;
  readonly lignesSquelette?: number;
  readonly messageVide?: string;
  readonly children: (donnees: T) => ReactNode;
}): React.JSX.Element {
  switch (etat.statut) {
    case "chargement":
      return <Squelette lignes={lignesSquelette} />;

    case "erreur":
      // Le « Réessayer » est PORTÉ PAR LE PANNEAU, pas par la page : ce qui a
      // échoué est ce qu'on recharge.
      return (
        <BlocErreur
          message={etat.message}
          {...(onReessayer
            ? {
                action: (
                  <Bouton rang="secondaire" onClick={onReessayer}>
                    {fr.finances.reessayer}
                  </Bouton>
                ),
              }
            : {})}
        />
      );

    case "vide":
      return <EtatVide message={messageVide ?? fr.finances.videPeriode} />;

    case "partiel":
      return (
        <div className="flex h-full flex-col gap-2">
          <p className="font-ui text-label text-attention-ink">{etat.reserve}</p>
          <div className="min-h-0 flex-1">{children(etat.donnees)}</div>
        </div>
      );

    case "charge":
      return <>{children(etat.donnees)}</>;
  }
}
