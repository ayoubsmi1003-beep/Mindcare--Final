/**
 * Le lanceur d'Alexa — flottant, en bas à droite.
 *
 * ⚠️ CE COMPOSANT REVIENT SUR UNE DÉCISION DE V7, ET C'EST ASSUMÉ. V7 avait
 * retiré la bulle flottante au motif qu'elle était « posée sur » l'instrument
 * plutôt que d'y appartenir, et l'avait remplacée par le champ de commande de
 * la barre supérieure. Arbitrage praticienne du 2026-09-08 : la bulle revient,
 * et le champ de commande s'en va — un seul lanceur, pas deux.
 *
 * ⚠️ CE QUE V7 N'AVAIT PAS VU, ET QUI TRANCHE LA QUESTION. `AppShell` ne rend
 * PAS la barre supérieure en mode séance (`modeSeance ? null : <Topbar…>`).
 * Le lanceur unique de V7 disparaissait donc exactement là où l'assistante est
 * la plus utile : pendant une consultation, un patient en face. Il ne restait
 * que `⌘K`, un raccourci que rien n'annonce à l'écran. La bulle, elle, ne
 * dépend d'aucune barre.
 *
 * `⌘K` reste, inchangé, dans `PanneauJarvis` : ce composant ajoute une porte
 * visible, il n'en retire aucune.
 *
 * ⚠️ ELLE NE DOIT RECOUVRIR AUCUNE COMMANDE. La barre de consultation est
 * collante en bas de fenêtre (`sticky bottom-4`, ~110 px à deux rangées) :
 * `bottom-32` (128 px) la fait flotter au-dessus sur tous les écrans, au
 * lieu de parier sur la marge. Mesuré consultation, 2026-09-14 : à `bottom-24`
 * l'orbe recouvrait « Enregistrer ».
 */

"use client";

import { useEffect, useState } from "react";

import { SiriOrb } from "./ui/siri-orb";
import { fr } from "@/i18n/fr";
import { abonnerConversation } from "@/services/conversation";

export function BulleAlexa({
  ouvert,
  onOuvrir,
}: {
  readonly ouvert: boolean;
  readonly onOuvrir: () => void;
}): React.JSX.Element | null {
  /**
   * ⚠️ UNE PROPOSITION D'ÉCRITURE EN ATTENTE DOIT SE VOIR DEPUIS DEHORS.
   *
   * Alexa ne fait que proposer : une écriture attend une décision humaine
   * (règle 7). Tant que le panneau était ouvert par un champ TOUJOURS visible
   * dans la barre, une carte en attente restait à un clic annoncé. La bulle,
   * elle, est muette par nature — et une proposition oubliée derrière un
   * lanceur silencieux, c'est une décision clinique qui n'est jamais prise.
   *
   * On ne montre donc PAS le contenu de la proposition — le lanceur n'est pas
   * une surface de donnée patient — seulement qu'il y en a une.
   */
  const [enAttente, setEnAttente] = useState(false);
  useEffect(() => abonnerConversation((e) => setEnAttente(e.carteEcriture !== null)), []);
  /**
   * Panneau ouvert : plus de bulle. Le panneau occupe déjà le bord droit, et
   * un lanceur qui flotte PAR-DESSUS ce qu'il vient d'ouvrir n'ouvre plus
   * rien — il masque. La fermeture se fait par le panneau ou par Échap.
   */
  if (ouvert) return null;

  return (
    <button
      type="button"
      onClick={onOuvrir}
      aria-expanded={false}
      aria-label={enAttente ? fr.jarvis.bulleEnAttente : fr.jarvis.bulleOuvrir}
      title={enAttente ? fr.jarvis.bulleEnAttente : fr.jarvis.bulleOuvrir}
      className={[
        "group fixed bottom-6 right-5 z-panneau",
        // L'orbe EST le bouton : sphère émeraude + halo pulsant + anneau menthe.
        // 56px tactiles, transparence totale autour, un seul launcher canonique.
        "bulle-alexa-ombre flex h-14 w-14 items-center justify-center rounded-full bg-transparent",
        "ring-1 ring-rule transition duration-quick ease-out",
        "hover:scale-105 hover:ring-action-600",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600",
        "motion-reduce:transition-none motion-reduce:hover:scale-100",
      ].join(" ")}
    >
      {/* Halo pulsant derrière l'orbe — décor pur, jamais d'info. */}
      <span
        aria-hidden="true"
        data-etat={enAttente ? "ecoute" : "idle"}
        className="halo-alexa pointer-events-none absolute -inset-2 animate-halo-pulse rounded-full motion-reduce:animate-none"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none relative inline-flex h-14 w-14 animate-flottement-doux items-center justify-center overflow-hidden rounded-full motion-reduce:animate-none"
      >
        {/* Même orbe que le panneau qu'elle ouvre : on reconnaît où l'on va
            avant de cliquer. Palette émeraude, état idle/ecoute. */}
        <SiriOrb
          size="56px"
          etat={enAttente ? "ecoute" : "idle"}
        />
      </span>

      {/* La pastille d'attente : `--attention`, jamais `--critical`. Le rouge
          est un budget réservé à la perte de données ; une proposition qui
          attend n'est pas une urgence, c'est un rendez-vous non tenu. */}
      {enAttente ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-attention"
        />
      ) : null}
    </button>
  );
}
