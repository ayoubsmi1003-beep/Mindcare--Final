"use client";

import { Carte, Icone } from "@/components/ui";
import { traitements as t } from "@/i18n/traitements";
import type {
  AdverseEvent,
  AllergyEvent,
  InteractionReview,
} from "@/services/medication-phase2";
import type { Treatment } from "@/services/patient-treatments";

import { PanneauAllergies } from "./PanneauAllergies";
import { PanneauEffetsIndesirables } from "./PanneauEffetsIndesirables";
import { PanneauInteractions } from "./PanneauInteractions";

export function SecuriteTraitements({
  patientId,
  consultationId,
  liste,
  allergies,
  effets,
  interactions,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly liste: readonly Treatment[];
  readonly allergies: readonly AllergyEvent[];
  readonly effets: readonly AdverseEvent[];
  readonly interactions: readonly InteractionReview[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  return (
    <section aria-labelledby="titre-securite-traitements" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-attention-bg text-attention-ink">
            <Icone nom="alerte" taille={20} />
          </span>
          <h2 id="titre-securite-traitements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
            {t.securite.titre}
          </h2>
        </div>
        <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
          {t.securite.sousTitre}
        </p>
      </div>

      <PanneauAllergies
        patientId={patientId}
        consultationId={consultationId}
        evenements={allergies}
        chargement={chargement}
        erreur={erreur}
        onChanged={onChanged}
        onReessayer={onReessayer}
      />

      <PanneauEffetsIndesirables
        patientId={patientId}
        consultationId={consultationId}
        liste={liste}
        evenements={effets}
        chargement={chargement}
        erreur={erreur}
        onChanged={onChanged}
        onReessayer={onReessayer}
      />

      <PanneauInteractions
        patientId={patientId}
        consultationId={consultationId}
        liste={liste}
        revues={interactions}
        chargement={chargement}
        erreur={erreur}
        onChanged={onChanged}
        onReessayer={onReessayer}
      />

      <Carte niveau="clinique">
        <div className="flex flex-col gap-3 p-5">
          <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.securite.statutTitre}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {[t.securite.statut1, t.securite.statut2, t.securite.statut3].map((ligne) => (
              <li key={ligne} className="flex items-start gap-2 font-ui text-body text-ink-700">
                <span className="mt-0.5 text-positive">
                  <Icone nom="valide" taille={16} />
                </span>
                {ligne}
              </li>
            ))}
          </ul>
        </div>
      </Carte>
    </section>
  );
}
