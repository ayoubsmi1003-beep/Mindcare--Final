/**
 * `PaletteCommande` — la commande ⌘K, MÊME conversation que le panneau.
 *
 * AUCUNE logique outil ici : `envoyer` + cartes + fil sont le store
 * `services/conversation.ts` (même câblage que `PanneauJarvis:206-230`).
 * ⌘K/Ctrl-K ouvre et ferme ; Échap ferme SAUF carte en attente (même règle
 * que le panneau : une proposition refermée resterait `proposed` invisible).
 * Le voile ne ferme que sans carte en attente, pour la même raison.
 */
"use client";

import { useCallback, useEffect, useState } from "react";

import { m11 } from "@/i18n/m11";
import {
  abonnerConversation,
  accepterCarte,
  changerSaisie,
  envoyer,
  interrompre,
  refuserCarte,
  type EtatConversationPublique,
} from "@/services/conversation";

import { CarteConfirmation } from "./CarteConfirmation";
import { FilJarvis } from "./FilJarvis";
import { SaisieJarvis } from "./SaisieJarvis";
import { Icone } from "./ui/Icones";

/** Largeur palette — constante nommée, jamais de valeur arbitraire (I10, même motif que `LARGEUR_PANNEAU`). */
const LARGEUR_PALETTE = "min(640px, 92vw)";
const HAUTEUR_MAX_PALETTE = "70vh";

export function PaletteCommande({
  ouvert,
  onChangerOuvert,
}: {
  readonly ouvert: boolean;
  readonly onChangerOuvert: (ouvert: boolean) => void;
}): React.JSX.Element {
  const [etat, setEtat] = useState<EtatConversationPublique | null>(null);

  useEffect(() => abonnerConversation(setEtat), []);

  useEffect(() => {
    function surTouche(evenement: KeyboardEvent): void {
      if ((evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "k") {
        evenement.preventDefault();
        onChangerOuvert(!ouvert);
        return;
      }
      if (evenement.key === "Escape" && etat?.carteEcriture === null) onChangerOuvert(false);
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [etat, ouvert, onChangerOuvert]);

  const soumettre = useCallback(() => {
    if (etat === null) return;
    void envoyer(etat.saisie);
  }, [etat]);

  if (!ouvert || etat === null) return <></>;

  return (
    <div
      className="fixed inset-0"
      style={{ background: "var(--voile)" }}
      onClick={() => {
        if (etat.carteEcriture === null) onChangerOuvert(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m11.palette.titre}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto mt-24 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-rule bg-card shadow-lift3"
        style={{
          width: LARGEUR_PALETTE,
          maxHeight: HAUTEUR_MAX_PALETTE,
          zIndex: "var(--z-palette)",
        }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <strong className="truncate font-ui text-body font-semibold text-ink-900">
            {m11.palette.titre}
          </strong>
          <button
            type="button"
            onClick={() => onChangerOuvert(false)}
            aria-label={m11.palette.fermer}
            title={m11.palette.fermer}
            className="inline-flex min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-500 transition duration-quick ease-soft hover:bg-card hover:text-ink-900"
          >
            <Icone nom="croix" taille={16} />
          </button>
        </header>
        {etat.erreur !== null && (
          <div role="alert" className="flex items-start gap-2 border-b border-attention bg-attention-bg px-4 py-2">
            <p className="m-0 min-w-0 flex-1 font-ui text-label text-ink-700">{etat.erreur.message}</p>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {etat.tours.length === 0 && etat.etat !== "envoi" && etat.etat !== "flux" ? (
            <p className="m-0 font-ui text-body text-ink-500">{m11.palette.vide}</p>
          ) : (
            <FilJarvis etat={etat} compact />
          )}
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
          <div className="px-3 pb-3">
            <CarteConfirmation
              carte={etat.carteEcriture}
              enCours={false}
              onConfirmer={() => void accepterCarte()}
              onAnnuler={() => void refuserCarte()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
