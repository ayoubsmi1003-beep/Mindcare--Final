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
 * LE CHAMP DE COMMANDE EST ALEXA, ET C'EST DÉLIBÉRÉ.
 * Le lanceur de l'assistant était une pastille flottante en bas à droite —
 * le motif « bulle de chat » exact, celui qui fait lire une intelligence
 * intégrée comme un widget collé après coup. Ici, l'assistant EST la barre de
 * commande : on lui parle là où on chercherait, au centre de l'outil. La même
 * touche ⌘K ouvre la même chose ; ce qui change, c'est ce que la disposition
 * raconte — l'assistant appartient à l'instrument, il n'est pas posé dessus.
 */

"use client";

import { fr } from "@/i18n/fr";

import { OrbeVoix } from "../OrbeVoix";
import { Icone } from "../ui/Icones";

export interface TopbarProps {
  /** L'identité de l'écran. Jamais un nom de patient sur un écran de lieu. */
  readonly titre: string;
  /** Précision facultative — période, comptage, contexte. Une ligne. */
  readonly sousTitre?: string;
  /** Actions de page, alignées à droite. Une action dominante au plus. */
  readonly actions?: React.ReactNode;
  /**
   * Ouvre l'assistant. Absent pour l'assistante : le champ de commande n'est
   * alors pas construit du tout, plutôt que rendu puis désactivé.
   */
  readonly onOuvrirCommande?: (() => void) | undefined;
}

export function Topbar({
  titre,
  sousTitre,
  actions,
  onOuvrirCommande,
}: TopbarProps): React.JSX.Element {
  return (
    <header
      aria-label={fr.coquille.barreOutils}
      className="flex h-topbar shrink-0 items-center gap-6 border-b border-rule bg-card px-6"
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
          <p className="hidden truncate font-ui text-body font-regular text-ink-500 tablet:block">
            {sousTitre}
          </p>
        ) : null}
      </div>

      {onOuvrirCommande !== undefined ? (
        <button
          type="button"
          onClick={onOuvrirCommande}
          className="group ml-auto flex min-h-target w-full max-w-context shrink items-center gap-3 rounded-lg border border-rule bg-sunken px-3 py-2 text-left font-ui text-body font-regular text-ink-500 transition duration-quick ease-out hover:border-ink-300 hover:bg-card focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
        >
          <Icone nom="jarvis" taille={16} />
          {/*
            ⚠️ LE LIBELLÉ DIT « ALEXA », PAS « RECHERCHER », ET C'EST UNE CORRECTION.
            La première version affichait « Rechercher un patient, un rendez-vous,
            un document… » — vu à l'écran, l'écran Patients portait alors DEUX
            champs de recherche superposés, et l'écran Documents TROIS. Le champ
            de la barre n'est pas une recherche : il ouvre l'assistant, qui
            propose et attend une confirmation. Le nommer « rechercher »
            promettait une autre mécanique que celle qui s'ouvre.
          */}
          <span className="min-w-0 flex-1 truncate desktop:hidden">
            {fr.coquille.commandeCourt}
          </span>
          <span className="hidden min-w-0 flex-1 truncate desktop:block">
            {fr.coquille.commande}
          </span>
          <kbd className="shrink-0 rounded-md border border-rule bg-card px-1.5 py-0.5 font-num text-label font-medium tabular-nums text-ink-500">
            {fr.coquille.raccourci}
          </kbd>
        </button>
      ) : null}

      <div
        className={[
          "flex shrink-0 items-center gap-3",
          onOuvrirCommande === undefined ? "ml-auto" : "",
        ].join(" ")}
      >
        {actions}
        {/*
          L'orbe reste le témoin d'état de la voix (huit états, cf. OrbeVoix) et
          non un second bouton d'ouverture : le champ de commande ouvre, l'orbe
          RENSEIGNE. Deux commandes pour la même chose, côte à côte, feraient
          hésiter sans rien ajouter.
        */}
        {onOuvrirCommande !== undefined ? <OrbeVoix taille={28} /> : null}
      </div>
    </header>
  );
}
