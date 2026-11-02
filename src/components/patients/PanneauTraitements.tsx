"use client";

/**
 * Le point d'entrée historique de l'onglet Traitements.
 *
 * La V2 du domaine (ADR-028) est désormais rendue par l'espace médicament
 * dédié. Ce fichier garde deux responsabilités, et rien de plus :
 *   1. brancher l'espace sur les données déjà chargées par la fiche patient ;
 *   2. conserver le repli lecture seule des dossiers qui n'ont que l'ancien
 *      résumé de prescription (contrat 1, avant 074).
 *
 * Aucune écriture ne vit ici : les portes versionnées sont dans les
 * sous-composants de `components/traitements/`.
 */

import { Badge, Carte, EtatVide } from "@/components/ui";
import { documentsEditor as documentsText } from "@/i18n/documents-editor";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

import { jourLong } from "./format";
import { EspaceTraitements } from "@/components/traitements/EspaceTraitements";

export function PanneauTraitements({
  traitements,
  traitementsV2,
  patientId,
  consultationId = null,
  onRefresh,
}: {
  readonly traitements: PatientWorkspace["traitements"];
  readonly traitementsV2?: PatientWorkspace["traitementsV2"] | null;
  readonly patientId: string;
  /** Rattaché à la séance ouverte quand l'onglet est rendu dans une consultation. */
  readonly consultationId?: string | null;
  readonly onRefresh?: () => void;
}): React.JSX.Element {
  if (traitementsV2 !== null && traitementsV2 !== undefined) {
    return (
      <EspaceTraitements
        patientId={patientId}
        initial={traitementsV2}
        consultationId={consultationId}
        {...(onRefresh === undefined ? {} : { onRefresh })}
      />
    );
  }

  const derniere = traitements?.dernierePrescription ?? null;
  const autres = (traitements?.nombrePrescriptions ?? 0) - 1;
  if (derniere === null) return <EtatVide message={fr.patients.vide.prescriptions} icone="traitements" />;

  return (
    <div className="flex flex-col gap-6">
      <Carte niveau="clinique">
        <div className="p-4">
          <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">
            {fr.patients.sections.dernierePrescription}
          </h2>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-ui text-body text-ink-700">
                {jourLong(derniere.prescribedAt) ?? fr.etats.texteAbsent}
                {derniere.practitionerName ? ` · ${derniere.practitionerName}` : ""}
              </span>
              {derniere.documentStatus === "voided" ? (
                <Badge ton="neutre">{documentsText.voided}</Badge>
              ) : null}
              {derniere.isHandwritten ? <Badge ton="neutre">{fr.patients.traitements.manuscrite}</Badge> : null}
            </div>
            <ul className="m-0 list-none p-0">
              {derniere.lignes.map((l) => (
                <li key={l.id} className="flex min-w-0 flex-col gap-1 border-b border-rule py-3 last:border-b-0">
                  <span className="break-words font-ui text-body font-medium text-ink-900">
                    {l.designation ?? fr.etats.texteAbsent}
                  </span>
                  <span className="font-ui text-label tracking-label text-ink-500">
                    {[
                      l.dose,
                      l.frequencyPerDay ? `${String(l.frequencyPerDay)} ${fr.patients.traitements.parJour}` : null,
                      l.durationDays ? `${fr.patients.traitements.duree} ${String(l.durationDays)} ${fr.patients.traitements.jours}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {l.instructions ? (
                    <span className="break-words font-ui text-notes text-ink-700">{l.instructions}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Carte>
      {autres > 0 ? (
        <p className="font-ui text-body text-ink-500">{fr.patients.traitements.autresPrescriptions(autres)}</p>
      ) : null}
    </div>
  );
}
