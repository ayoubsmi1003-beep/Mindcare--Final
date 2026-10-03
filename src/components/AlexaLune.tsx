/**
 * Alexa Lune — le héros et les pastilles de l'écran `/jarvis`.
 *
 * Contenu 100 % MindCare (`fr.jarvis`), contenant visuel 21st.dev : titre
 * centré, pastilles rondes sombres en deux rangées. Chaque pastille REMPLIT
 * le champ (geste réel, éditable avant envoi) — jamais d'exécution directe.
 */

"use client";

import { useEffect, useState } from "react";
import { abonnerVoixLocale, basculerVoixLocale } from "@/services/alexa-local";
import type { VueVoix } from "@/services/jarvis-reveil";
import { alexa } from "@/i18n/alexa";
import { fr } from "@/i18n/fr";
import type { EtatConversationPublique } from "@/services/conversation";

import { SiriOrb } from "./ui/siri-orb";
import { Icone, type NomIcone } from "./ui/Icones";

export function HeroAlexaLune({ etat }: { readonly etat: EtatConversationPublique }): React.JSX.Element {
  const [voix, setVoix] = useState<VueVoix | null>(null);
  useEffect(() => abonnerVoixLocale(setVoix), []);
  const actif = voix !== null && voix.etat !== "desactive" && voix.etat !== "erreur";
  return (
    <div className="animate-fondu-monte flex flex-col items-center px-4 text-center motion-reduce:animate-none">
      {/* L'orbe mène l'état vide à pleine force : c'est le pic de l'écran,
          pas un pictogramme — le titre `text-display` suit, les pastilles se
          taisent autour. */}
      <button type="button" onClick={basculerVoixLocale} aria-label={actif ? alexa.voixArreter : alexa.voixDemarrer}
        aria-pressed={actif} disabled={etat.carteEcriture !== null && !actif}
        className="inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-full border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-action-600">
        <SiriOrb
          size="112px"
          etat={actif ? voix.etat === "parole" ? "parole" : voix.etat === "ecoute" ? "ecoute" : "traitement"
            : etat.carteEcriture !== null ? "ecoute" : etat.etat === "envoi" || etat.etat === "flux" ? "traitement" : "idle"}
        />
      </button>
      <h2 className="m-0 mt-4 font-ui text-display font-semibold tracking-display text-night-ink">
        {fr.jarvis.titre}
      </h2>
      <p className="m-0 mt-2 font-ui text-body text-night-ink-soft">{fr.jarvis.invite}</p>
    </div>
  );
}

interface Pastille {
  readonly texte: string;
  readonly icone: NomIcone;
}

const PASTILLES: readonly Pastille[] = [
  { texte: fr.jarvis.amorce1, icone: "horloge" },
  { texte: fr.jarvis.amorce2, icone: "chevron" },
  { texte: fr.jarvis.amorce3, icone: "recherche" },
  { texte: fr.jarvis.amorce4, icone: "agenda" },
  { texte: fr.jarvis.amorce5, icone: "finances" },
  { texte: fr.jarvis.amorce6, icone: "patients" },
  { texte: fr.jarvis.amorce7, icone: "documents" },
  { texte: fr.jarvis.amorce8, icone: "jarvis" },
];

export function PastillesAlexaLune({
  onChoisir,
}: {
  readonly onChoisir: (amorce: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {PASTILLES.map((pastille) => (
        <button
          key={pastille.texte}
          type="button"
          onClick={() => onChoisir(pastille.texte)}
          className="inline-flex min-h-target max-w-full shrink-0 cursor-pointer items-center gap-2 rounded-full border border-night-rule bg-night-card px-4 py-2 font-ui text-label text-night-ink-soft transition duration-quick ease-soft hover:bg-chrome-survol hover:text-night-ink"
        >
          <Icone nom={pastille.icone} taille={16} />
          {/* `truncate` plutôt que `nowrap` : sur écran étroit la pastille
              longue dépassait du conteneur au lieu de s'y replier — le clic
              remplit toujours l'amorce entière, seul l'affichage s'ellipse. */}
          <span className="min-w-0 truncate">{pastille.texte}</span>
        </button>
      ))}
    </div>
  );
}
