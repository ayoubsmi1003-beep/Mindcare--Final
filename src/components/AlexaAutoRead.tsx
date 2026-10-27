/**
 * LE LECTEUR AUTOMATIQUE GLOBAL — une réponse ne se tait plus parce que le
 * panneau est fermé.
 *
 * ═══ POURQUOI CE COMPOSANT EXISTE ═══
 *
 * `FilJarvis` n'est monté que dans le panneau latéral et sur l'écran Jarvis.
 * L'auto-lecture y vivait : une réponse tapée alors que le panneau était fermé
 * n'était jamais prononcée. Le lecteur vit donc dans `BootVoix`, qui dure
 * autant que l'application, et `FilJarvis` ne garde que le geste manuel.
 *
 * ═══ CE QU'IL NE FAIT PAS ═══
 *
 * · aucun son pendant une capture (réveil, dictée de champ, boucle directe) ;
 * · aucune lecture d'historique, de tour interrompu ou de statut non
 *   `completed` ;
 * · aucune seconde lecture d'une réponse déjà prononcée par la boucle directe.
 *
 * La décision est PURE (`choisirActionLectureAuto`) pour être éprouvée sans
 * DOM ; le composant ne fait que l'exécuter.
 */
"use client";

import { useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  abonnerConversation,
  idsHistorique,
  idsLues,
  marquerTourLu,
  type EtatConversation,
  type EtatConversationPublique,
} from "@/services/conversation";
import {
  abonnerPreferenceLectureAuto,
  choisirTourAuto,
  lirePreferenceLectureAuto,
  type CandidatLectureAuto,
} from "@/services/lecture-auto";
import { arreterLecture, estLectureInterrompue, lireTexteLong } from "@/services/jarvis-voix";
import type { EtatVoix } from "@/services/jarvis-reveil";
import { abonnerActivite, boucleActive, captureActive } from "@/services/voice-activity";

import { useVueVoixUnifiee } from "./voix-unifiee";

export interface OptionsLectureAutoGlobale {
  readonly lectureAuto: boolean;
  readonly conversationChargee: boolean;
  readonly etatConversation: EtatConversation;
  readonly etatVoix: EtatVoix;
  readonly boucleActive: boolean;
  readonly captureActive: boolean;
}

export type DecisionLectureAuto =
  | { readonly action: "lire"; readonly tour: CandidatLectureAuto }
  | { readonly action: "marquer"; readonly tour: CandidatLectureAuto }
  | null;

/**
 * Décide quoi faire du dernier tour Jarvis — ou rien.
 *
 * `marquer` est le cas de la boucle directe : elle a déjà lu la réponse
 * elle-même. La marquer évite de la rejouer quand la boucle s'arrête.
 */
export function choisirActionLectureAuto(
  tours: readonly CandidatLectureAuto[],
  idsHistoriques: ReadonlySet<string>,
  idsLus: ReadonlySet<string>,
  opts: OptionsLectureAutoGlobale,
): DecisionLectureAuto {
  // Une réponse encore en flux n'est pas une réponse : la lire lirait une
  // phrase coupée au milieu.
  if (opts.etatConversation === "envoi" || opts.etatConversation === "flux") return null;

  const boucleParle =
    opts.boucleActive &&
    (opts.etatVoix === "parole" || opts.etatVoix === "ecoute" || opts.etatVoix === "traitement");
  if (boucleParle) {
    // La boucle directe prononce elle-même ses réponses. On marque la plus
    // récente comme lue — sans appeler `lireTexte` une seconde fois.
    const tour = choisirTourAuto(tours, idsHistoriques, idsLus, {
      lectureAuto: true,
      conversationChargee: opts.conversationChargee,
    });
    return tour === null ? null : { action: "marquer", tour };
  }

  // Une capture du réveil, un champ ou la préparation de la boucle : aucun
  // haut-parleur, le micro est ouvert.
  if (opts.captureActive) return null;
  if (
    opts.etatVoix === "reveille" ||
    opts.etatVoix === "ecoute" ||
    opts.etatVoix === "traitement" ||
    opts.etatVoix === "parole"
  ) {
    return null;
  }

  const tour = choisirTourAuto(tours, idsHistoriques, idsLus, {
    lectureAuto: opts.lectureAuto,
    conversationChargee: opts.conversationChargee,
  });
  return tour === null ? null : { action: "lire", tour };
}

export function AlexaAutoRead(): React.JSX.Element | null {
  const voix = useVueVoixUnifiee();
  const [etat, setEtat] = useState<EtatConversationPublique | null>(null);
  const [lectureAuto, setLectureAuto] = useState<boolean>(() => lirePreferenceLectureAuto());
  const [erreur, setErreur] = useState(false);
  const [activite, setActivite] = useState(0);
  const [finLecture, setFinLecture] = useState(0);
  const enCours = useRef(false);
  const preference = useRef(lectureAuto);
  preference.current = lectureAuto;

  useEffect(() => abonnerConversation(setEtat), []);
  useEffect(() => abonnerPreferenceLectureAuto(setLectureAuto), []);
  useEffect(() => abonnerActivite(() => setActivite((valeur) => valeur + 1)), []);
  // Au démontage de l'application (déconnexion), la synthèse en cours ne doit
  // pas continuer derrière un écran de connexion.
  useEffect(() => () => {
    enCours.current = false;
    arreterLecture();
  }, []);

  useEffect(() => {
    if (etat === null) return;

    // Une nouvelle demande coupe la lecture en cours — sauf si c'est la boucle
    // directe qui parle : elle possède sa propre synthèse.
    if (etat.etat === "envoi" || etat.etat === "flux") {
      if (!boucleActive()) {
        arreterLecture();
      }
      return;
    }

    if (enCours.current) return;

    const decision = choisirActionLectureAuto(etat.tours, idsHistorique(), idsLues(), {
      lectureAuto,
      conversationChargee: !etat.chargementHistorique,
      etatConversation: etat.etat,
      etatVoix: voix.etat,
      boucleActive: boucleActive(),
      captureActive: captureActive(),
    });
    if (decision === null) return;

    if (decision.action === "marquer") {
      marquerTourLu(decision.tour.id);
      return;
    }

    const tour = decision.tour;
    // Marqué AVANT la lecture : un remontage du panneau ne le relira pas.
    marquerTourLu(tour.id);
    enCours.current = true;
    setErreur(false);
    void lireTexteLong(tour.texte, tour.porteUneIdentite === true, () => preference.current !== true)
      .then((resultat) => {
        // Un arrêt volontaire n'est pas une panne de voix.
        if (!resultat.ok && !estLectureInterrompue(resultat.error)) setErreur(true);
      })
      .catch(() => setErreur(true))
      .finally(() => {
        enCours.current = false;
        setFinLecture((valeur) => valeur + 1);
      });
  }, [activite, etat, finLecture, lectureAuto, voix.etat]);

  if (!erreur) return null;
  return (
    <p
      role="status"
      className="fixed bottom-4 right-4 z-50 m-0 rounded-lg border border-rule bg-card px-3 py-2 font-ui text-label text-attention-ink shadow-lift1"
    >
      {fr.jarvis.voix.indisponible}
    </p>
  );
}
