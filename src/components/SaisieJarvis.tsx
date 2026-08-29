/**
 * La zone de saisie Jarvis — V-JARVIS-CORE.
 *
 * PARTAGEE par le panneau et l'ecran plein. Trois gestes, jamais plus :
 *  - ecrire + Envoyer ;
 *  - MAINTENIR pour parler : le micro ne s'allume que sous le doigt, il
 *    s'eteint au relachement et la transcription atterrit dans le champ,
 *    ou elle est RELUE avant envoi (jamais d'envoi vocal direct) ;
 *  - Arreter un flux en cours.
 *
 * LA DICTEE N'ENVOIE RIEN ELLE-MEME. Le texte transcrit passe par la meme
 * relecture humaine qu'une frappe clavier — c'est ce qui rend la voix un
 * peripherique de saisie, pas une voie d'ecriture parallele.
 *
 * Les erreurs voix s'affichent ICI, en une ligne nommee — jamais `alert()`,
 * jamais un message du serveur relaye brut.
 */

"use client";

import { useCallback, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  annulerDictee,
  arreterEtTranscrire,
  demarrerDictee,
  detecterCapacitesVoix,
} from "@/services/jarvis-voix";
import type { EtatConversationPublique } from "@/services/conversation";

import { Icone } from "./ui/Icones";

type PhaseDictee = "inerte" | "ecoute" | "transcription";

export function SaisieJarvis({
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
  const champRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<PhaseDictee>("inerte");
  const [messageVoix, setMessageVoix] = useState<string | null>(null);

  // SSR-sur : la fonction rend false tant que `window` n'existe pas ; l'ecart
  // serveur/client ne porte que sur un bouton inerte, jamais sur du contenu.
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
      champRef.current?.focus();
    } else {
      setMessageVoix(r.error.message);
    }
    setPhase("inerte");
  }, [etat.saisie, onChangerSaisie, phase]);

  const annuler = useCallback(() => {
    annulerDictee();
    setPhase("inerte");
  }, []);

  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <input
          ref={champRef}
          value={etat.saisie}
          onChange={(e) => onChangerSaisie(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !bloque && etat.saisie.trim() !== "") onEnvoyer();
          }}
          disabled={bloque}
          placeholder={fr.jarvis.invite}
          aria-label={fr.jarvis.invite}
          className="min-h-target min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-2 font-ui text-body text-ink-900 outline-none transition duration-quick ease-soft placeholder:text-ink-300 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-disabled"
        />

        {fluxEnCours ? (
          /* STOP — visible SEULEMENT pendant un flux ; il remplace le bouton
             d'envoi plutot que de lui disputer la meme place. */
          <button
            type="button"
            onClick={onInterrompre}
            aria-label={fr.jarvis.flux.stop}
            title={fr.jarvis.flux.stop}
            className="inline-flex min-h-target shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-rule bg-card px-3 text-ink-900 shadow-lift1 transition duration-quick ease-soft hover:bg-sunken"
          >
            <Icone nom="croix" taille={16} />
            <span className="font-ui text-label">{fr.jarvis.flux.stop}</span>
          </button>
        ) : (
          <>
            {/* DICTEE — presser-pour-parler. Inerte NOMMEE si le navigateur
                n'a pas l'API : un bouton qui n'ecoute pas apprend que les
                commandes mentent ; ici il dit pourquoi il n'ecoute pas. */}
            <button
              type="button"
              {...(phase === "ecoute"
                ? {
                    onPointerUp: () => void relacher(),
                    onPointerLeave: () => void relacher(),
                    onKeyDown: (e) => {
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
              className={[
                "inline-flex min-h-target shrink-0 select-none items-center justify-center rounded-md border px-3 font-ui text-label transition duration-quick ease-soft",
                phase === "ecoute"
                  ? "cursor-pointer border-ai-500 bg-ai-50 text-ai-600"
                  : "cursor-pointer border-rule bg-paper text-ink-700 hover:bg-sunken",
                voixPossible === false || bloque
                  ? "cursor-not-allowed bg-sunken text-ink-500 opacity-disabled"
                  : "",
              ].join(" ")}
            >
              <Icone nom="audio" taille={16} />
              <span className="pl-2">
                {phase === "ecoute" ? fr.jarvis.voix.ecoute : fr.jarvis.voix.parler}
              </span>
            </button>

            {/* L'ENVOI — la pastille pleine de marque, l'unique bouton colore. */}
            <button
              type="button"
              onClick={onEnvoyer}
              disabled={bloque || etat.saisie.trim() === ""}
              aria-label={fr.jarvis.envoyer}
              title={fr.jarvis.envoyer}
              className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-action-600 text-paper shadow-lift1 transition duration-quick ease-soft hover:bg-action-700 hover:shadow-lift2 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-500 disabled:shadow-none"
            >
              <Icone nom="fleche" taille={20} />
            </button>
          </>
        )}
      </div>

      {/* L'erreur voix vit ici, une ligne, sans masquer la saisie — le clavier
          reste utilisable pendant qu'elle est affichee. */}
      {messageVoix !== null && (
        <p role="status" className="m-0 font-ui text-label text-attention-ink">
          {messageVoix}
        </p>
      )}

      {/* MENTION PERMANENTE — ADR-023, garde-fou 3. Elle ne se masque pas. */}
      <p className="m-0 font-ui text-label text-ink-500">{fr.disclaimer}</p>
    </div>
  );
}
