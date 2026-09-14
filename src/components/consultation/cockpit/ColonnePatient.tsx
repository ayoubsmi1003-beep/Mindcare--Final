"use client";

import { heure, jourComplet } from "@/components/AgendaPieces";
import { Avatar } from "@/components/ui/Avatar";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

import { dateCivile, sexeLisible } from "@/components/patients/format";

/**
 * La colonne patient — QUI voit-on, et que faut-il retenir ?
 *
 * Compacte et lisible en un coup d'œil : monogramme (jamais de photo —
 * une photographie est une donnée identifiante 18-07 sans stockage prévu),
 * état civil, diagnostics réels, prochain rendez-vous. Les sections sans
 * contenu n'apparaissent pas : un vide honnête vaut mieux qu'un remplissage.
 */
export function ColonnePatient({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const { identite, clinique } = espace;
  const prochain = espace.agenda.prochainRendezVous;
  const notesAdmin = espace.admin.notesAdmin;

  const civilite = [
    identite.age === null ? null : `${String(identite.age)} ${fr.patients.ageAnnees}`,
    sexeLisible(identite.sex),
  ]
    .filter((m): m is string => m !== null)
    .join(" · ");

  return (
    <aside
      aria-label={cockpit.patientTitre}
      className="flex w-full flex-col gap-5 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex items-start gap-4">
        <Avatar prenom={identite.firstName} nom={identite.lastName} taille="grande" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate font-ui text-heading font-bold text-ink-900">
            {identite.firstName} {identite.lastName}
          </p>
          {civilite === "" ? null : (
            <p className="font-ui text-label tabular-nums text-ink-500">{civilite}</p>
          )}
          <p className="font-ui text-label tabular-nums text-ink-500">
            {fr.patients.numeroDossier} · {identite.recordNumber}
          </p>
          {clinique === null ? null : (
            <p className="font-ui text-label tabular-nums text-ink-500">
              {clinique.nombreConsultations}{" "}
              {clinique.nombreConsultations >= 2 ? "consultations" : "consultation"}
            </p>
          )}
        </div>
      </div>

      {clinique !== null && clinique.diagnostics.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-rule pt-4">
          <p className="font-ui text-label font-semibold uppercase tracking-label text-ink-500">
            {cockpit.diagnosticsTitre}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {clinique.diagnostics.map((d) => (
              <li
                key={d.id}
                className={[
                  "inline-flex min-h-target items-center rounded-full border px-3 py-1",
                  "font-ui text-label font-medium",
                  d.isPrimary
                    ? "border-action-100 bg-action-50 text-action-900"
                    : "border-rule bg-card text-ink-700",
                ].join(" ")}
              >
                {d.label}
                {d.isPrimary ? (
                  <span className="ml-2 font-ui text-label text-ink-500">
                    {cockpit.diagnosticPrincipal}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <p className="font-ui text-label font-semibold uppercase tracking-label text-ink-500">
          {cockpit.prochainTitre}
        </p>
        {prochain === null ? (
          <p className="font-ui text-body text-ink-500">{cockpit.sansProchain}</p>
        ) : (
          <div className="flex flex-col">
            <span className="font-ui text-body font-semibold tabular-nums text-ink-900">
              {jourComplet(prochain.startsAt) ?? dateCivile(prochain.startsAt.slice(0, 10)) ?? ""}
              {heure(prochain.startsAt) === null ? "" : ` · ${heure(prochain.startsAt)}`}
            </span>
            {prochain.kind === null ? null : (
              <span className="font-ui text-label text-ink-500">{prochain.kind}</span>
            )}
          </div>
        )}
      </div>

      {notesAdmin !== null && notesAdmin.trim() !== "" ? (
        <div className="flex flex-col gap-2 border-t border-rule pt-4">
          <p className="font-ui text-label font-semibold uppercase tracking-label text-ink-500">
            {fr.patients.notesAdministratives}
          </p>
          <p className="break-words font-ui text-body text-ink-700">{notesAdmin}</p>
        </div>
      ) : null}
    </aside>
  );
}
