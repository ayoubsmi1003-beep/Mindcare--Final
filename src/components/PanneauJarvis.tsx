/**
 * `PanneauJarvis` — le panneau lateral, V-JARVIS-CORE.
 *
 * CE COMPOSANT NE DETIENT PLUS AUCUNE LOGIQUE. L'etat, l'execution des outils
 * et la carte de confirmation vivent dans `services/conversation.ts` — UN SEUL
 * etat partage avec l'ecran plein `/jarvis`. Ouvrir le plein ecran ne duplique
 * pas la conversation, fermer le panneau ne l'interrompt pas : c'est la
 * definition meme d'un store.
 *
 * Ce qui reste ici : le lanceur (l'orbe), Cmd-K, l'en-tete, le contexte
 * patient, et le montage de `FilJarvis` + `SaisieJarvis`.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  abonnerConversation,
  accepterCarte,
  changerSaisie,
  definirContextePatient,
  effacerErreur,
  envoyer,
  interrompre,
  quitterContexte,
  refuserCarte,
  type EtatConversationPublique,
} from "@/services/conversation";
import {
  abonnerPatientActif,
  type PatientActif,
} from "@/services/patient-actif";
import { cibleValide } from "@/services/jarvis-contexte";

import { CarteConfirmation } from "./CarteConfirmation";
import { FilJarvis } from "./FilJarvis";
import { OrbeVoix } from "./OrbeVoix";
import { SaisieJarvis } from "./SaisieJarvis";
import { Icone } from "./ui/Icones";

const LARGEUR_PANNEAU = "380px";

export interface PanneauJarvisProps {
  /**
   * V7 — L'OUVERTURE EST REMONTÉE DANS LA COQUILLE. Elle était un state
   * local, ce qui obligeait le panneau à porter son propre lanceur : la
   * pastille flottante en bas à droite, c'est-à-dire le motif « bulle de
   * chat » exact. Le lanceur est désormais le champ de commande de la barre
   * supérieure, et l'état vit là où ses deux lecteurs se rejoignent.
   */
  readonly ouvert: boolean;
  readonly onChangerOuvert: (ouvert: boolean) => void;
}

export function PanneauJarvis({
  ouvert,
  onChangerOuvert,
}: PanneauJarvisProps): React.JSX.Element {
  const [etat, setEtat] = useState<EtatConversationPublique | null>(null);
  const [patientActif, setPatientActif] = useState<PatientActif | null>(null);
  const [maintenant, setMaintenant] = useState<number>(() => Date.now());

  useEffect(() => abonnerConversation(setEtat), []);
  // Phase 3 : l'écran ALIMENTE la cible — `definirContextePatient` n'avait
  // aucun appelant, la cible restait vide et « son dossier » ne résolvait
  // jamais vers le dossier ouvert. L'effacement se propage de même (null).
  useEffect(
    () =>
      abonnerPatientActif((p) => {
        setPatientActif(p);
        definirContextePatient(p);
      }),
    [],
  );

  // Phase 3 : expiré = absent. Toutes les 30 s, une cible dépassée purge les
  // deux magasins et la puce disparaît — aucun contexte oublié à l'écran.
  useEffect(() => {
    if (patientActif === null) return;
    const minuteur = setInterval(() => {
      if (cibleValide() === null) quitterContexte();
      else setMaintenant(Date.now());
    }, 30_000);
    return () => clearInterval(minuteur);
  }, [patientActif]);

  // Echap ferme, SAUF si une carte attend une decision : refermer le panneau
  // sur une proposition en attente la laisserait `proposed` sans que personne
  // ne sache qu'elle existe. L'ouverture clavier (Cmd-K / Ctrl-K) appartient
  // a la palette (M11). La dependance suit les publications du store, pas un
  // state local.
  useEffect(() => {
    function surTouche(evenement: KeyboardEvent): void {
      if (evenement.key === "Escape" && etat?.carteEcriture === null) onChangerOuvert(false);
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [etat, onChangerOuvert]);

  const soumettre = useCallback(() => {
    if (etat === null) return;
    void envoyer(etat.saisie);
  }, [etat]);

  if (etat === null) return <></>;

  /**
   * V7 — FERMÉ, LE PANNEAU NE REND PLUS RIEN.
   *
   * Il rendait une pastille flottante en bas à droite : orbe + « Ouvrir » +
   * ⌘K. C'était le motif « bulle de chat » dans sa forme la plus
   * reconnaissable, et il faisait lire une intelligence intégrée comme un
   * widget collé après coup, flottant au-dessus d'un produit qui ne
   * l'attendait pas. Le lanceur est désormais le champ de commande de la barre
   * supérieure, et l'orbe y tient son rôle de témoin d'état de la voix.
   */
  if (!ouvert) return <></>;

  return (
    <aside
      aria-label={fr.jarvis.titre}
      /* LE VERRE EST ICI ET NULLE PART AILLEURS DANS CE PANNEAU (§4.1). Les
       * bulles, elles, sont opaques — voir `FilJarvis`. */
      className="fixed inset-y-0 right-0 flex flex-col border-l border-rule bg-glass-panel shadow-lift3"
      style={{
        width: LARGEUR_PANNEAU,
        maxWidth: "100vw",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        zIndex: "var(--z-panneau)",
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-rule bg-grad-tile-ai px-4 py-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-on-brand-surface text-on-brand">
            <OrbeVoix taille={18} />
          </span>
          <strong className="truncate font-ui text-body font-semibold text-on-brand">
            {fr.jarvis.titre}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => onChangerOuvert(false)}
          aria-label={fr.jarvis.fermer}
          title={fr.jarvis.fermer}
          className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-on-brand-surface-hover text-on-brand transition duration-quick ease-out hover:bg-on-brand-surface"
        >
          <Icone nom="croix" taille={16} />
        </button>
      </header>

      {/* Le contexte patient est EVIDENT, jamais devine — Phase 3 : avec son
        âge et une sortie explicite. Expiré, il est traité comme absent : la
        puce disparaît (`cibleValide`, qui purge paresseusement — appel
        idempotent, convergé par l'abonnement). */}
      {patientActif !== null && cibleValide() !== null && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-ai-100 bg-ai-50 px-4 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 font-ui text-label text-ai-600">
            <Icone nom="patients" taille={16} />
            <span className="truncate">
              {fr.jarvis.contexte.contexteTitre} : {patientActif.nom} ·{" "}
              {fr.jarvis.contexte.ilYaNMin(
                Math.max(0, Math.floor((maintenant - patientActif.etablieA) / 60_000)),
              )}
            </span>
          </span>
          <button
            type="button"
            onClick={() => quitterContexte()}
            aria-label={fr.jarvis.contexte.changer}
            title={fr.jarvis.contexte.changer}
            className="inline-flex min-h-target shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent px-2 font-ui text-label font-semibold text-ai-600 transition duration-quick ease-soft hover:bg-ai-100"
          >
            {fr.jarvis.contexte.changer}
          </button>
        </div>
      )}

      {/* L'erreur nommee du dernier tour — au-dessus du fil, jamais a sa place. */}
      {etat.erreur !== null && (
        <div role="alert" className="flex items-start gap-2 border-b border-attention bg-attention-bg px-4 py-2">
          <Icone nom="alerte" taille={16} className="mt-0.5 shrink-0 text-attention-ink" />
          <p className="m-0 min-w-0 flex-1 font-ui text-label text-ink-700">{etat.erreur.message}</p>
          <button
            type="button"
            onClick={() => effacerErreur()}
            aria-label={fr.actions.annuler}
            title={fr.actions.annuler}
            className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-500 transition duration-quick ease-soft hover:bg-card hover:text-ink-900"
          >
            <Icone nom="croix" taille={16} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <FilJarvis etat={etat} compact />
      </div>

      <footer className="grid gap-2 border-t border-rule bg-card px-4 py-3">
        <SaisieJarvis
          etat={etat}
          onEnvoyer={soumettre}
          onChangerSaisie={changerSaisie}
          onInterrompre={interrompre}
        />
      </footer>

      {etat.carteEcriture !== null && (
        /* La carte flotte AU-DESSUS de tout le panneau : une decision
           d'ecriture n'est pas une bulle parmi d'autres. */
        <div className="absolute inset-x-3 bottom-3 z-10">
          <CarteConfirmation
            carte={etat.carteEcriture}
            enCours={false}
            onConfirmer={() => void accepterCarte()}
            onAnnuler={() => void refuserCarte()}
          />
        </div>
      )}
    </aside>
  );
}
