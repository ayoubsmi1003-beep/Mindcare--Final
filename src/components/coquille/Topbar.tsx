/**
 * LA BARRE SUPÉRIEURE — V7. Elle n'existait pas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI ELLE EST LE CHANGEMENT LE PLUS STRUCTUREL DE LA REFONTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Avant, l'identité de page vivait DANS le contenu, sous la forme d'une
 * bannière héros (`EnTeteEcran`) : un bloc de 120 px en dégradé de marque,
 * avec un motif en filigrane et un sur-titre. Elle ouvrait CHAQUE écran de la
 * même façon. C'était la cause première du « c'est la même interface avec
 * d'autres couleurs » : quel que soit l'écran, les 120 premiers pixels
 * étaient identiques, et le travail réel commençait sous la ligne de flottaison.
 *
 * Faire monter l'identité de page dans une barre de 60 px rend trois choses :
 *   · 120 px de hauteur utile récupérés sur tous les écrans ;
 *   · une composition libre sous la barre — chaque écran compose selon son
 *     travail, au lieu de reprendre le même gabarit bannière + pile de cartes ;
 *   · un emplacement stable et prévisible pour la commande et les actions,
 *     ce qu'aucune bannière par écran ne pouvait offrir.
 *
 * ⚠️ LE CHAMP DE COMMANDE A ÉTÉ RETIRÉ — V9, ET CE PARAGRAPHE DISAIT L'INVERSE.
 * Il portait le lancement d'Alexa, au motif que l'assistant devait « appartenir
 * à l'instrument » plutôt qu'être une bulle posée dessus. Arbitrage praticienne
 * du 2026-09-08 : le lanceur redevient la bulle flottante (`BulleAlexa`), et ce
 * champ disparaît — UN seul lanceur, pas deux.
 *
 * Ce que l'argument de V7 n'avait pas vu : `AppShell` ne rend pas cette barre en
 * mode séance. Le lanceur unique vivait donc partout SAUF pendant une
 * consultation, là où l'assistante sert le plus.
 *
 * L'ORBE, LUI, RESTE — et ce n'est pas un lanceur. Il renseigne l'état de la
 * voix (huit états, cf. `OrbeVoix`). C'est la bulle qui ouvre.
 */

"use client";

import { fr } from "@/i18n/fr";

import { OrbeVoix } from "../OrbeVoix";

export interface TopbarProps {
  /** L'identité de l'écran. Jamais un nom de patient sur un écran de lieu. */
  readonly titre: string;
  /** Précision facultative — période, comptage, contexte. Une ligne. */
  readonly sousTitre?: string;
  /** Actions de page, alignées à droite. Une action dominante au plus. */
  readonly actions?: React.ReactNode;
  /**
   * L'assistante n'a pas Alexa : l'orbe d'état n'est alors pas construit du
   * tout, plutôt que rendu puis masqué. Ce n'est PAS un contrôle de sécurité
   * (règle 4) — ce qu'Alexa peut lire est décidé par la RLS.
   */
  readonly avecAlexa?: boolean;
}

export function Topbar({
  titre,
  sousTitre,
  actions,
  avecAlexa = false,
}: TopbarProps): React.JSX.Element {
  return (
    <header
      aria-label={fr.coquille.barreOutils}
      /* ⚠️ LA BARRE RESTE OPAQUE, ET C'EST STRUCTUREL (§4.2). Elle porte des
         NOMS DE PATIENT sur les écrans de personne. La règle « aucun dégradé
         derrière une donnée nominative » ne tient plus par la discipline de
         celui qui écrit l'écran depuis que le héros par page a disparu : elle
         tient parce que CE composant, unique et partagé, est un aplat. Lui
         donner un matériau V8 rouvrirait la brèche que V7 avait fermée. */
      className="topbar-verre flex h-topbar shrink-0 items-center gap-4 border-b border-rule px-4 shadow-douce"
    >
      {/*
        L'identité de page. `truncate` sur le titre ET `min-w-0` sur le bloc :
        « Consultation — M. B. » suivi d'un sous-titre de période doit rétrécir
        avant de pousser la commande et les actions hors de la barre.
      */}
      <div className="flex min-w-0 shrink items-baseline gap-3">
        <h1 className="truncate font-ui text-title font-semibold tracking-title text-ink-900">
          {titre}
        </h1>
        {sousTitre !== undefined && sousTitre !== "" ? (
          <p className="min-w-0 truncate font-ui text-label font-medium tabular-nums text-ink-500">
            {sousTitre}
          </p>
        ) : null}
      </div>


      <div className="ml-auto flex shrink-0 items-center gap-3">
        {actions}
        {/*
          L'orbe RENSEIGNE, il n'ouvre pas : c'est `BulleAlexa` qui ouvre. Deux
          commandes pour la même chose, côte à côte, feraient hésiter sans rien
          ajouter — c'était déjà la règle quand le champ de commande existait.
        */}
        {avecAlexa ? <OrbeVoix taille={28} /> : null}
      </div>
    </header>
  );
}
