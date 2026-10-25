"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Bouton, PanneauInfo } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { frConsultationCockpit } from "@/i18n/consultation-cockpit";
import {
  apercuScore,
  enregistrerEchelle,
  type AdministrationEchelle,
  type ApercuEchelle,
  type EchelleDisponible,
  type EchelleItem,
} from "@/services/scales";

/**
 * La feuille de saisie d'une échelle — un dialogue natif, un item à la fois
 * dans le flux, une revue avant enregistrement.
 *
 * ⚠️ LE SCORE N'EST PAS CALCULÉ ICI. « Vérifier » appelle
 * `preview_scale_score` (calcul SQL), et « Enregistrer » appelle
 * `record_scale_administration` (validation + calcul + écriture + audit). Si
 * l'aperçu échoue, on ne propose pas d'enregistrer : un total affiché par le
 * navigateur ne doit jamais devenir un total au dossier.
 *
 * Aucune réponse n'est pré-cochée. Une échelle non administrée reste
 * « non mesurée » ; elle ne vaut pas zéro.
 */
export function FeuilleEchelle({
  scale,
  patientId,
  consultationId,
  onFermer,
  onEnregistre,
}: {
  readonly scale: EchelleDisponible;
  readonly patientId: string;
  readonly consultationId: string;
  readonly onFermer: () => void;
  readonly onEnregistre: (administration: AdministrationEchelle) => void;
}): React.JSX.Element {
  const textes = frConsultationCockpit.echelles;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titreId = useId();
  const aideId = useId();
  const [step, setStep] = useState<"saisie" | "revue">("saisie");
  const [reponses, setReponses] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {};
    for (const item of scale.items) initial[item.id] = null;
    return initial;
  });
  const [apercu, setApercu] = useState<ApercuEchelle | null>(null);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => {
        dialog.querySelector<HTMLInputElement>("input[type=radio]")?.focus();
      });
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const repondus = Object.values(reponses).filter((v) => v !== null).length;
  const manquante = scale.items.find((item) => reponses[item.id] == null);

  function reponsesCompletes(): Record<string, number> | null {
    if (manquante !== undefined) return null;
    const sortie: Record<string, number> = {};
    for (const item of scale.items) {
      const valeur = reponses[item.id];
      if (valeur === null || valeur === undefined) return null;
      sortie[item.id] = valeur;
    }
    return sortie;
  }

  function fermer(): void {
    if (envoi) return;
    const modifie = Object.values(reponses).some((v) => v !== null);
    if (modifie && !window.confirm(textes.fermerSansEnregistrer)) return;
    onFermer();
  }

  async function verifier(): Promise<void> {
    setErreur(undefined);
    const completes = reponsesCompletes();
    if (completes === null || manquante !== undefined) {
      setErreur(textes.reponsesManquantes);
      document.getElementById(`echelle-item-${scale.code}-${manquante?.id ?? ""}`)?.focus();
      return;
    }
    setEnvoi(true);
    const resultat = await apercuScore(scale.code, completes);
    setEnvoi(false);
    if (!resultat.ok) {
      setErreur(resultat.error.message);
      return;
    }
    if (resultat.data === null) {
      setErreur(textes.seanceClosee);
      return;
    }
    setApercu(resultat.data);
    setStep("revue");
  }

  async function enregistrer(): Promise<void> {
    setErreur(undefined);
    const completes = reponsesCompletes();
    if (completes === null || apercu === null) {
      setErreur(textes.reponsesManquantes);
      return;
    }
    setEnvoi(true);
    const resultat = await enregistrerEchelle({
      patientId,
      consultationId,
      code: scale.code,
      responses: completes,
    });
    setEnvoi(false);
    if (!resultat.ok) {
      setErreur(resultat.error.message);
      return;
    }
    if (resultat.data === null) {
      setErreur(textes.seanceClosee);
      return;
    }
    onEnregistre(resultat.data);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titreId}
      aria-describedby={aideId}
      onCancel={(event) => {
        event.preventDefault();
        fermer();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) fermer();
      }}
      className="m-0 ms-auto h-auto max-h-full w-full max-w-xl overflow-hidden border-0 border-s border-rule bg-card p-0 shadow-elevee"
    >
      <div className="flex max-h-full min-h-0 flex-col">
        <header className="flex flex-col gap-1 border-b border-rule px-5 py-4">
          <p className="m-0 font-ui text-label font-semibold uppercase tracking-label text-action-700">
            {fr.consultation.cockpit.echellesTitre}
          </p>
          <h2 id={titreId} className="m-0 font-ui text-title font-bold text-ink-900">
            {scale.nom}
          </h2>
          <p id={aideId} className="m-0 font-ui text-label text-ink-700">
            {scale.scoring.consigne}
          </p>
          <p className="m-0 font-ui text-label font-semibold tabular-nums text-ink-500">
            {step === "saisie"
              ? textes.progression(repondus, scale.items.length)
              : textes.revueTitre}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {erreur === undefined ? null : (
            <div className="mb-3">
              <PanneauInfo ton="attention">{erreur}</PanneauInfo>
            </div>
          )}

          {step === "saisie" ? (
            <div className="flex flex-col gap-5">
              {scale.items.map((item) => (
                <LigneItem
                  key={item.id}
                  scaleCode={scale.code}
                  item={item}
                  valeur={reponses[item.id] ?? null}
                  disabled={envoi}
                  onChange={(valeur) =>
                    setReponses((courant) => ({ ...courant, [item.id]: valeur }))
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <ul className="m-0 flex list-none flex-col divide-y divide-rule p-0">
                {scale.items.map((item) => {
                  const valeur = reponses[item.id];
                  const option = item.options.find((o) => o.valeur === valeur);
                  return (
                    <li key={item.id} className="flex flex-col gap-1 py-3 first:pt-0">
                      <span className="font-ui text-label font-medium text-ink-700">{item.texte}</span>
                      <span className="font-ui text-body font-semibold text-ink-900">
                        {option?.libelle ?? fr.etats.texteAbsent}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {apercu === null ? null : (
                <div className="flex flex-col gap-2 rounded-xl border border-rule bg-layer-surface px-4 py-3">
                  <p className="m-0 font-ui text-label font-medium text-ink-500">
                    {textes.scoreCalcule}
                  </p>
                  <p className="m-0 font-ui text-title font-bold tabular-nums text-ink-900">
                    {textes.scoreSur(apercu.total, scale.scoring.max)}
                  </p>
                  <p className="m-0 font-ui text-body font-semibold text-ink-900">
                    {apercu.interpretation}
                  </p>
                  <p className="m-0 font-ui text-label text-ink-700">{apercu.note}</p>
                </div>
              )}

              {apercu?.alertes.map((alerte) => (
                <PanneauInfo key={alerte.itemId} ton="attention" titre={textes.alertesTitre}>
                  {alerte.message}
                </PanneauInfo>
              ))}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-4">
          <Bouton rang="discret" onClick={fermer} disabled={envoi}>
            {fr.actions.annuler}
          </Bouton>
          {step === "saisie" ? (
            <Bouton rang="principal" onClick={() => void verifier()} disabled={envoi}>
              {textes.verifier}
            </Bouton>
          ) : (
            <>
              <Bouton
                rang="secondaire"
                onClick={() => {
                  setApercu(null);
                  setErreur(undefined);
                  setStep("saisie");
                }}
                disabled={envoi}
              >
                {textes.modifier}
              </Bouton>
              <Bouton rang="principal" onClick={() => void enregistrer()} disabled={envoi}>
                {textes.enregistrer}
              </Bouton>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function LigneItem({
  scaleCode,
  item,
  valeur,
  disabled,
  onChange,
}: {
  readonly scaleCode: string;
  readonly item: EchelleItem;
  readonly valeur: number | null;
  readonly disabled: boolean;
  readonly onChange: (valeur: number) => void;
}): React.JSX.Element {
  return (
    <fieldset
      id={`echelle-item-${scaleCode}-${item.id}`}
      tabIndex={-1}
      className="flex flex-col gap-2 border-0 p-0"
    >
      <legend className="p-0 font-ui text-body font-semibold text-ink-900">{item.texte}</legend>
      <div className="grid grid-cols-1 gap-2 tablet:grid-cols-2">
        {item.options.map((option) => {
          const choisi = valeur === option.valeur;
          return (
            <label
              key={option.valeur}
              className={[
                "flex min-h-target cursor-pointer items-center gap-2 rounded-lg border px-3 py-2",
                "font-ui text-body",
                "transition duration-quick ease-out",
                "focus-within:outline focus-within:outline-action-600 focus-within:outline-offset",
                choisi
                  ? "border-action-600 bg-action-100 font-semibold text-ink-900"
                  : "border-rule bg-card text-ink-700 hover:border-action-600",
                disabled ? "cursor-not-allowed opacity-60" : "",
              ].join(" ")}
            >
              <input
                type="radio"
                name={`${scaleCode}-${item.id}`}
                value={option.valeur}
                checked={choisi}
                disabled={disabled}
                onChange={() => onChange(option.valeur)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={[
                  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  choisi ? "border-action-600 bg-action-600" : "border-ink-300 bg-card",
                ].join(" ")}
              >
                {choisi ? <span className="h-1.5 w-1.5 rounded-full bg-card" /> : null}
              </span>
              <span>{option.libelle}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
