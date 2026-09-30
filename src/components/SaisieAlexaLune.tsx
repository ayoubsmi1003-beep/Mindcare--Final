/**
 * La zone de saisie Alexa Lune — 21st.dev moon, gestes MindCare.
 *
 * MÊME CONTRAT que `SaisieJarvis` (texte confirmé et voix Live en lecture seule) mais
 * géométrie de la référence : textarea auto-extensible en haut, rangée
 * voix-à-gauche / envoi-à-droite en bas, boîte en verre sombre.
 *
 * Séparée de `SaisieJarvis` (panneau 380 px) pour ne pas toucher le panneau :
 * un seul écran consomme ce composant.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import { alexaLive } from "@/i18n/alexa-live";
import { cn } from "@/lib/utils";
import { abonnerLive, basculerLive, arreterLive } from "@/services/alexa-live";
import type { VueVoix } from "@/services/jarvis-reveil";
import type { EtatConversationPublique } from "@/services/conversation";

import { Icone } from "./ui/Icones";

interface AutoResizeOptions {
  readonly minHeight: number;
  readonly maxHeight?: number;
}

/** Redimensionne le textarea entre `minHeight` et `maxHeight` (référence). */
function useAutoResizeTextarea({ minHeight, maxHeight }: AutoResizeOptions): {
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly adjustHeight: (reset?: boolean) => void;
} {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      if (reset) {
        textarea.style.height = `${String(minHeight)}px`;
        return;
      }

      textarea.style.height = `${String(minHeight)}px`;
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Infinity),
      );
      textarea.style.height = `${String(newHeight)}px`;
    },
    [minHeight, maxHeight],
  );

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = `${String(minHeight)}px`;
  }, [minHeight]);

  return { textareaRef, adjustHeight };
}

export function SaisieAlexaLune({
  etat,
  onEnvoyer,
  onChangerSaisie,
  onInterrompre,
}: {
  readonly etat: EtatConversationPublique;
  readonly onEnvoyer: () => void;
  readonly onChangerSaisie: (valeur: string) => void;
  readonly onInterrompre: () => void;
}): React.JSX.Element {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight: 48,
    maxHeight: 150,
  });
  const [voix, setVoix] = useState<VueVoix | null>(null);
  useEffect(() => abonnerLive(setVoix), []);
  const actif = voix !== null && voix.etat !== "desactive" && voix.etat !== "erreur";
  const messageVoix = actif || voix?.etat === "erreur" ? voix?.raison ?? null : null;
  const libelleVoix = actif ? alexaLive.arreter : alexaLive.disponible;

  const fluxEnCours = etat.etat === "envoi" || etat.etat === "flux";
  const bloque = fluxEnCours || etat.carteEcriture !== null || actif;

  // Une amorce remplit le champ depuis le parent : la hauteur suit.
  useEffect(() => {
    adjustHeight();
  }, [etat.saisie, adjustHeight]);

  return (
    <div className="grid min-w-0 gap-2">
      <div className="lune-alexa-boite min-w-0 rounded-xl">
        <textarea
          ref={textareaRef}
          value={etat.saisie}
          onChange={(e) => {
            onChangerSaisie(e.target.value);
            adjustHeight();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !bloque && etat.saisie.trim() !== "") {
              e.preventDefault();
              onEnvoyer();
            }
            if (e.key === "Escape" && actif) arreterLive();
          }}
          disabled={bloque}
          placeholder={fr.jarvis.invite}
          aria-label={fr.jarvis.invite}
          rows={1}
          className={cn(
            "w-full resize-none border-0 bg-transparent px-4 py-3",
            "font-ui text-body text-night-ink outline-none",
            "placeholder:text-night-ink-soft",
            "disabled:cursor-not-allowed disabled:opacity-disabled",
          )}
          style={{ overflow: "hidden" }}
        />

        <div className="flex items-center justify-between p-3">
          {fluxEnCours ? (
            /* STOP — visible SEULEMENT pendant un flux, à la place de l'envoi. */
            <span className="flex w-full justify-end">
              <button
                type="button"
                onClick={onInterrompre}
                aria-label={fr.jarvis.flux.stop}
                title={fr.jarvis.flux.stop}
                className="inline-flex min-h-target shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-night-rule px-3 text-night-ink transition duration-quick ease-soft hover:bg-chrome-survol"
              >
                <Icone nom="croix" taille={16} />
                <span className="font-ui text-label">{fr.jarvis.flux.stop}</span>
              </button>
            </span>
          ) : (
            <>
              {/* Continuous Live session, identical to the side panel. */}
              <button
                type="button"
                onClick={basculerLive}
                disabled={etat.carteEcriture !== null && !actif}
                aria-label={libelleVoix}
                title={voix?.raison ?? libelleVoix}
                aria-pressed={actif}
                className={cn(
                  "inline-flex min-h-target min-w-0 select-none items-center justify-center rounded-md border px-3 font-ui text-label transition duration-quick ease-soft",
                  actif
                    ? "lune-alexa-ecoute cursor-pointer border-night-rule text-night-ink"
                    : "cursor-pointer border-night-rule bg-transparent text-night-ink-soft hover:bg-chrome-survol hover:text-night-ink",
                  etat.carteEcriture !== null && !actif && "cursor-not-allowed opacity-disabled",
                )}
              >
                <span className="shrink-0">
                  <Icone nom="audio" taille={16} />
                </span>
                <span className="truncate pl-2">
                  {libelleVoix}
                </span>
              </button>

              {/* L'ENVOI — géométrie de la référence, émeraude quand actif. */}
              <button
                type="button"
                onClick={onEnvoyer}
                disabled={bloque || etat.saisie.trim() === ""}
                aria-label={fr.jarvis.envoyer}
                title={fr.jarvis.envoyer}
                className={cn(
                  "inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-md transition duration-quick ease-soft",
                  bloque || etat.saisie.trim() === ""
                    ? "cursor-not-allowed bg-chrome-voile text-night-ink-soft opacity-disabled"
                    : "bg-action-600 text-paper shadow-lift1 hover:bg-action-700",
                )}
              >
                <Icone nom="fleche" taille={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* L'erreur voix vit ici, une ligne — le clavier reste utilisable. */}
      {messageVoix !== null && (
        <p role="status" className={`m-0 font-ui text-label ${voix?.etat === "erreur" ? "text-attention" : "text-night-ink-soft"}`}>
          {messageVoix}
        </p>
      )}
    </div>
  );
}
