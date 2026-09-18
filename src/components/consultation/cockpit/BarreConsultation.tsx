"use client";

import { Bouton, IndicateurEnregistrement } from "@/components/ui";
import { fr } from "@/i18n/fr";

/**
 * La barre de séance — haute, sticky, en 3 zones distinctes (V10).
 *
 * En haut sous les onglets (plus jamais en bas qui masquait la note) :
 * zone nav (puces ✓/○ + indicateur), zone primaire (Enregistrer + Terminer),
 * zone secondaire (tarif Voir). Même logique métier, même `clore`/`viderLesAttentes`.
 */
export function BarreConsultation({
  etatBrut,
  etatSoap,
  heureBrut,
  heureSoap,
  notesRenseignees,
  evaluationRenseignee,
  conduiteRenseignee,
  tarifFixe,
  peutClore,
  envoi,
  enregistrer,
  clore,
  voirTarif,
}: {
  readonly etatBrut: "repos" | "encours" | "enregistre" | "echec";
  readonly etatSoap: "repos" | "encours" | "enregistre" | "echec";
  readonly heureBrut: string | undefined;
  readonly heureSoap: string | undefined;
  readonly notesRenseignees: boolean;
  readonly evaluationRenseignee: boolean;
  readonly conduiteRenseignee: boolean;
  readonly tarifFixe: boolean | undefined;
  readonly peutClore: boolean;
  readonly envoi: boolean;
  readonly enregistrer: () => void;
  readonly clore: () => void;
  readonly voirTarif: () => void;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  const puces = [
    { libelle: fr.consultation.notesBrutes, fait: notesRenseignees },
    { libelle: fr.consultation.assessment, fait: evaluationRenseignee },
    { libelle: fr.consultation.plan, fait: conduiteRenseignee },
  ];

  return (
    <div
      role="region"
      aria-label={fr.actions.terminerLaSeance}
      className="sticky top-4 z-panneau rounded-2xl border border-rule bg-card px-5 py-3 shadow-carte backdrop-blur-glass"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* Zone 1 — navigation : où en est la note */}
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
          {puces.map((puce) => (
            <li
              key={puce.libelle}
              className={[
                "flex items-center gap-1.5 font-ui text-label",
                puce.fait ? "font-semibold text-ink-900" : "text-ink-500",
              ].join(" ")}
            >
              <span aria-hidden="true">{puce.fait ? "✓" : "○"}</span>
              <span>{puce.libelle}</span>
            </li>
          ))}
        </ul>
        <span className="hidden h-5 w-px bg-rule tablet:block" aria-hidden="true" />
        {/* Zone 2 — secondaire : état + tarif */}
        <span className="flex min-w-0 flex-wrap items-center gap-3">
          <IndicateurEnregistrement
            etat={etatBrut === "repos" ? etatSoap : etatBrut}
            {...(heureBrut === undefined && heureSoap === undefined
              ? {}
              : { horodatage: heureBrut ?? heureSoap ?? "" })}
          />
          {tarifFixe === undefined ? null : (
            <button
              type="button"
              onClick={voirTarif}
              title={tarifFixe ? cockpit.tarifFixe : cockpit.tarifManquant}
              className={[
                "inline-flex min-h-target items-center gap-1.5 truncate rounded-lg px-2 py-1",
                "font-ui text-label font-semibold tabular-nums",
                "transition duration-quick ease-out",
                "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                tarifFixe ? "text-ink-900" : "text-attention-ink",
              ].join(" ")}
            >
              <span aria-hidden="true" className="shrink-0">{tarifFixe ? "✓" : "○"}</span>
              <span className="truncate">{tarifFixe ? cockpit.tarifFixe : cockpit.tarifManquant}</span>
              <span className="shrink-0 font-medium text-ink-500">{cockpit.tarifVoir}</span>
            </button>
          )}
        </span>
        {/* Zone 3 — primaire : gestes qui décident */}
        <span className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
          <Bouton rang="discret" taille="compact" onClick={enregistrer} disabled={envoi}>
            {fr.actions.enregistrer}
          </Bouton>
          {peutClore ? (
            <Bouton rang="principal" taille="compact" onClick={clore} disabled={envoi}>
              {fr.actions.terminerLaSeance}
            </Bouton>
          ) : null}
        </span>
      </div>
    </div>
  );
}
