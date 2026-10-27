/** Text and local microphone share the server turn; writes retain confirmation. */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import { alexa } from "@/i18n/alexa";
import { basculerVoixLocale, arreterVoixLocale } from "@/services/alexa-local";
import { abonnerMainsLibres, arreterMainsLibres, demarrerMainsLibres, mainsLibresActif } from "@/services/voix-mains-libres";
import { annulerSuivi, etatVoix, interrompreVoix } from "@/services/jarvis-reveil";
import { useVueVoixUnifiee } from "./voix-unifiee";
import type { EtatConversationPublique } from "@/services/conversation";

import { Icone } from "./ui/Icones";

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
  const voix = useVueVoixUnifiee();
  const [mainsLibres, setMainsLibres] = useState(mainsLibresActif());
  useEffect(() => abonnerMainsLibres(setMainsLibres), []);
  // `veille` (réveil armé, rien en cours) ne bloque pas le clavier : seule
  // une voix engagée (réveil entendu, écoute, traitement, parole) le fait.
  const actif = voix.etat === "reveille" || voix.etat === "ecoute" || voix.etat === "traitement" || voix.etat === "parole" || voix.etat === "interrompu";
  // La fenêtre de suivi ouvre le micro SANS redire « Alexa » : la machine
  // porte ce fait dans `raison` (voir `declencherEcoute`), et l'écran le dit.
  const suivi = voix.etat === "ecoute" && voix.raison === fr.jarvis.voix.reveil.voixSuivi;
  const messageVoix = suivi
    ? alexa.voixSuivi
    : actif || voix.etat === "erreur"
      ? voix.raison ?? null
      : mainsLibres && voix.etat === "veille"
        ? alexa.voixVeille
        : null;
  const libelleVoix = actif ? alexa.voixArreter : alexa.voixDemarrer;
  const libelleMainsLibres = mainsLibres ? alexa.mainsLibresArreter : alexa.mainsLibresActiver;

  const fluxEnCours = etat.etat === "envoi" || etat.etat === "flux";
  const bloque = fluxEnCours || etat.carteEcriture !== null || actif;

  // ⚠️ UN ENVOI TAPÉ N'HÉRITE JAMAIS DE LA FENÊTRE DE SUIVI. `annulerSuivi()`
  // retire le démarrage FUTUR ; `interrompreVoix()` referme la capture déjà
  // ouverte, sinon le micro continuerait d'enregistrer la frappe derrière
  // l'envoi. Les deux ensemble, jamais l'un sans l'autre.
  const envoyerTexte = useCallback(() => {
    annulerSuivi();
    if (etatVoix() === "ecoute" || etatVoix() === "reveille") interrompreVoix();
    onEnvoyer();
  }, [onEnvoyer]);

  return (
    /*
      ⚠️ `min-w-0` SUR LES DEUX, ET C'EST LA VRAIE CAUSE DU DÉBORDEMENT.

      Le `<footer>` du panneau est une GRILLE, et cette saisie en est un élément.
      Or un élément de grille vaut `min-width: auto` par défaut : il REFUSE de
      descendre sous la largeur minimale de son contenu. La ligne saisie + voix
      + envoi dépassait donc les 380 px du panneau, et c'est le bouton ENVOYER —
      dernier de la ligne, donc premier dehors — qui sortait du cadre. Le bouton
      principal de l'assistante était hors de l'écran, invisible et incliquable.

      `min-w-0` lève ce refus, exactement comme `min-h-0` le lève pour la hauteur
      dans `AppShell`. C'est le même piège, sur l'autre axe.
    */
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 gap-2">
        <input
          ref={champRef}
          value={etat.saisie}
          onChange={(e) => onChangerSaisie(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !bloque && etat.saisie.trim() !== "") envoyerTexte();
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
            {/* A click starts a continuous session; the same button stops it. */}
            <button
              type="button"
              onClick={() => {
                // Les deux voix ne tiennent jamais le micro ensemble.
                if (mainsLibresActif()) arreterMainsLibres();
                basculerVoixLocale();
              }}
              disabled={etat.carteEcriture !== null && !actif}
              aria-label={libelleVoix}
              title={voix.raison ?? libelleVoix}
              aria-pressed={actif}
              className={[
                /*
                  ⚠️ CE BOUTON CÈDE, ET L'ENVOI NON — MESURÉ À L'ÉCRAN.
                  Il était `shrink-0` avec son libellé « Maintenir pour parler ».
                  Le panneau étant large de 380 px fixes, les trois éléments de
                  cette ligne (saisie + voix + envoi) n'y tenaient pas : c'est
                  l'ENVOI, dernier de la ligne, qui sortait du cadre — le bouton
                  principal, invisible et incliquable, sur toute la hauteur du
                  produit. Ici, c'est le LIBELLÉ de la voix qui se réduit ; le
                  geste reste atteignable par l'icône, `aria-label` et `title`
                  inchangés, donc rien n'est perdu pour personne.
                */
                "inline-flex min-h-target min-w-0 shrink select-none items-center justify-center rounded-md border px-3 font-ui text-label transition duration-quick ease-soft",
                actif
                  ? "cursor-pointer border-ai-500 bg-ai-50 text-ai-600"
                  : "cursor-pointer border-rule bg-paper text-ink-700 hover:bg-sunken",
                etat.carteEcriture !== null && !actif
                  ? "cursor-not-allowed bg-sunken text-ink-500 opacity-disabled"
                  : "",
              ].join(" ")}
            >
              <span className="shrink-0">
                <Icone nom="audio" taille={16} />
              </span>
              <span className="truncate pl-2">
                {libelleVoix}
              </span>
            </button>

            {/* MAIN-LIBRES — interrupteur du réveil permanent, icône seule
                (380 px : le libellé qui se réduit, c'est déjà la voix). */}
            <button
              type="button"
              onClick={() => {
                // Décision sur l'état RÉEL du module, pas sur un rendu local
                // qui peut être en retard d'un clic.
                if (mainsLibresActif()) arreterMainsLibres();
                else {
                  // Une boucle directe encore ouverte posséderait le micro :
                  // on la ferme avant d'armer le réveil.
                  arreterVoixLocale();
                  void demarrerMainsLibres();
                }
              }}
              aria-label={libelleMainsLibres}
              title={libelleMainsLibres}
              aria-pressed={mainsLibres}
              className={[
                "inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-full border transition duration-quick ease-soft",
                mainsLibres
                  ? "border-ai-500 bg-ai-50 text-ai-600"
                  : "border-rule bg-paper text-ink-700 hover:bg-sunken",
              ].join(" ")}
            >
              <Icone nom="jarvis" taille={16} />
            </button>

            {/* L'ENVOI — la pastille pleine de marque, l'unique bouton colore. */}
            <button
              type="button"
              onClick={envoyerTexte}
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
        <p role="status" className={`m-0 font-ui text-label ${voix.etat === "erreur" ? "text-attention-ink" : "text-ink-500"}`}>
          {messageVoix}
        </p>
      )}

      {/* MENTION PERMANENTE — ADR-023, garde-fou 3. Elle ne se masque pas. */}
      <p className="m-0 font-ui text-label text-ink-500">{fr.disclaimer}</p>
    </div>
  );
}
