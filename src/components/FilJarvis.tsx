/**
 * Le fil de conversation Jarvis — V-JARVIS-CORE.
 *
 * PARTAGÉ par le panneau latéral et l'écran plein `/jarvis` : les mêmes bulles,
 * les mêmes mentions, le même rendu des états. Une seule façon d'afficher une
 * réponse interrompue ou un échec de persistance — deux surfaces qui diraient
 * la même chose autrement seraient deux vérités.
 *
 * ═══ CE COMPOSANT NE DÉCIDE RIEN ═══
 * Il reçoit l'état publié par `services/conversation.ts` et appelle deux gestes
 * (`interrompre`, lecture voix). Aucun service de données ici.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import type { EtatConversationPublique } from "@/services/conversation";
import {
  arreterLecture,
  lireTexte,
} from "@/services/jarvis-voix";

import { Icone } from "./ui/Icones";

export function FilJarvis({
  etat,
  compact = false,
}: {
  readonly etat: EtatConversationPublique;
  /** true dans le panneau : bulles un peu plus denses, pas d'amorce. */
  readonly compact?: boolean;
}): React.JSX.Element {
  const finRef = useRef<HTMLDivElement | null>(null);
  const [lectureId, setLectureId] = useState<string | null>(null);

  // Le fil suit la parole : ancré en bas à chaque tour nouveau ou fragment.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [etat.tours, etat.etat]);

  useEffect(() => arreterLecture, []);

  /**
   * ⚠️ `porteUneIdentite` DÉCIDE DE LA ROUTE DE LA VOIX, et il n'est pas
   * facultatif : quand la réponse nomme un dossier, la synthèse reste LOCALE.
   * Le texte reçu ici est déjà rendu — les jetons ont été remplacés par les
   * vrais noms — donc plus rien dans la chaîne ne permettrait de le deviner.
   * C'est `conversation.ts` qui l'a capturé au moment du rendu.
   */
  const relire = useCallback(async (id: string, texte: string, porteUneIdentite: boolean) => {
    if (lectureId === id) {
      arreterLecture();
      setLectureId(null);
      return;
    }
    setLectureId(id);
    const r = await lireTexte(texte, porteUneIdentite);
    if (!r.ok) setLectureId(null);
  }, [lectureId]);

  const dernierTour = etat.tours[etat.tours.length - 1];
  const fluxEnCours =
    (etat.etat === "envoi" || etat.etat === "flux") &&
    (dernierTour === undefined || dernierTour.role !== "systeme");

  return (
    <div className="flex flex-col gap-3" role="log" aria-live="polite" aria-label={fr.jarvis.titre}>
      {etat.tours.length === 0 && !fluxEnCours && (
        <div className="grid justify-items-center gap-4 px-4 py-10 text-center">
          <span aria-hidden className="inline-flex h-16 w-16 rounded-full bg-grad-orb shadow-glow-ai" />
          <p className="m-0 font-ui text-body text-ink-700" style={{ maxWidth: "28ch" }}>
            {fr.jarvis.invite}
          </p>
          {!compact && (
            <ul className="mt-1 flex list-none flex-wrap justify-center gap-2 p-0">
              {[fr.jarvis.amorce1, fr.jarvis.amorce2, fr.jarvis.amorce3].map((amorce) => (
                <li key={amorce}>{amorce}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {etat.tours.map((tour) => {
        if (tour.role === "humain") {
          return (
            <div key={tour.id} className="flex justify-end">
              <p
                className="m-0 whitespace-pre-wrap rounded-lg rounded-br-sm bg-action-600 px-4 py-3 font-ui text-body text-paper shadow-lift1"
                style={{ maxWidth: compact ? "var(--bulle-humain-max)" : "42rem" }}
              >
                {tour.texte}
              </p>
            </div>
          );
        }

        if (tour.role === "systeme") {
          return (
            <p
              key={tour.id}
              className="m-0 whitespace-pre-wrap px-2 text-center font-ui text-label italic text-ink-500"
            >
              {tour.texte}
            </p>
          );
        }

        // ── Bulle Jarvis ──
        const enLecture = lectureId === tour.id;
        const lisible = tour.texte.trim().length > 0 && tour.texte.trim().length <= 2000;
        return (
          <div key={tour.id} className="flex flex-col gap-1">
            {tour.registre === "connaissance-generale" && (
              <span className="inline-flex items-center gap-1 pl-1 font-ui text-label tracking-label text-ai-600">
                <Icone nom="jarvis" taille={16} />
                {fr.jarvis.registreConnaissance}
              </span>
            )}
            <div className="flex items-end gap-1">
              <p
                className={[
                  "m-0 whitespace-pre-wrap rounded-lg rounded-tl-sm border border-rule bg-card px-4 py-3 font-ui text-body text-ink-900 shadow-lift1",
                  tour.texte === "" ? "hidden" : "",
                ].join(" ")}
                style={{ maxWidth: compact ? "var(--bulle-jarvis-max)" : "46rem" }}
              >
                {tour.texte}
                {tour.interrompu === true && (
                  <span className="ml-2 font-ui text-label italic text-ink-500">
                    {fr.jarvis.flux.interrompue}
                  </span>
                )}
              </p>
              {/* Lecture vocale PAR BULLE — geste explicite, un seul son. */}
              {lisible && (
                <button
                  type="button"
                  onClick={() => void relire(tour.id, tour.texte, tour.porteUneIdentite === true)}
                  aria-label={enLecture ? fr.jarvis.flux.stopLecture : fr.jarvis.flux.relire}
                  title={enLecture ? fr.jarvis.flux.stopLecture : fr.jarvis.flux.relire}
                  aria-pressed={enLecture}
                  className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-500 transition duration-quick ease-soft hover:bg-sunken hover:text-ink-900"
                >
                  <Icone nom={enLecture ? "croix" : "audio"} taille={16} />
                </button>
              )}
            </div>
              {/* La porte a refusé l'écriture : dit UNE fois, sous la bulle. */}
            {tour.persiste === false && (
              <p className="m-0 pl-1 font-ui text-label text-attention-ink">
                {fr.jarvis.flux.nonPersistee}
              </p>
            )}
          </div>
        );
      })}

      {fluxEnCours && (
        /* Trois points qui respirent — §4 règle 5 : opacité seule, rien ne bouge. */
        <div role="status" className="flex flex-col gap-1">
          <span className="sr-only">{fr.jarvis.reflechit}</span>
          <span
            aria-hidden="true"
            className="inline-flex w-20 items-center justify-center gap-1 rounded-lg rounded-tl-sm border border-rule bg-card px-4 py-3 shadow-lift1"
          >
            <span className="h-2 w-2 animate-respire rounded-full bg-ai-500" />
            <span className="h-2 w-2 animate-respire rounded-full bg-ai-500" />
            <span className="h-2 w-2 animate-respire rounded-full bg-ai-500" />
          </span>
        </div>
      )}

      <div ref={finRef} />
    </div>
  );
}
