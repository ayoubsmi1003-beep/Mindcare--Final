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

import { AvatarAlexa } from "@/components/ui/avatar-alexa";
import {AlexaAnswerText} from './AlexaAnswerText';
import { agentCopy } from "@/i18n/alexa-agent";
import { alexa } from "@/i18n/alexa";
import { fr } from "@/i18n/fr";
import Link from "next/link";
import type { EtatConversationPublique } from "@/services/conversation";
import {
  definirPreferenceLectureAuto,
  fautLireAuto,
  lirePreferenceLectureAuto,
} from "@/services/lecture-auto";
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
  // Lecture automatique GLOBALE (spec voix 2026-10-24 §2.4) : défaut ON,
  // préférence persistée en localStorage (pas clinique), chaînes alexa.ts.
  const [lectureAuto, setLectureAuto] = useState<boolean>(() => lirePreferenceLectureAuto());
  // Tours déjà vus (jamais relus) : l'historique chargé n'est jamais lu.
  const lusRef = useRef<Set<string>>(new Set());
  const chargeRef = useRef(false);

  // Le fil suit la parole : ancré en bas à chaque tour nouveau ou fragment.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [etat.tours, etat.etat]);

  useEffect(() => arreterLecture, []);

  const basculerLectureAuto = useCallback(() => {
    arreterLecture();
    setLectureId(null);
    setLectureAuto((prev) => {
      definirPreferenceLectureAuto(!prev);
      return !prev;
    });
  }, []);

  // Toute nouvelle demande coupe la lecture en cours (spec §2.4).
  const fluxEnCoursAvantLecture =
    (etat.etat === "envoi" || etat.etat === "flux");
  useEffect(() => {
    if (fluxEnCoursAvantLecture) {
      arreterLecture();
      setLectureId(null);
    }
  }, [fluxEnCoursAvantLecture]);

  // L'historique chargé n'est jamais lu : on scelle les tours vus avant la
  // fin du chargement, seules les réponses arrivées après sont candidates.
  useEffect(() => {
    if (etat.chargementHistorique || chargeRef.current) return;
    chargeRef.current = true;
    for (const tour of etat.tours) lusRef.current.add(tour.id);
  }, [etat.chargementHistorique, etat.tours]);

  // Lecture automatique du dernier tour Jarvis — corps de réponse seul.
  // Kokoro est local; un nom de dossier n'est plus une raison de silence.
  const dernierJarvis = [...etat.tours].reverse().find((t) => t.role === "jarvis");
  useEffect(() => {
    if (dernierJarvis === undefined || fluxEnCoursAvantLecture) return;
    if (!fautLireAuto(dernierJarvis, {
      lectureAuto,
      dejaLu: lusRef.current.has(dernierJarvis.id),
      conversationChargee: chargeRef.current,
    })) return;
    lusRef.current.add(dernierJarvis.id);
    const id = dernierJarvis.id, texte = dernierJarvis.texte;
    setLectureId(id);
    void lireTexte(texte, false).then((r) => {
      if (!r.ok) setLectureId((courant) => (courant === id ? null : courant));
    });
  }, [dernierJarvis, fluxEnCoursAvantLecture, lectureAuto]);

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
    <>
      {/* Interrupteur muet persistant (spec §2.4) : Alexa répond à voix haute par défaut. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={basculerLectureAuto}
          aria-pressed={lectureAuto}
          aria-label={lectureAuto ? alexa.lectureAutoCouper : alexa.lectureAutoActiver}
          title={lectureAuto ? alexa.lectureAutoCouper : alexa.lectureAutoActiver}
          className="inline-flex min-h-target shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-transparent px-3 font-ui text-label text-ink-500 transition duration-quick ease-soft hover:bg-sunken hover:text-ink-900"
        >
          <Icone nom="audio" taille={16} />
          <span>{lectureAuto ? alexa.lectureAutoCouper : alexa.lectureAutoActiver}</span>
        </button>
      </div>
    <div className="flex flex-col gap-3" role="log" aria-live="polite" aria-label={fr.jarvis.titre}>
      {etat.tours.length === 0 && !fluxEnCours && (
        <div className="grid justify-items-center gap-4 px-4 py-10 text-center">
          <AvatarAlexa taille="lg" diametre={132} />
          <p className="m-0 font-ui text-body text-ink-700" style={{ maxWidth: "28ch" }}>
            {fr.jarvis.invite}
          </p>
          {/* ⚠️ LES AMORCES NE SONT PLUS RENDUES ICI, ET C'EST UNE CORRECTION
              VUE À L'ÉCRAN. L'écran Alexa les affichait DEUX FOIS : cette
              liste, en texte inerte au milieu du fil, et les pastilles
              cliquables sous le fil, qui elles remplissent le champ. Deux
              exemplaires de la même phrase, à quatre cents pixels l'un de
              l'autre, dont un seul répond au clic — on essaie forcément le
              mauvais. Une seule copie survit : celle qui fait quelque chose,
              dans `app/jarvis/page.tsx`.

              `compact` (le panneau latéral) n'en montrait déjà aucune ; le
              comportement des deux surfaces est donc désormais le même. */}
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
        const lisible = !tour.interrompu && !etat.erreur && tour.texte.trim().length > 0 && tour.texte.trim().length <= 2000;
        return (
          <div key={tour.id} className="flex flex-col gap-1">
            {tour.registre === "connaissance-generale" && (
              <span className="inline-flex items-center gap-1 pl-1 font-ui text-label tracking-label text-ai-600">
                <span aria-hidden className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full">
                  <AvatarAlexa taille="sm" diametre={16} />
                </span>
                {fr.jarvis.registreConnaissance}
              </span>
            )}
            {/* M07 — preuves gouvernées : titre + section + version (données
                C4, jamais d'identifiant). Absentes = réponse sans source. */}
            {(tour.preuves ?? []).map((preuve) => (
              <span
                key={`${preuve.titre}-${preuve.version}-${preuve.section ?? "?"}`}
                className="pl-1 font-ui text-label tracking-label text-ink-500"
              >
                {preuve.titre}
                {preuve.section === null ? "" : ` · ${preuve.section}`} · v{preuve.version}
              </span>
            ))}
            {(tour.alexaSources?.length ?? 0) > 0 ? (
              <details className="pl-1 font-ui text-label text-ink-500">
                <summary className="cursor-pointer">{fr.patients.resume.sources}</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...new Map(tour.alexaSources?.map(source => [JSON.stringify([source.type,source.id,source.provenance?.['paymentId'],source.provenance?.['draftId']]), source])).values()].map(source => {
                    const href = source.provenance?.["draftId"] ? "/documents?draft="+encodeURIComponent(String(source.provenance["draftId"])) : source.type === "patient" ? "/patients/"+encodeURIComponent(source.id) : source.type==="document" ? "/documents?document="+encodeURIComponent(source.id) : source.type === "consultation" ? `/consultation/${encodeURIComponent(source.id)}` : source.type === "appointment" ? "/agenda" : (source.type === "treatment" || source.type === "diagnostic" || source.type === "scale") && tour.sourcePatientId ? `/patients/${encodeURIComponent(tour.sourcePatientId)}` : null;
                    return <div key={JSON.stringify([source.type,source.id,source.provenance?.['paymentId'],source.provenance?.['draftId']])}>{href ? source.type==='document'?<a className="underline underline-offset-4" href={href}>{source.label}</a>:<Link className="underline underline-offset-4" href={href}>{source.label}</Link> : <span>{source.label}</span>}{source.excerpt ? <blockquote className="mt-1 whitespace-pre-wrap border-l border-rule pl-2">{source.excerpt}</blockquote> : null}</div>;
                  })}
                </div>
              </details>
            ) : null}
            {tour.alexaStatus?<span role="status" className="pl-1 font-ui text-label text-ink-500">{agentCopy[/\p{Script=Arabic}/u.test(tour.texte)?"ar":"fr"][tour.alexaStatus==="cancelled"?"cancelled":tour.alexaStatus]}</span>:null}
            {tour.alexaParts?.length?<details className="pl-1 font-ui text-label text-ink-700"><summary>{agentCopy[/\p{Script=Arabic}/u.test(tour.texte)?"ar":"fr"].partTitle}</summary>{tour.alexaParts.map(p=><div key={p.id}>{p.goal} — {agentCopy[/\p{Script=Arabic}/u.test(tour.texte)?"ar":"fr"].outcomes[p.status]}{p.reason?' · '+p.reason:''}</div>)}</details>:null}
            <div className="flex items-end gap-1">
              <p
                className={[
                  "m-0 whitespace-pre-wrap rounded-lg rounded-tl-sm border border-rule bg-card px-4 py-3 font-ui text-body text-ink-900 shadow-lift1",
                  tour.texte === "" ? "hidden" : "",
                ].join(" ")}
                style={{ maxWidth: compact ? "var(--bulle-jarvis-max)" : "46rem" }}
              >
                <AlexaAnswerText text={tour.texte} blocks={tour.alexaBlocks}/>
                {tour.interrompu === true && (!tour.alexaStatus || tour.alexaStatus === "cancelled") && (
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
        /* Trois points qui respirent — §4 règle 5 : opacité seule, rien ne bouge.
           Mission §12 : la mention d'étape (§12, sans donnée) remplace le
           silence pendant qu'une capacité tourne ; sinon le libellé générique. */
        <div role="status" className="flex flex-col gap-1">
          <span className="sr-only">{etat.etapeEnCours ?? fr.jarvis.reflechit}</span>
          <span
            aria-hidden="true"
            className="inline-flex w-20 items-center justify-center gap-1 rounded-lg rounded-tl-sm border border-rule bg-card px-4 py-3 shadow-lift1"
          >
            <span className="h-2 w-2 animate-respire rounded-full bg-ai-500" />
            <span className="h-2 w-2 animate-respire rounded-full bg-ai-500" />
            <span className="h-2 w-2 animate-respire rounded-full bg-ai-500" />
          </span>
          {etat.etapeEnCours !== null && (
            <span className="pl-1 font-ui text-label italic text-ink-500">
              {etat.etapeEnCours}
            </span>
          )}
        </div>
      )}

      <div ref={finRef} />
    </div>
    </>
  );
}

