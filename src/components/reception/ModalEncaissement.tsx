/**
 * ModalEncaissement — dialog natif centré, extrait de PaiementsZone.TiroirEncaissement.
 * Pas d'optimisme argent, anti-rebond 400ms avec feedback explicite.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { fr } from "@/i18n/fr";
import { BlocErreur } from "@/components/ui/Etats";
import { Bouton } from "@/components/ui/Bouton";
import { formaterDzd, recordPaymentCollected } from "@/services/finance";
import type { PaiementAccueil } from "@/services/reception";

const DELAI_MS = 400;

interface Props {
  readonly paiement: PaiementAccueil;
  readonly onFermer: () => void;
  readonly apresMutation: () => void;
}

function identite(p: PaiementAccueil): string {
  if (p.lastName === null && p.firstName === null) return fr.agenda.patientNonRattache;
  return [p.lastName, p.firstName].filter(Boolean).join(" ");
}

export function ModalEncaissement({ paiement, onFermer, apresMutation }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [delaiEcoule, setDelaiEcoule] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [succes, setSucces] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const verrouRef = useRef(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    setDelaiEcoule(false);
    const t = setTimeout(() => setDelaiEcoule(true), DELAI_MS);
    return () => clearTimeout(t);
  }, [paiement.paymentId]);

  useEffect(() => {
    function esc(e: KeyboardEvent): void {
      if (e.key === "Escape") onFermer();
    }
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFermer]);

  async function encaisser(): Promise<void> {
    if (verrouRef.current || envoi || succes) return;
    verrouRef.current = true;
    setEnvoi(true);
    setErreur(undefined);
    const result = await recordPaymentCollected(paiement.paymentId);
    setEnvoi(false);
    verrouRef.current = false;

    if (!result.ok) {
      const estMontant = result.error.technical?.includes("payment") || result.error.message.includes("montant");
      setErreur(estMontant ? "Le montant ne se modifie pas à l'accueil." : result.error.message);
      return;
    }
    if (result.data === null) {
      // Hors fenêtre 24h ou déjà encaissé hors périmètre — ne pas mentir en succès
      setErreur(fr.reception.paiements.horsFenetre);
      apresMutation();
      return;
    }
    setSucces(true);
    apresMutation();
    setTimeout(() => onFermer(), 1200);
  }

  const confirmable = delaiEcoule && !envoi && !succes;

  return (
    <dialog
      ref={dialogRef}
      onClose={onFermer}
      onClick={(e) => {
        if (e.target === dialogRef.current) onFermer();
      }}
      className="m-auto max-w-form rounded-xl border border-rule bg-card p-0 shadow-lift3 backdrop:bg-voile"
      aria-label={fr.reception.paiements.confirmerTitre}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-ui text-heading font-semibold text-ink-900">{fr.reception.paiements.confirmerTitre}</h3>
          <button
            type="button"
            onClick={onFermer}
            aria-label={fr.jarvis.fermer}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sunken font-ui text-label text-ink-500 hover:bg-rule"
          >
            ✕
          </button>
        </div>

        {succes ? (
          <p role="status" className="rounded-md border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">
            ✓ {fr.reception.feedback.paiementEncaisse} — {fr.reception.paiements.recu} {paiement.receiptNumber}
          </p>
        ) : null}
        {erreur !== undefined ? (
          <BlocErreur
            message={erreur}
            action={
              !succes ? (
                <Bouton rang="principal" onClick={() => void encaisser()} disabled={envoi}>
                  {fr.actions.reessayer}
                </Bouton>
              ) : undefined
            }
          />
        ) : null}

        <dl className="m-0 grid gap-2 rounded-md border border-rule bg-sunken p-3">
          <Ligne libelle={fr.reception.paiements.patiente} valeur={identite(paiement)} />
          <Ligne libelle={fr.reception.paiements.recu} valeur={paiement.receiptNumber} />
          <Ligne libelle={fr.reception.paiements.montantAEncaisser} valeur={formaterDzd(paiement.amountDzd)} forte />
          <Ligne libelle={fr.reception.paiements.methode} valeur={fr.reception.paiements.methodeEspeces} />
          <Ligne libelle={fr.reception.paiements.praticienne} valeur={paiement.practitionerName ?? fr.etats.texteAbsent} />
        </dl>

        {!succes ? (
          <div className="flex justify-end gap-2">
            <Bouton rang="discret" onClick={onFermer} disabled={envoi}>
              {fr.actions.annuler}
            </Bouton>
            <Bouton rang="principal" onClick={() => void encaisser()} disabled={!confirmable} aria-disabled={!confirmable} aria-busy={envoi}>
              {envoi ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-respire rounded-full border-2 border-on-brand border-t-transparent" aria-hidden="true" />
                  {fr.etats.chargement}
                </span>
              ) : confirmable ? (
                `${fr.reception.paiements.encaisser} ${formaterDzd(paiement.amountDzd)}`
              ) : (
                fr.jarvis.carte.patienter
              )}
            </Bouton>
          </div>
        ) : null}
        {!confirmable && !succes && !envoi ? (
          <p className="text-right font-ui text-label text-ink-500" aria-live="polite">
            Disponible dans 0,4 s — anti-clic réflexe
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

function Ligne({ libelle, valeur, forte = false }: { readonly libelle: string; readonly valeur: string; readonly forte?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-ui text-label text-ink-500">{libelle}</dt>
      <dd className={["m-0 text-right", forte ? "font-num text-title font-semibold tabular-nums text-ink-900" : "font-ui text-body text-ink-900"].join(" ")}>
        {valeur}
      </dd>
    </div>
  );
}
