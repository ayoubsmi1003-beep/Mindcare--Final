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
 */

"use client";

import { useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
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
      style={{
        border: "var(--rule-width) solid var(--rule)",
        borderRadius: "var(--r-md)",
        background: "var(--card)",
        padding: "var(--s-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s-3)",
      }}
    >
      <h3
        style={{
          margin: "var(--size-0)",
          fontSize: "var(--text-body-size)",
          lineHeight: "var(--text-body-leading)",
          color: "var(--ink-900)",
        }}
      >
        {carte.titre}
      </h3>

      <dl style={{ margin: "var(--size-0)", display: "grid", gap: "var(--s-2)" }}>
        {carte.champs.map((champ) => (
          <div
            key={champ.libelle}
            style={{ display: "flex", justifyContent: "space-between", gap: "var(--s-3)" }}
          >
            <dt
              style={{
                fontSize: "var(--text-label-size)",
                lineHeight: "var(--text-label-leading)",
                letterSpacing: "var(--text-label-tracking)",
                color: "var(--ink-500)",
              }}
            >
              {champ.libelle}
            </dt>
            <dd
              style={{
                margin: "var(--size-0)",
                fontSize: "var(--text-body-size)",
                lineHeight: "var(--text-body-leading)",
                color: "var(--ink-900)",
                textAlign: "right",
              }}
            >
              {champ.valeur}
            </dd>
          </div>
        ))}
      </dl>

      <div style={{ display: "flex", gap: "var(--s-2)", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onAnnuler}
          disabled={enCours}
          style={{
            minHeight: "var(--target-min)",
            padding: "0 var(--s-4)",
            borderRadius: "var(--r-md)",
            border: "var(--rule-width) solid var(--rule)",
            background: "var(--card)",
            color: "var(--ink-700)",
            fontSize: "var(--text-body-size)",
            cursor: enCours ? "default" : "pointer",
          }}
        >
          {fr.jarvis.carte.annuler}
        </button>

        <button
          type="button"
          onClick={onConfirmer}
          disabled={!confirmerActif}
          // `aria-disabled` en plus de `disabled` : un lecteur d'écran annonce
          // alors l'indisponibilité momentanée au lieu de sauter le bouton.
          aria-disabled={!confirmerActif}
          style={{
            minHeight: "var(--target-min)",
            padding: "0 var(--s-4)",
            borderRadius: "var(--r-md)",
            border: "none",
            background: confirmerActif ? "var(--brand-600)" : "var(--ink-100)",
            color: confirmerActif ? "var(--paper)" : "var(--ink-300)",
            fontSize: "var(--text-body-size)",
            cursor: confirmerActif ? "pointer" : "default",
          }}
        >
          {delaiEcoule ? fr.jarvis.carte.confirmer : fr.jarvis.carte.patienter}
        </button>
      </div>
    </section>
  );
}
