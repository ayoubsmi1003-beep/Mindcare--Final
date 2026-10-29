"use client";

import { CarteDiagnostics } from "./CarteDiagnostics";
import { CarteEchelles } from "./CarteEchelles";
import { cliniqueUi } from "@/i18n/clinical-ui";
import type { PatientWorkspace } from "@/services/patients";

/**
 * L'état clinique — une seule surface, deux colonnes.
 *
 * Deux cartes indépendantes côte à côte ne tiennent pas leurs hauteurs : une
 * liste d'échelles longue étire un panneau de diagnostics vide, ou l'inverse.
 * Ici la surface est UNE carte ; le filet vertical sépare les deux lectures.
 * Les composants internes désactivent leur propre cadre (`encadre={false}`),
 * donc il n'y a ni carte dans la carte ni grand vide bordé.
 */
export function EtatClinique({
  clinique,
  patientId,
  onMisAJour,
}: {
  readonly clinique: NonNullable<PatientWorkspace["clinique"]>;
  readonly patientId: string;
  readonly onMisAJour?: () => void;
}): React.JSX.Element {
  return (
    <section
      aria-label={cliniqueUi.clinique.titre}
      className="rounded-3xl border border-rule bg-card shadow-carte"
    >
      <div className="grid gap-0 desktop:grid-cols-2">
        <div className="min-w-0 p-5 sm:p-6 desktop:sticky desktop:top-4 desktop:self-start">
          <CarteDiagnostics
            patientId={patientId}
            diagnostics={clinique.diagnostics}
            encadre={false}
            {...(onMisAJour === undefined ? {} : { onMisAJour })}
          />
        </div>
        <div className="min-w-0 border-t border-rule p-5 sm:p-6 desktop:border-s desktop:border-t-0">
          <CarteEchelles patientId={patientId} echelles={clinique.echelles} encadre={false} />
        </div>
      </div>
    </section>
  );
}

export function PanneauClinique({
  clinique,
  patientId,
  onMisAJour,
}: {
  readonly clinique: NonNullable<PatientWorkspace["clinique"]>;
  readonly patientId: string;
  readonly onMisAJour?: () => void;
}): React.JSX.Element {
  return (
    <section aria-labelledby="titre-etat-clinique" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="titre-etat-clinique" className="m-0 font-ui text-title font-bold tracking-title text-ink-900">{cliniqueUi.clinique.titre}</h2>
          <p className="m-0 font-ui text-label text-ink-500">{cliniqueUi.clinique.sousTitre}</p>
        </div>
      </div>
      <EtatClinique clinique={clinique} patientId={patientId} {...(onMisAJour === undefined ? {} : { onMisAJour })} />
    </section>
  );
}
