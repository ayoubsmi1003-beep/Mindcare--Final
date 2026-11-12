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
 * · aucune seconde lecture d'une réponse déjà prononcée par la boucle directe
 *   (`dejaParlee`).
 *
 * Une réponse TAPÉE pendant une conversation vocale ouverte est prononcée PAR
 * la boucle (`parlerVoixLocale`), qui reprend l'écoute ensuite : tapée ou dite,
 * toute réponse passe par la même file Kokoro.
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
import { parlerVoixLocale } from "@/services/alexa-local";
import { arreterLecture, estLectureInterrompue, lireTexteLong } from "@/services/jarvis-voix";
import type { EtatVoix } from "@/services/jarvis-reveil";
import {
  abonnerActivite,
  abonnerCapture,
  boucleActive,
  captureActive,
  playbackBusy,
} from "@/services/voice-activity";

import { useVueVoixUnifiee } from "./voix-unifiee";

export interface OptionsLectureAutoGlobale {
  readonly lectureAuto: boolean;
  readonly conversationChargee: boolean;
  readonly etatConversation: EtatConversation;
  readonly etatVoix: EtatVoix;
  readonly boucleActive: boolean;
  readonly captureActive: boolean;
  readonly playbackBusy: boolean;
}

export type DecisionLectureAuto =
  | { readonly action: "lire"; readonly voie: "lecteur" | "boucle"; readonly tour: CandidatLectureAuto }
  | null;

/**
 * Décide quoi lire, et par quelle voie — ou rien.
 *
 * `boucle` : une conversation vocale est ouverte ; elle seule possède le
 * haut-parleur et le micro, la réponse tapée passe par elle quand elle écoute.
 * Ses propres réponses vocales portent `dejaParlee` et ne sont jamais rejouées.
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

  if (opts.boucleActive) {
    // Elle traite, parle ou se prépare : la réponse attendra son retour à l'écoute.
    if (opts.etatVoix !== "ecoute" || opts.playbackBusy) return null;
    const tour = choisirTourAuto(tours, idsHistoriques, idsLus, {
      lectureAuto: opts.lectureAuto,
      conversationChargee: opts.conversationChargee,
    });
    return tour === null ? null : { action: "lire", voie: "boucle", tour };
  }

  // Une capture du réveil, un champ ou la préparation de la boucle : aucun
  // haut-parleur, le micro est ouvert.
  if (opts.captureActive) return null;
  // Une synthèse établie possède déjà le haut-parleur : ne pas en démarrer
  // une seconde par-dessus (le tour sera relu quand elle se sera tue).
  if (opts.playbackBusy) return null;
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
  return tour === null ? null : { action: "lire", voie: "lecteur", tour };
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
  // Une capture qui COMMENCE coupe la lecture en cours du lecteur global.
  // La notification est réservée aux captures (pas à la lecture elle-même),
  // sinon le lecteur s'arrêterait en commençant à parler.
  useEffect(() => abonnerCapture(() => {
    if (captureActive()) arreterLecture();
  }), []);
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
      playbackBusy: playbackBusy(),
    });
    if (decision === null) return;

    const tour = decision.tour;
    if (decision.voie === "boucle") {
      enCours.current = true;
      setErreur(false);
      void parlerVoixLocale(tour.texte)
        .then((fin) => {
          // `occupe` : la boucle a repris la parole ou l'écoute active entre-temps ;
          // le tour reste non lu et sera prononcé à son prochain retour à l'écoute.
          if (fin !== "occupe") marquerTourLu(tour.id);
          if (fin === "echec") setErreur(true);
        })
        .catch(() => setErreur(true))
        .finally(() => {
          enCours.current = false;
          setFinLecture((valeur) => valeur + 1);
        });
      return;
    }

    // Marqué AVANT la lecture : un remontage du panneau ne le relira pas.
    marquerTourLu(tour.id);
    enCours.current = true;
    setErreur(false);
    void lireTexteLong(
      tour.texte,
      tour.porteUneIdentite === true,
      () => preference.current !== true || captureActive(),
    )
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
