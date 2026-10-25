"use client";

import { Badge, Bouton, Icone, PastilleIcone } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

import { jourEtHeure } from "./format";

/**
 * Le profil clinique compact, posé à droite de la synthèse.
 *
 * Il ne répète pas le texte : il donne les repères structurés (diagnostics,
 * traitement, échelles) que la praticienne vérifie des yeux avant de lire.
 * Aucune donnée n'est déduite : tout vient du workspace déjà chargé.
 */
export function PatientProfilClinique({
  espace,
  onOuvrirClinique,
}: {
  readonly espace: PatientWorkspace;
  readonly onOuvrirClinique: () => void;
}): React.JSX.Element {
  const clinique = espace.clinique;
  if (clinique === null) return <></>;

  const actifs = clinique.diagnostics.filter((diagnostic) => diagnostic.resolvedAt === null);
  const traitements = espace.traitementsV2?.actifs ?? [];
  const echelles = clinique.echelles.slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <PastilleIcone nom="patients" ton="action" />
        <h3 className="m-0 font-ui text-label font-semibold uppercase tracking-label text-ink-500">
          Profil clinique
        </h3>
      </div>

      <section className="flex flex-col gap-2">
        <span className="font-ui text-label font-medium text-ink-500">Diagnostics actifs</span>
        {actifs.length === 0 ? (
          <p className="m-0 font-ui text-label text-ink-700">Aucun diagnostic actif consigné.</p>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {actifs.map((diagnostic) => (
              <li key={diagnostic.id}>
                <Badge ton={diagnostic.isPrimary ? "information" : "neutre"}>{diagnostic.label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <span className="font-ui text-label font-medium text-ink-500">Traitement actuel</span>
        {traitements.length === 0 ? (
          <p className="m-0 font-ui text-label text-ink-700">Aucun traitement actif.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {traitements.slice(0, 3).map((traitement) => (
              <li key={traitement.id} className="flex min-w-0 flex-col">
                <span className="truncate font-ui text-label font-semibold text-ink-900">
                  {traitement.brandName ?? traitement.medicationRaw ?? traitement.inn ?? fr.etats.texteAbsent}
                </span>
                <span className="font-ui text-label tabular-nums text-ink-500">
                  {[traitement.dose, traitement.doseUnit, traitement.frequency].filter((part) => part !== null && part !== "").join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <span className="font-ui text-label font-medium text-ink-500">Dernières évaluations</span>
        {echelles.length === 0 ? (
          <p className="m-0 font-ui text-label text-ink-700">Aucune évaluation enregistrée.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {echelles.map((echelle) => (
              <li key={echelle.scaleCode} className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-ui text-label text-ink-700">{echelle.scaleName}</span>
                <span className="shrink-0 font-ui text-label font-semibold tabular-nums text-ink-900">
                  {echelle.dernier.score ?? fr.etats.texteAbsent}
                  <span className="ml-1 font-normal text-ink-500">{jourEtHeure(echelle.dernier.date) ?? ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div>
        <Bouton rang="discret" taille="compact" onClick={onOuvrirClinique}>
          <span className="inline-flex items-center gap-2">
            {fr.patients.onglets.clinique}
            <Icone nom="chevron" taille={16} />
          </span>
        </Bouton>
      </div>
    </div>
  );
}
