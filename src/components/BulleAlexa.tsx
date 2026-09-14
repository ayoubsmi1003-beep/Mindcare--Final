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
 * ⚠️ ELLE NE DOIT RECOUVRIR AUCUNE COMMANDE. `BarreActions` (« Signer la
 * note », « Terminer la séance ») vit en bas de la colonne de contenu, qui est
 * centrée et plafonnée à `max-w-main` ; la bulle est ancrée au bord droit de la
 * fenêtre. Aux largeurs de travail (≥ 1280 px) les deux ne se rencontrent pas.
 * En dessous, `bottom-24` la remonte au-dessus de la barre d'actions plutôt que
 * de parier sur la marge.
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
      className={[
        "group fixed bottom-24 right-6 z-panneau desktop:bottom-8",
        "flex h-14 w-14 items-center justify-center rounded-full",
        "border border-ai-100 bg-card shadow-elevee",
        "transition duration-quick ease-out",
        "hover:scale-105 hover:shadow-glow-ai",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600",
        // `motion-reduce` : l'agrandissement au survol est un confort, pas une
        // information. Qui demande moins de mouvement n'en perd aucune.
        "motion-reduce:transition-none motion-reduce:hover:scale-100",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full"
      >
        {/* Même orbe que le panneau qu'elle ouvre : on reconnaît où l'on va
            avant de cliquer, exactement comme le faisait la pastille de V8. */}
        <SiriOrb
          size="40px"
          animationDuration={22}
          colors={{
            bg: "oklch(98% 0.01 264.695)",
            c1: "oklch(72% 0.16 350)",
            c2: "oklch(76% 0.14 200)",
            c3: "oklch(75% 0.15 280)",
          }}
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
