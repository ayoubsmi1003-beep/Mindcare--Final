"use client";

import { Bouton, IndicateurEnregistrement } from "@/components/ui";
import { fr } from "@/i18n/fr";

/**
 * La barre de séance V11 — sticky SANS recouvrement, 3 zones resserrées.
 *
 * `top-2` + sections cibles en `scroll-mt-28` : la barre ne masque plus les
 * titres scrollés dessous. Zone 2 porte le tarif INLINE (slot `tarifInline`)
 * quand la page le fournit, sinon repli texte `Voir` vers le bloc bas.
 * Même logique métier, même `clore`/`viderLesAttentes`.
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
  tarifInline,
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
  readonly tarifInline?: React.ReactNode;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  const puces = [
    { libelle: fr.consultation.notesBrutes, fait: notesRenseignees },
    { libelle: fr.consultation.assessment, fait: evaluationRenseignee },
    { libelle: fr.consultation.plan, fait: conduiteRenseignee },
  ];
  const avancement = puces.filter((p) => p.fait).length;

  return (
    <div
      role="region"
      aria-label={cockpit.progressionTitre}
      className="sticky top-2 z-panneau rounded-2xl border border-action-100 bg-card/95 px-4 py-2.5 shadow-elevee backdrop-blur-glass"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Zone 1 — progression : compacte, comptée, lisible */}
        <ul
          aria-label={cockpit.progressionTitre}
          className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0"
        >
          {puces.map((puce) => (
            <li
              key={puce.libelle}
              title={puce.libelle}
              className={[
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-ui text-label",
                puce.fait
                  ? "bg-action-100 font-semibold text-action-900"
                  : "bg-layer-surface font-medium text-ink-500",
              ].join(" ")}
            >
              <span aria-hidden="true">{puce.fait ? "✓" : "○"}</span>
              <span className="max-w-28 truncate">{puce.libelle}</span>
            </li>
          ))}
          <li
            aria-hidden="true"
            className="font-ui text-label font-bold tabular-nums text-ink-500"
          >
            {avancement}/3
          </li>
        </ul>
        <span className="hidden h-5 w-px bg-rule tablet:block" aria-hidden="true" />
        {/* Zone 2 — état + tarif inline */}
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <IndicateurEnregistrement
            etat={etatBrut === "repos" ? etatSoap : etatBrut}
            {...(heureBrut === undefined && heureSoap === undefined
              ? {}
              : { horodatage: heureBrut ?? heureSoap ?? "" })}
          />
          {tarifInline ?? (
            tarifFixe === undefined ? null : (
              <button
                type="button"
                onClick={voirTarif}
                title={tarifFixe ? cockpit.tarifFixe : cockpit.tarifManquant}
                className={[
                  "inline-flex min-h-target items-center gap-1.5 truncate rounded-full border px-3 py-1",
                  "font-ui text-label font-semibold tabular-nums",
                  "transition duration-quick ease-out",
                  "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                  tarifFixe
                    ? "border-rule bg-layer-surface text-ink-900"
                    : "border-attention bg-attention-bg text-attention-ink",
                ].join(" ")}
              >
                <span aria-hidden="true" className="shrink-0">{tarifFixe ? "✓" : "○"}</span>
                <span className="truncate">{tarifFixe ? cockpit.tarifFixe : cockpit.tarifManquant}</span>
                <span className="shrink-0 font-medium opacity-70">{cockpit.tarifVoir}</span>
              </button>
            )
          )}
        </span>
        {/* Zone 3 — primaire : gestes qui décident */}
        <span className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
          <Bouton rang="secondaire" taille="compact" onClick={enregistrer} disabled={envoi}>
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
