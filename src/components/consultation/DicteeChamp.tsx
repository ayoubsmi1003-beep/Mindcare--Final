/**
 * LA DICTÉE, CHAMP PAR CHAMP — « ce micro-là écrit ici ».
 *
 * ═══ POURQUOI UN SEUL ÉTAT POUR TOUS LES CHAMPS ═══
 *
 * `jarvis-voix.ts` ne tient QU'UN enregistrement à la fois : le module garde
 * un `dictee` unique, et le micro vient d'un courtier à compteur de
 * références. Deux dictées simultanées ne sont donc pas seulement peu
 * souhaitables — elles n'existent pas. Ce module rend ce fait visible plutôt
 * que de le laisser se découvrir par un échec : pendant une dictée, les micros
 * des autres champs sont INERTES et le disent.
 *
 * ⚠️ LA CIBLE EST FIGÉE AU DÉPART, PAS À L'ARRIVÉE. Le champ qui recevra le
 * texte est celui dont le micro a été pressé, mémorisé au démarrage. La
 * transcription revient plusieurs secondes plus tard, souvent après que le
 * focus a bougé ; router à l'arrivée écrirait le Subjectif dans la Conduite à
 * tenir sans que rien ne le signale.
 *
 * ⚠️ AUCUN CLASSEMENT AUTOMATIQUE. Ce qui est dicté dans Subjectif reste dans
 * Subjectif, même si un modèle « aurait rangé ça dans l'Évaluation ».
 * Structurer la note est un acte clinique ; la voix est une méthode de saisie,
 * elle n'hérite d'aucune autorité supplémentaire.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  annulerDictee,
  arreterEtTranscrire,
  demarrerDictee,
  detecterCapacitesVoix,
} from "@/services/jarvis-voix";
import { captureEnCours, reprendreDetection, suspendreDetection } from "@/services/jarvis-reveil";

import {
  actionMicro,
  cibleDeRestitution,
  microInerte,
  type PhaseDictee,
} from "./regles-dictee";

export type { PhaseDictee };

/**
 * LA PORTE DE LA DICTÉE. Une capture du réveil possède déjà le micro : ouvrir
 * l'enregistreur d'un champ produirait deux prises concurrentes, ou
 * enregistrerait la praticienne en train de taper sa note.
 *
 * Rend `true` quand le micro est libre. Sinon le refus est SIGNALÉ avec le
 * message déjà porté par `jarvis-voix` — un bouton muet se lirait comme une
 * panne.
 */
export function dicteeAutorisee(
  capture: () => boolean,
  signaler: (message: string) => void,
): boolean {
  if (!capture()) return true;
  signaler(fr.jarvis.voix.dejaEnCours);
  return false;
}

export interface Dictee<C extends string> {
  /** Le champ actuellement en dictée, ou `null` au repos. */
  readonly cible: C | null;
  readonly phase: PhaseDictee;
  /** Ce navigateur sait-il enregistrer ? Constaté au montage, jamais deviné. */
  readonly possible: boolean;
  /** Démarre sur `cible`, ou arrête et transcrit si `cible` est déjà en cours. */
  readonly basculer: (cible: C) => void;
}

/**
 * @param inserer  reçoit la cible MÉMORISÉE au départ et le texte reconnu.
 *                 Doit INSÉRER — voir `insertion-dictee.ts`.
 * @param signaler message français prêt à afficher. Jamais un code technique :
 *                 « le fournisseur STT a échoué » n'aide personne à soigner.
 */
export function useDicteeChamps<C extends string>(
  inserer: (cible: C, texte: string) => void,
  signaler: (message: string) => void,
): Dictee<C> {
  const [cible, setCible] = useState<C | null>(null);
  const [phase, setPhase] = useState<PhaseDictee>("repos");
  const [possible, setPossible] = useState(false);

  // Les rappels changent à chaque rendu (ils ferment sur l'état du champ) ;
  // les lire par référence évite de re-créer `basculer` — et surtout évite que
  // le nettoyage de démontage se déclenche à chaque frappe.
  const insererRef = useRef(inserer);
  const signalerRef = useRef(signaler);
  insererRef.current = inserer;
  signalerRef.current = signaler;

  // ⚠️ LA PROPRIÉTÉ EST LOCALE, PAS GLOBALE. Le démontage d'un écran de
  // consultation ne doit ni annuler l'enregistreur d'une capture du réveil, ni
  // rendre un scoring qu'une AUTRE dictée avait suspendu. Ces deux drapeaux ne
  // passent à vrai que si CE crochet a réellement suspendu / enregistré.
  const aSuspendu = useRef(false);
  const aEnregistre = useRef(false);

  const rendreDetection = useCallback((): void => {
    if (!aSuspendu.current) return;
    aSuspendu.current = false;
    // `reprendreDetection` porte le verrou : si une capture du réveil
    // (`reveille`, `ecoute`, `traitement`, `parole`) possède déjà la
    // suspension, c'est SA transition qui rendra le scoring. On lui abandonne
    // l'intention sans rallumer le détecteur par-dessus elle.
    reprendreDetection();
  }, []);

  const oublierEnregistreur = useCallback((): void => {
    if (!aEnregistre.current) return;
    aEnregistre.current = false;
    annulerDictee();
  }, []);

  useEffect(() => {
    // `MediaRecorder` n'existe pas au rendu serveur : la capacité se constate
    // une fois, au montage, sinon le bouton clignoterait à l'hydratation.
    setPossible(detecterCapacitesVoix().dicteePossible);
    return () => {
      // ⚠️ LE MICRO NE RESTE JAMAIS OUVERT DERRIÈRE UN ÉCRAN QU'ON QUITTE.
      // Un micro allumé dans un cabinet de psychiatrie, sans que rien à
      // l'écran ne le dise, est un incident — pas une fuite de ressource.
      // Seulement si CETTE dictée possède l'enregistreur.
      oublierEnregistreur();
      // `reprendreDetection` abandonne l'intention de suspension sans
      // rallumer le détecteur si une capture du réveil la possède déjà.
      rendreDetection();
    };
  }, [oublierEnregistreur, rendreDetection]);

  const basculer = useCallback(
    (demandee: C): void => {
      const action = actionMicro({ cible, phase }, demandee);
      if (action === "ignorer") return;

      if (action === "arreter") {
        setPhase("transcription");
        void arreterEtTranscrire().then((resultat) => {
          // L'enregistreur de CETTE dictée est refermé : on rend le scoring au
          // détecteur, sans jamais toucher à celui d'une capture du réveil.
          oublierEnregistreur();
          rendreDetection();
          setPhase("repos");
          setCible(null);
          if (!resultat.ok) {
            // ⚠️ RIEN N'EST TOUCHÉ EN CAS D'ÉCHEC. Le champ garde ce qu'il
            // avait ; seule une phrase dit que la parole n'a pas été prise.
            signalerRef.current(resultat.error.message);
            return;
          }
          const texte = resultat.data.trim();
          if (texte === "") {
            signalerRef.current(fr.consultation.dicterVide);
            return;
          }
          // La cible est celle du DÉPART — voir `cibleDeRestitution`.
          insererRef.current(cibleDeRestitution(demandee, cible), texte);
        });
        return;
      }

      if (!dicteeAutorisee(captureEnCours, signalerRef.current)) return;

      setCible(demandee);
      setPhase("ecoute");
      // Le détecteur se tait AVANT l'ouverture du micro : sans cela, la note
      // dictée pourrait réveiller Jarvis au milieu de la phrase.
      suspendreDetection();
      aSuspendu.current = true;
      void demarrerDictee().then((resultat) => {
        if (!resultat.ok) {
          rendreDetection();
          setPhase("repos");
          setCible(null);
          // Permission refusée, micro absent, passerelle non configurée : la
          // passerelle nomme déjà la cause en français, on la relaie telle
          // quelle plutôt que d'en fabriquer une approximation.
          signalerRef.current(resultat.error.message);
          return;
        }
        // Seulement maintenant cette dictée POSSÈDE l'enregistreur : un arrêt
        // ou un démontage ne doit annuler que ce qu'elle a réellement ouvert.
        aEnregistre.current = true;
      });
    },
    [phase, cible, oublierEnregistreur, rendreDetection],
  );

  return { cible, phase, possible, basculer };
}

/**
 * Le micro d'un champ. Inerte — et le disant — pendant qu'un autre champ dicte.
 *
 * L'état est porté par le TEXTE, pas seulement par la couleur ou l'animation ;
 * `aria-pressed` et `role="status"` le rendent au lecteur d'écran, qui doit
 * savoir que le micro est ouvert au même titre que l'œil.
 */
export function BoutonDictee<C extends string>({
  champ,
  libelleChamp,
  dictee,
  disabled = false,
}: {
  readonly champ: C;
  /** Nom du champ visé — il entre dans l'étiquette lue à voix haute. */
  readonly libelleChamp: string;
  readonly dictee: Dictee<C>;
  readonly disabled?: boolean;
}): React.JSX.Element | null {
  // Un bouton présent mais inerte se lit comme une panne : sur un navigateur
  // sans enregistreur, ou sur une note verrouillée, il n'apparaît pas.
  if (!dictee.possible || disabled) return null;

  const active = dictee.cible === champ;
  const phase = active ? dictee.phase : "repos";
  const inerte = microInerte({ cible: dictee.cible, phase: dictee.phase }, champ);

  const texte =
    phase === "ecoute"
      ? fr.consultation.dicterEcoute
      : phase === "transcription"
        ? fr.consultation.dicterTranscription
        : fr.consultation.dicter;

  return (
    <span className="flex items-center gap-2">
      {phase === "ecoute" ? (
        // Le repère d'activité double le mot « Écoute » ; il ne le remplace pas.
        <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-attention" />
      ) : null}
      <button
        type="button"
        onClick={() => dictee.basculer(champ)}
        disabled={inerte}
        aria-pressed={phase === "ecoute"}
        aria-label={`${texte} — ${libelleChamp}`}
        className={[
          "inline-flex min-h-target items-center gap-1.5 rounded-full px-3 py-1",
          "font-ui text-label tracking-label",
          "transition duration-quick ease-out",
          "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
          "disabled:cursor-not-allowed disabled:opacity-disabled",
          phase === "ecoute"
            ? "bg-attention-bg text-attention-ink"
            : "text-ink-500 hover:bg-sunken hover:text-ink-900",
        ].join(" ")}
      >
        <span aria-hidden>🎙</span>
        <span>{texte}</span>
      </button>
      {active && phase !== "repos" ? (
        <span role="status" className="sr-only">
          {`${texte} — ${libelleChamp}`}
        </span>
      ) : null}
    </span>
  );
}
