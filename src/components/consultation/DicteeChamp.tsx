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
  annulerDicteeSi,
  arreterEtTranscrire,
  demarrerDictee,
  detecterCapacitesVoix,
  generationDictee,
} from "@/services/jarvis-voix";
import { reprendreDetection, suspendreDetection } from "@/services/jarvis-reveil";
import { lectureInterdite, setFieldBusy } from "@/services/voice-activity";

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

/**
 * LA DÉCISION DE DÉMONTAGE — sans rendu, donc éprouvable.
 *
 * Un démarrage encore en vol doit être INVALIDÉ seulement si SON jeton est
 * encore courant : un autre propriétaire a pu ouvrir un enregistreur entre
 * l'appel et le démontage. Un enregistreur déjà possédé ne doit être annulé
 * que si le jeton n'a pas changé — sinon un arrêt ou un abandon externe
 * (désarmement, interruption) a déjà rendu la main, et le recorder appartient
 * désormais à une capture du réveil.
 */
export function doitAnnulerDictee(etat: {
  readonly aDemarre: boolean;
  readonly genDemarrage: number;
  readonly aEnregistre: boolean;
  readonly gen: number;
  readonly courant: number;
}): boolean {
  if (etat.aDemarre) return etat.genDemarrage === etat.courant;
  return etat.aEnregistre && etat.gen === etat.courant;
}

/**
 * L'ARRÊT PEUT-IL PRENDRE POSSESSION DE L'ENREGISTREUR ?
 *
 * Non si le jeton a changé : une capture du réveil a remplacé la dictée du
 * champ. Transcrire dans ce cas enverrait la commande vocale dans une note
 * clinique.
 */
export function doitArreterDictee(etat: {
  readonly aEnregistre: boolean;
  readonly gen: number;
  readonly courant: number;
}): boolean {
  return etat.aEnregistre && etat.gen === etat.courant;
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
  // rendre un scoring qu'une AUTRE dictée avait suspendu.
  //
  //   aDemarre  : `demarrerDictee()` est parti, l'enregistreur n'est pas encore
  //               confirmé — il FAUT l'invalider au démontage SI `genDemarrage`
  //               est encore le jeton courant ;
  //   aEnregistre : CETTE dictée possède le recorder, mais seulement tant que
  //               `genRef` égale le jeton courant ;
  //   monte     : une continuation asynchrone ne doit pas ranimer un crochet
  //               démonté ;
  //   genRef    : jeton de propriété rendu par `jarvis-voix` ;
  //   genDemarrage : jeton du démarrage encore en vol, pour ne pas annuler
  //               l'enregistreur d'un propriétaire plus récent.
  const aSuspendu = useRef(false);
  const aDemarre = useRef(false);
  const aEnregistre = useRef(false);
  const monte = useRef(true);
  const genRef = useRef(0);
  const genDemarrage = useRef(0);
  const aMarqueChamp = useRef(false);

  const rendreDetection = useCallback((): void => {
    if (aMarqueChamp.current) {
      aMarqueChamp.current = false;
      setFieldBusy(false);
    }
    if (!aSuspendu.current) return;
    aSuspendu.current = false;
    // `reprendreDetection` porte le verrou : si une capture du réveil
    // (`reveille`, `ecoute`, `traitement`, `parole`) possède déjà la
    // suspension, c'est SA transition qui rendra le scoring. On lui abandonne
    // l'intention sans rallumer le détecteur par-dessus elle.
    reprendreDetection();
  }, []);

  useEffect(() => {
    // `MediaRecorder` n'existe pas au rendu serveur : la capacité se constate
    // une fois, au montage, sinon le bouton clignoterait à l'hydratation.
    monte.current = true;
    setPossible(detecterCapacitesVoix().dicteePossible);
    return () => {
      // ⚠️ LE MICRO NE RESTE JAMAIS OUVERT DERRIÈRE UN ÉCRAN QU'ON QUITTE.
      // Un micro allumé dans un cabinet de psychiatrie, sans que rien à
      // l'écran ne le dise, est un incident — pas une fuite de ressource.
      monte.current = false;
      const annuler = doitAnnulerDictee({
        aDemarre: aDemarre.current,
        genDemarrage: genDemarrage.current,
        aEnregistre: aEnregistre.current,
        gen: genRef.current,
        courant: generationDictee(),
      });
      const jeton = aEnregistre.current ? genRef.current : genDemarrage.current;
      aDemarre.current = false;
      aEnregistre.current = false;
      genRef.current = 0;
      genDemarrage.current = 0;
      // Annuler AVANT de rendre la détection : l'enregistreur doit être
      // refermé avant que le détecteur ne réécoute. Et seulement si le jeton
      // est encore le nôtre : `annulerDicteeSi` ne touche pas une capture du
      // réveil qui aurait pris la main entre-temps.
      if (annuler) annulerDicteeSi(jeton);
      // `reprendreDetection` abandonne l'intention de suspension sans
      // rallumer le détecteur si une capture du réveil la possède déjà.
      rendreDetection();
    };
  }, [rendreDetection]);

  const basculer = useCallback(
    (demandee: C): void => {
      const action = actionMicro({ cible, phase }, demandee);
      if (action === "ignorer") return;

      if (action === "arreter") {
        if (aDemarre.current) {
          // Le démarrage n'a pas encore rendu l'enregistreur : rien à
          // transcrire. On l'invalide AVANT qu'il ne s'ouvre après coup —
          // seulement si SON jeton est encore courant.
          const jeton = genDemarrage.current;
          aDemarre.current = false;
          aEnregistre.current = false;
          genRef.current = 0;
          genDemarrage.current = 0;
          annulerDicteeSi(jeton);
          rendreDetection();
          setPhase("repos");
          setCible(null);
          return;
        }

        // ⚠️ NE PAS TRANSCRIRE L'ENREGISTREUR D'UN AUTRE. Si une capture du
        // réveil a pris le jeton, `arreterEtTranscrire` enverrait la commande
        // vocale dans une note clinique. On remet seulement l'affichage local
        // au repos, sans toucher au micro global.
        if (!doitArreterDictee({ aEnregistre: aEnregistre.current, gen: genRef.current, courant: generationDictee() })) {
          aEnregistre.current = false;
          genRef.current = 0;
          rendreDetection();
          setPhase("repos");
          setCible(null);
          return;
        }

        // L'arrêt PREND possession de l'enregistreur : cette dictée n'en est
        // plus propriétaire, une continuation ou un démontage ne doit plus
        // l'annuler.
        aDemarre.current = false;
        aEnregistre.current = false;
        genRef.current = 0;
        genDemarrage.current = 0;
        setPhase("transcription");
        void arreterEtTranscrire().then((resultat) => {
          // L'enregistreur de CETTE dictée est refermé : on rend le scoring au
          // détecteur, sans jamais toucher à celui d'une capture du réveil.
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

      if (!dicteeAutorisee(lectureInterdite, signalerRef.current)) return;

      setCible(demandee);
      setPhase("ecoute");
      // Le détecteur se tait AVANT l'ouverture du micro : sans cela, la note
      // dictée pourrait réveiller Jarvis au milieu de la phrase.
      suspendreDetection();
      aSuspendu.current = true;
      // Le champ est un propriétaire du micro au même titre que le réveil.
      setFieldBusy(true);
      aMarqueChamp.current = true;
      aDemarre.current = true;
      const demarrage = demarrerDictee();
      // Le jeton de départ est posé SYNCHRONEMENT par `demarrerDictee` ; le
      // capturer maintenant permet de reconnaître un abandon survenu avant la
      // résolution — et de ne pas fermer un enregistreur plus récent.
      const jetonDemarrage = generationDictee();
      genDemarrage.current = jetonDemarrage;
      void demarrage.then((resultat) => {
        const courant = generationDictee();
        // Ce démarrage est-il encore CELUI que ce crochet attend ? Un arrêt,
        // un démontage ou un nouveau départ a pu prendre la main.
        const mien = genDemarrage.current === jetonDemarrage;
        if (!resultat.ok) {
          if (mien) {
            aDemarre.current = false;
            genDemarrage.current = 0;
          }
          if (!monte.current || !mien) return;
          rendreDetection();
          setPhase("repos");
          setCible(null);
          // Permission refusée, micro absent, passerelle non configurée : la
          // passerelle nomme déjà la cause en français, on la relaie telle
          // quelle plutôt que d'en fabriquer une approximation.
          signalerRef.current(resultat.error.message);
          return;
        }
        if (!mien) {
          // L'enregistreur qui vient de s'ouvrir n'appartient plus à ce
          // crochet. On le referme SEULEMENT s'il est encore le nôtre.
          if (courant === jetonDemarrage) annulerDicteeSi(jetonDemarrage);
          return;
        }
        aDemarre.current = false;
        genDemarrage.current = 0;
        if (!monte.current || courant !== jetonDemarrage) {
          // Le crochet est démonté, ou un arrêt/abandon externe a déjà pris la
          // main : l'enregistreur qui vient de s'ouvrir n'appartient plus à
          // personne. On le referme SEULEMENT s'il est encore le nôtre.
          annulerDicteeSi(jetonDemarrage);
          if (monte.current) {
            setPhase("repos");
            setCible(null);
            rendreDetection();
          }
          return;
        }
        // Seulement maintenant cette dictée POSSÈDE l'enregistreur.
        aEnregistre.current = true;
        genRef.current = courant;
      });
    },
    [phase, cible, rendreDetection],
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
