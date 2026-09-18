/**
 * `CarteConfirmation` — ce que l'humaine lit AVANT qu'une écriture n'ait lieu.
 * `SPRINT-V1.md` §V2.5.
 *
 * ⚠️ LES 400 ms NE SONT PAS UNE ANIMATION, ET NE PROTÈGENT RIEN.
 * Ils empêchent le clic réflexe — la main qui valide avant que l'œil n'ait lu.
 * C'est une mesure d'ERGONOMIE DE SÉCURITÉ, pas une mesure de sécurité : un
 * appelant qui court-circuite ce composant écrit quand même. Ce qui empêche
 * réellement l'écriture non confirmée est la porte `execute_jarvis_action` de
 * 033, qui lève si `confirmed_at` est nul — vérifié sur base jetable (C7).
 * Confondre les deux conduirait un jour à supprimer le délai « puisque c'est
 * la base qui protège », ou pire, à retirer le contrôle en base « puisqu'il y
 * a le délai ».
 *
 * CHAQUE CHAMP EST AFFICHÉ, RIEN N'EST IMPLICITE. Un champ que la carte ne
 * montre pas est un champ que la praticienne n'a pas validé, et qui partira
 * pourtant en base.
 *
 * v9 — LA SURFACE IA. La carte prend le niveau `ia` (le violet ne désigne
 * que Jarvis et l'analyse) : pastille d'état, titre, champs en tableau net,
 * puis les DEUX gestes. Le bouton de confirmation reprend la hiérarchie des
 * boutons du produit — pendant l'anti-réflexe, il est gris et dit
 * « patienter » : un bouton désactivé qui ne dit pas pourquoi apprend que
 * l'interface ment.
 */

"use client";

import { useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import { SiriOrb } from "./ui/siri-orb";
import { Bouton } from "./ui/Bouton";
import type { CarteConfirmation as DonneesCarte } from "@/services/jarvis-tools";

/** Anti-clic réflexe. Le chiffre vient de `SPRINT-V1.md` §V2.5, pas d'un ressenti. */
const DELAI_ANTI_REFLEXE_MS = 400;

export interface CarteConfirmationProps {
  readonly carte: DonneesCarte;
  readonly onConfirmer: () => void;
  readonly onAnnuler: () => void;
  /** Vrai pendant l'aller-retour confirm → execute. Les deux boutons se figent. */
  readonly enCours: boolean;
}

export function CarteConfirmation({
  carte,
  onConfirmer,
  onAnnuler,
  enCours,
}: CarteConfirmationProps): React.JSX.Element {
  const [delaiEcoule, setDelaiEcoule] = useState(false);

  useEffect(() => {
    // Le délai repart à ZÉRO à chaque nouvelle carte : `carte.actionId` en
    // dépendance. Sans lui, une seconde proposition affichée pendant que la
    // première a déjà purgé son minuteur aurait son bouton actif d'emblée —
    // exactement le clic réflexe qu'on prétend empêcher.
    setDelaiEcoule(false);
    const minuteur = setTimeout(() => setDelaiEcoule(true), DELAI_ANTI_REFLEXE_MS);
    return () => clearTimeout(minuteur);
  }, [carte.actionId]);

  const confirmerActif = delaiEcoule && !enCours;

  return (
    <section
      aria-label={carte.titre}
      className="flex flex-col gap-3 rounded-lg border border-ai-100 bg-ai-50 p-4 shadow-lift1"
    >
      <div className="flex items-center gap-3">
        {/* La pastille d'identité : c'est Jarvis qui PROPOSE, et la carte le
            dit avant le titre. Le violet ne désigne jamais un état clinique —
            il désigne exactement ceci. */}
        <span
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ai-100 bg-card shadow-lift1"
        >
          <SiriOrb
            size="32px"
            animationDuration={18}
          />
        </span>
        <h3 className="m-0 min-w-0 font-ui text-body font-semibold text-ink-900">
          {carte.titre}
        </h3>
      </div>

      {/* CHAQUE CHAMP, SANS EXCEPTION — ce qui n'est pas montré n'est pas
          validé. Le libellé à gauche en encre secondaire, la valeur à droite
          en encre pleine : un tableau de vérification, pas une fiche. */}
      <dl className="m-0 grid gap-2 rounded-md border border-ai-100 bg-card px-3 py-3">
        {carte.champs.map((champ) => (
          <div
            key={champ.libelle}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="font-ui text-label tracking-label text-ink-500">
              {champ.libelle}
            </dt>
            <dd className="m-0 text-right font-ui text-body tabular-nums text-ink-900 break-words">
              {champ.valeur}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex justify-end gap-2">
        <Bouton type="button" rang="secondaire" taille="compact" onClick={onAnnuler} disabled={enCours}>
          {fr.jarvis.carte.annuler}
        </Bouton>

        <Bouton
          type="button"
          rang="principal"
          taille="compact"
          onClick={onConfirmer}
          disabled={!confirmerActif}
          chargement={enCours}
        >
          {delaiEcoule ? fr.jarvis.carte.confirmer : fr.jarvis.carte.patienter}
        </Bouton>
      </div>
    </section>
  );
}
