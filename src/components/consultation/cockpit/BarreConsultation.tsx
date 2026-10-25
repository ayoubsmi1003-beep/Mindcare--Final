"use client";

import { Bouton, IndicateurEnregistrement } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { frConsultationCockpit } from "@/i18n/consultation-cockpit";

/**
 * La barre de séance — un état, un geste primaire, aucun doublon.
 *
 * V12 : les trois puces « Notes / Évaluation / Conduite » ne décrivaient que
 * trois des quatre rubriques SOAP, et le bouton « Appeler la secrétaire »
 * était le SECOND du même écran (la barre supérieure le porte déjà). Ici :
 *   · « Note clinique n/4 » compte les quatre rubriques réellement remplies ;
 *   · « Échelles n » mène à la section, jamais à une liste inventée ;
 *   · « Signature » dit l'état, et le geste primaire suit cet état :
 *     Signer tant que la note est un brouillon, Terminer une fois signée.
 *
 * `clore` reste disponible avant signature, mais en rang secondaire : la
 * séquence clinique est visible sans retirer un chemin que la base autorise.
 */
export function BarreConsultation({
  etatBrut,
  etatSoap,
  heureBrut,
  heureSoap,
  soapRemplis,
  soapTotal,
  echellesCount,
  noteSignee,
  noteVide,
  seanceClose,
  tarifFixe,
  peutClore,
  envoi,
  enregistrer,
  signer,
  clore,
  voirTarif,
  onVoirEchelles,
  tarifInline,
}: {
  readonly etatBrut: "repos" | "encours" | "enregistre" | "echec";
  readonly etatSoap: "repos" | "encours" | "enregistre" | "echec";
  readonly heureBrut: string | undefined;
  readonly heureSoap: string | undefined;
  readonly soapRemplis: number;
  readonly soapTotal: number;
  readonly echellesCount: number;
  readonly noteSignee: boolean;
  readonly noteVide: boolean;
  readonly seanceClose: boolean;
  readonly tarifFixe: boolean | undefined;
  readonly peutClore: boolean;
  readonly envoi: boolean;
  readonly enregistrer: () => void;
  readonly signer: () => void;
  readonly clore: () => void;
  readonly voirTarif: () => void;
  readonly onVoirEchelles: () => void;
  readonly tarifInline?: React.ReactNode;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const progression = frConsultationCockpit.progression;

  const classePuce =
    "inline-flex min-h-target items-center gap-1.5 rounded-full border px-2.5 py-1 font-ui text-label tabular-nums";

  return (
    <div
      role="region"
      aria-label={cockpit.progressionTitre}
      className="sticky top-2 z-panneau rounded-2xl border border-action-100 bg-card/95 px-4 py-2 shadow-elevee backdrop-blur-glass"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={[classePuce, "border-rule bg-layer-surface text-ink-700"].join(" ")}>
            <span className="font-semibold">{progression.note}</span>
            <span>
              {soapRemplis}/{soapTotal}
            </span>
          </span>

          <button
            type="button"
            onClick={onVoirEchelles}
            className={[
              classePuce,
              "border-rule bg-layer-surface text-ink-700",
              "outline-none hover:border-action-600 hover:text-action-900",
              "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
            ].join(" ")}
          >
            <span className="font-semibold">{progression.echelles}</span>
            <span>{echellesCount}</span>
          </button>

          <span
            className={[
              classePuce,
              noteSignee
                ? "border-positive bg-positive-bg text-positive"
                : "border-attention bg-attention-bg text-attention-ink",
            ].join(" ")}
          >
            <span className="font-semibold">{progression.signature}</span>
            <span>{noteSignee ? progression.signee : progression.nonSignee}</span>
          </span>

          {noteVide && !noteSignee ? (
            <span className="font-ui text-label font-semibold text-attention-ink">
              {progression.noteVide}
            </span>
          ) : null}
        </div>

        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <IndicateurEnregistrement
            etat={etatBrut === "repos" ? etatSoap : etatBrut}
            {...(heureBrut === undefined && heureSoap === undefined
              ? {}
              : { horodatage: heureBrut ?? heureSoap ?? "" })}
          />
          {tarifInline ?? (
            <button
              type="button"
              onClick={voirTarif}
              className={[
                "inline-flex min-h-target items-center gap-1.5 rounded-full border px-3 py-1",
                "font-ui text-label font-semibold tabular-nums",
                "transition duration-quick ease-out",
                "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                tarifFixe
                  ? "border-rule bg-layer-surface text-ink-900"
                  : "border-attention bg-attention-bg text-attention-ink",
              ].join(" ")}
            >
              <span aria-hidden="true" className="shrink-0">
                {tarifFixe ? "✓" : "○"}
              </span>
              <span className="truncate">
                {tarifFixe ? cockpit.tarifFixe : cockpit.tarifManquant}
              </span>
              <span className="shrink-0 font-medium opacity-70">{cockpit.tarifVoir}</span>
            </button>
          )}
        </span>

        {seanceClose ? null : (
        <span className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
          <Bouton
            rang="secondaire"
            taille="compact"
            onClick={enregistrer}
            disabled={envoi || seanceClose}
          >
            {fr.actions.enregistrer}
          </Bouton>
          {!noteSignee && !seanceClose ? (
            <Bouton
              rang="principal"
              taille="compact"
              onClick={signer}
              disabled={envoi || noteVide}
            >
              {fr.actions.signerLaNote}
            </Bouton>
          ) : null}
          {peutClore ? (
            <Bouton
              rang={noteSignee ? "principal" : "secondaire"}
              taille="compact"
              onClick={clore}
              disabled={envoi}
            >
              {fr.actions.terminerLaSeance}
            </Bouton>
          ) : null}
        </span>
        )}
      </div>
    </div>
  );
}
