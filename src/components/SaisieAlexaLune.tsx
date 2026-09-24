/**
 * La zone de saisie Alexa Lune — 21st.dev moon, gestes MindCare.
 *
 * MÊME CONTRAT que `SaisieJarvis` (écrire + Envoyer, MAINTENIR pour parler,
 * Stop pendant un flux, dictée relue avant envoi, erreur voix nommée) mais
 * géométrie de la référence : textarea auto-extensible en haut, rangée
 * voix-à-gauche / envoi-à-droite en bas, boîte en verre sombre.
 *
 * Séparée de `SaisieJarvis` (panneau 380 px) pour ne pas toucher le panneau :
 * un seul écran consomme ce composant.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import { cn } from "@/lib/utils";
import {
  annulerDictee,
  arreterEtTranscrire,
  demarrerDictee,
  detecterCapacitesVoix,
} from "@/services/jarvis-voix";
import type { EtatConversationPublique } from "@/services/conversation";

import { Icone } from "./ui/Icones";

type PhaseDictee = "inerte" | "ecoute" | "transcription";

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
  const [phase, setPhase] = useState<PhaseDictee>("inerte");
  const [messageVoix, setMessageVoix] = useState<string | null>(null);

  // SSR-sûr : `false` tant que `window` n'existe pas ; l'écart serveur/client
  // ne porte que sur un bouton inerte, jamais sur du contenu.
  const [voixPossible] = useState(() => detecterCapacitesVoix().dicteePossible);

  const fluxEnCours = etat.etat === "envoi" || etat.etat === "flux";
  const bloque =
    fluxEnCours || etat.carteEcriture !== null || phase === "ecoute" || phase === "transcription";

  const demarrer = useCallback(async () => {
    if (phase !== "inerte") return;
    setMessageVoix(null);
    setPhase("ecoute");
    const r = await demarrerDictee();
    if (!r.ok) {
      setPhase("inerte");
      setMessageVoix(r.error.message);
    }
  }, [phase]);

  const relacher = useCallback(async () => {
    if (phase !== "ecoute") return;
    setPhase("transcription");
    const r = await arreterEtTranscrire();
    if (r.ok) {
      const courant = etat.saisie;
      onChangerSaisie(courant === "" ? r.data : `${courant} ${r.data}`.trim());
      textareaRef.current?.focus();
    } else {
      setMessageVoix(r.error.message);
    }
    setPhase("inerte");
  }, [etat.saisie, onChangerSaisie, phase, textareaRef]);

  const annuler = useCallback(() => {
    annulerDictee();
    setPhase("inerte");
  }, []);

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
            if (e.key === "Escape" && phase === "ecoute") annuler();
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
              {/* DICTÉE — presser-pour-parler, même protocole que le panneau. */}
              <button
                type="button"
                {...(phase === "ecoute"
                  ? {
                      onPointerUp: () => void relacher(),
                      onPointerLeave: () => void relacher(),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Escape") annuler();
                      },
                    }
                  : {
                      onPointerDown: () => void demarrer(),
                    })}
                disabled={voixPossible === false || bloque}
                aria-label={phase === "ecoute" ? fr.jarvis.voix.ecoute : fr.jarvis.voix.parler}
                title={
                  voixPossible === false
                    ? fr.jarvis.voix.microIndisponible
                    : phase === "ecoute"
                      ? fr.jarvis.voix.ecoute
                      : fr.jarvis.voix.parler
                }
                aria-pressed={phase === "ecoute"}
                className={cn(
                  "inline-flex min-h-target min-w-0 select-none items-center justify-center rounded-md border px-3 font-ui text-label transition duration-quick ease-soft",
                  phase === "ecoute"
                    ? "lune-alexa-ecoute cursor-pointer border-night-rule text-night-ink"
                    : "cursor-pointer border-night-rule bg-transparent text-night-ink-soft hover:bg-chrome-survol hover:text-night-ink",
                  (voixPossible === false || bloque) && "cursor-not-allowed opacity-disabled",
                )}
              >
                <span className="shrink-0">
                  <Icone nom="audio" taille={16} />
                </span>
                <span className="truncate pl-2">
                  {phase === "ecoute"
                    ? fr.jarvis.voix.ecoute
                    : phase === "transcription"
                      ? fr.jarvis.voix.transcription
                      : fr.jarvis.voix.parler}
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
        <p role="status" className="m-0 font-ui text-label text-attention">
          {messageVoix}
        </p>
      )}
    </div>
  );
}
