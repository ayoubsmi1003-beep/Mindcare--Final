"use client";

import { useCallback, useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  formaterDzd,
  getConsultationPayment,
  montantModifiable,
  setConsultationPrice,
} from "@/services/finance";

/**
 * Tarif INLINE de la barre de séance V11 — un champ, un bouton, un état.
 *
 * Même portes que `BlocTarif` (`getConsultationPayment`, `setConsultationPrice`,
 * `integer amount_dzd`), même signal `onEtatTarif` vers la page (037 refuse de
 * clore sans ligne de paiement). Aucune décision ici : `montantModifiable`
 * dit ce qu'on montre, la porte 029 dit ce que la base permet.
 * `compact` ne change que la densité, jamais la règle.
 */
export function TarifInline({
  consultationId,
  onEtatTarif,
}: {
  readonly consultationId: string;
  readonly onEtatTarif?: (present: boolean | undefined) => void;
}): React.JSX.Element {
  const [montant, setMontant] = useState<number | null | undefined>(undefined);
  const [recu, setRecu] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);

  const charger = useCallback(async () => {
    const result = await getConsultationPayment(consultationId);
    if (!result.ok) {
      setMontant(null);
      setErreur(result.error.message);
      onEtatTarif?.(undefined);
      return;
    }
    setErreur(undefined);
    setMontant(result.data === null ? null : result.data.montantDzd);
    setRecu(result.data?.receiptNumber ?? null);
    setSaisie(result.data === null ? "" : String(result.data.montantDzd));
    onEtatTarif?.(result.data !== null);
  }, [consultationId, onEtatTarif]);

  useEffect(() => {
    void charger();
  }, [charger]);

  const fixer = useCallback(async () => {
    setErreur(undefined);
    const valeur = Number.parseInt(saisie, 10);
    if (!Number.isFinite(valeur) || valeur < 0) {
      setErreur(fr.consultation.cockpit.tarifSaisieIndication);
      return;
    }
    setEnvoi(true);
    const result = await setConsultationPrice(consultationId, valeur);
    setEnvoi(false);
    if (!result.ok) {
      setErreur(result.error.message);
      void charger();
      return;
    }
    if (result.data === null) {
      setErreur(fr.finances.tarifSeanceIntrouvable);
      return;
    }
    void charger();
  }, [charger, consultationId, saisie]);

  if (montant === undefined) {
    return (
      <span className="inline-flex items-center gap-2 font-ui text-label text-ink-500">
        <span aria-hidden="true" className="h-3.5 w-16 animate-respire rounded-full bg-sunken" />
        {fr.consultation.cockpit.tarifInlineTitre}…
      </span>
    );
  }

  if (montant !== null) {
    return (
      <span
        title={recu === null ? undefined : `${fr.finances.numeroRecu} ${recu}`}
        className="inline-flex min-h-target items-center gap-1.5 rounded-full border border-rule bg-layer-surface px-3 py-1 font-ui text-label font-semibold tabular-nums text-ink-900"
      >
        <span aria-hidden="true" className="text-positive">✓</span>
        <span>
          {formaterDzd(montant)} {fr.consultation.cockpit.tarifDevise}
        </span>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor="tarif-inline-saisie">
        {fr.consultation.cockpit.tarifInlineTitre} ({fr.consultation.cockpit.tarifDevise})
      </label>
      <input
        id="tarif-inline-saisie"
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void fixer();
        }}
        placeholder={fr.consultation.cockpit.tarifInlineTitre}
        disabled={envoi}
        className="h-9 w-24 rounded-lg border border-attention bg-card px-2.5 font-ui text-body font-semibold tabular-nums text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-500 focus-visible:outline focus-visible:outline-action-600"
      />
      <span aria-hidden="true" className="font-ui text-label font-medium text-ink-500">
        {fr.consultation.cockpit.tarifDevise}
      </span>
      <button
        type="button"
        onClick={() => void fixer()}
        disabled={envoi || saisie.trim() === ""}
        className="inline-flex h-9 items-center rounded-full bg-action-600 px-3.5 font-ui text-label font-bold text-on-brand shadow-douce transition duration-quick ease-out hover:bg-action-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {fr.actions.fixerLeTarif}
      </button>
      {erreur === undefined ? null : (
        <span role="alert" className="font-ui text-label font-medium text-attention-ink">
          {erreur}
        </span>
      )}
    </span>
  );
}

/** Re-export du prédicat métier pour la page (lecture seule -> même règle). */
export function tarifEstModifiable(
  paiement: Parameters<typeof montantModifiable>[0],
): boolean {
  return montantModifiable(paiement);
}
