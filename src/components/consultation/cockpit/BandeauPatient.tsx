"use client";

import { heure } from "@/components/AgendaPieces";
import { fr } from "@/i18n/fr";
import { frConsultationCockpit } from "@/i18n/consultation-cockpit";
import { dateCivile, sexeLisible } from "@/components/patients/format";
import type { PatientWorkspace } from "@/services/patients";

/**
 * Le contexte patient de la séance, sur UNE bande.
 *
 * Le nom vit dans la barre supérieure (`AppShell`), le type et la date dans
 * `CockpitHeader` : les répéter ici fabriquerait trois fois la même identité.
 * Cette bande porte ce qu'aucun de ces deux endroits ne dit — l'âge, le sexe,
 * le numéro de dossier, le nombre de séances, les diagnostics actifs et le
 * prochain rendez-vous — sans troncature : un libellé de diagnostic coupé
 * (« Trouble anxieux généra… ») ne se lit pas.
 */
export function BandeauPatient({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const { identite, clinique } = espace;
  const prochain = espace.agenda.prochainRendezVous;
  const civilite = [
    identite.age === null ? null : `${String(identite.age)} ${fr.patients.ageAnnees}`,
    sexeLisible(identite.sex),
  ]
    .filter((m): m is string => m !== null && m !== "")
    .join(" · ");

  const prochainTexte =
    prochain === null
      ? null
      : [
          dateCivile(prochain.startsAt.slice(0, 10)) ?? prochain.startsAt.slice(0, 10),
          heure(prochain.startsAt),
          prochain.kind,
        ]
          .filter((m): m is string => m !== null && m !== "")
          .join(" · ");

  return (
    <section
      aria-label={fr.consultation.cockpit.patientTitre}
      className="flex flex-col gap-3 rounded-2xl border border-rule bg-card px-4 py-3 shadow-douce"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        {civilite === "" ? null : (
          <p className="m-0 font-ui text-body font-semibold text-ink-900">{civilite}</p>
        )}
        <p className="m-0 font-ui text-label tabular-nums text-ink-500">
          {fr.patients.numeroDossier} · {identite.recordNumber}
          {clinique === null ? null : ` · ${frConsultationCockpit.consultations(clinique.nombreConsultations)}`}
        </p>
        <p className="m-0 font-ui text-label tabular-nums text-ink-500">
          {prochain === null
            ? fr.consultation.cockpit.sansProchain
            : `${frConsultationCockpit.prochainRdv} · ${prochainTexte ?? ""}`}
        </p>
      </div>

      {clinique === null ? (
        <p className="m-0 font-ui text-label text-ink-500">
          {frConsultationCockpit.reperes.cliniqueIndisponible}
        </p>
      ) : clinique.diagnostics.length === 0 ? (
        <p className="m-0 font-ui text-label text-ink-500">{frConsultationCockpit.aucunDiagnostic}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {clinique.diagnostics.map((d) => (
            <li
              key={d.id}
              title={d.isPrimary ? fr.consultation.cockpit.diagnosticPrincipal : undefined}
              className={[
                "inline-flex max-w-full items-center rounded-full border px-2.5 py-1",
                "font-ui text-label font-medium",
                d.isPrimary
                  ? "border-action-100 bg-action-50 text-action-900"
                  : "border-rule bg-layer-surface text-ink-700",
              ].join(" ")}
            >
              {d.isPrimary ? (
                <span aria-hidden="true" className="mr-1.5 shrink-0">
                  ●
                </span>
              ) : null}
              <span className="break-words">{d.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
