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
  effacerErreur,
  envoyer,
  interrompre,
  refuserCarte,
  type EtatConversationPublique,
} from "@/services/conversation";
import {
  abonnerPatientActif,
  effacerPatientActif,
  type PatientActif,
} from "@/services/patient-actif";

import { CarteConfirmation } from "./CarteConfirmation";
import { FilJarvis } from "./FilJarvis";
import { OrbeVoix } from "./OrbeVoix";
import { SaisieJarvis } from "./SaisieJarvis";
import { Icone } from "./ui/Icones";

const LARGEUR_PANNEAU = "380px";

export function PanneauJarvis(): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<EtatConversationPublique | null>(null);
  const [patientActif, setPatientActif] = useState<PatientActif | null>(null);

  useEffect(() => abonnerConversation(setEtat), []);
  useEffect(() => abonnerPatientActif(setPatientActif), []);

  // Cmd-K / Ctrl-K ouvre et ferme ; Echap ferme, SAUF si une carte attend une
  // decision : refermer le panneau sur une proposition en attente la
  // laisserait `proposed` sans que personne ne sache qu'elle existe. La
  // dependance suit les publications du store, pas un state local.
  useEffect(() => {
    function surTouche(evenement: KeyboardEvent): void {
      if ((evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "k") {
        evenement.preventDefault();
        setOuvert((precedent) => !precedent);
        return;
      }
      if (evenement.key === "Escape" && etat?.carteEcriture === null) setOuvert(false);
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [etat]);

  const soumettre = useCallback(() => {
    if (etat === null) return;
    void envoyer(etat.saisie);
  }, [etat]);

  if (etat === null) return <></>;

  if (!ouvert) {
    return (
      /* DEUX GESTES, DEUX BOUTONS. L'orbe parle, le libelle ouvre le panneau.
       * Les imbriquer donnerait un bouton dans un bouton — invalide, et
       * impossible a atteindre au clavier. Separes, la praticienne peut poser
       * une question sans jamais ouvrir le panneau : c'est tout l'interet d'un
       * assistant vocal. */
      <div
        className="fixed bottom-6 right-6 flex min-h-target-lg items-center gap-2 rounded-full bg-card py-2 pl-2 pr-2 shadow-lift3"
        style={{ zIndex: "var(--z-panneau)" }}
      >
        <OrbeVoix taille={32} />
        <button
          type="button"
          onClick={() => setOuvert(true)}
          aria-label={fr.jarvis.ouvrir}
          className="flex cursor-pointer items-center gap-3 rounded-full border-0 bg-transparent py-1 pl-1 pr-3 font-ui text-body font-medium text-ink-900 transition duration-quick ease-soft hover:text-ai-600"
        >
          {fr.jarvis.ouvrir}
          <span
            aria-hidden="true"
            className="rounded-sm border border-rule bg-sunken px-2 py-1 font-num text-eyebrow tabular-nums text-ink-500"
          >
            ⌘K
          </span>
        </button>
      </div>
    );
  }

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
      <header className="flex items-center justify-between gap-3 border-b border-rule bg-card px-4 py-3">
        <span className="flex min-w-0 items-center gap-3">
          <OrbeVoix taille={24} />
          <strong className="truncate font-ui text-body font-semibold text-ink-900">
            {fr.jarvis.titre}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          aria-label={fr.jarvis.fermer}
          title={fr.jarvis.fermer}
          className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-500 transition duration-quick ease-soft hover:bg-sunken hover:text-ink-900"
        >
          <Icone nom="croix" taille={20} />
        </button>
      </header>

      {/* Le contexte patient est EVIDENT, jamais devine. */}
      {patientActif !== null && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-ai-100 bg-ai-50 px-4 py-2"
        >
          <span className="flex min-w-0 items-center gap-2 font-ui text-label text-ai-600">
            <Icone nom="patients" taille={16} />
            <span className="truncate">
              {fr.jarvis.contexte.patientActif} : {patientActif.nom}
            </span>
          </span>
          <button
            type="button"
            onClick={() => effacerPatientActif()}
            aria-label={fr.jarvis.contexte.retirer}
            title={fr.jarvis.contexte.retirer}
            className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-500 transition duration-quick ease-soft hover:bg-ai-100 hover:text-ai-600"
          >
            <Icone nom="croix" taille={16} />
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
