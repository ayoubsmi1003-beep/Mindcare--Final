"use client";

import { Bouton, IndicateurEnregistrement } from "@/components/ui";
import { fr } from "@/i18n/fr";

/**
 * La barre de fin de séance — flottante, unique lieu de clôture.
 *
 * En flux (pas en surimpression) : collante pendant le défilement, posée à
 * la fin du contenu — elle ne masque jamais la note en cours de rédaction.
 * Puces d'avancement (texte + état, jamais couleur seule), état
 * d'enregistrement, rappel tarif (PRÉSENCE seule : le montant vit dans
 * `BlocTarif`), `[Enregistrer]` (flush explicite des minuteurs via
 * `viderLesAttentes`) et `[Terminer la séance]` (même `clore`). Le bouton
 * de clôture n'existe qu'ici : un seul geste pour une seule issue, et c'est
 * la seule action principale de la barre.
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
      className="sticky bottom-4 z-panneau rounded-2xl border border-rule bg-card px-5 py-3 shadow-elevee"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              {puce.libelle}
            </li>
          ))}
        </ul>
        <span className="flex items-center gap-3">
          <IndicateurEnregistrement
            etat={etatBrut === "repos" ? etatSoap : etatBrut}
            {...(heureBrut === undefined && heureSoap === undefined
              ? {}
              : { horodatage: heureBrut ?? heureSoap ?? "" })}
          />
        </span>
        {tarifFixe === undefined ? null : (
          <button
            type="button"
            onClick={voirTarif}
            className={[
              "inline-flex min-h-target items-center gap-1.5 rounded-lg px-2 py-1",
              "font-ui text-label font-semibold tabular-nums",
              "transition duration-quick ease-out",
              "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
              tarifFixe ? "text-ink-900" : "text-attention-ink",
            ].join(" ")}
          >
            <span aria-hidden="true">{tarifFixe ? "✓" : "○"}</span>
            {tarifFixe ? cockpit.tarifFixe : cockpit.tarifManquant}
            <span className="font-medium text-ink-500">{cockpit.tarifVoir}</span>
          </button>
        )}
        {/* UN SEUL GESTE PRINCIPAL : `Signer`/`Terminer` décide, `Enregistrer`
            n'est qu'un flush explicite de l'autosave — rang discret pour ne
            jamais concurrencer l'action juridique. */}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <Bouton rang="discret" onClick={enregistrer} disabled={envoi}>
            {fr.actions.enregistrer}
          </Bouton>
          {peutClore ? (
            <Bouton rang="principal" onClick={clore} disabled={envoi}>
              {fr.actions.terminerLaSeance}
            </Bouton>
          ) : null}
        </span>
      </div>
    </div>
  );
}
