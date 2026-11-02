"use client";

import { Carte, EtatVide, Icone } from "@/components/ui";
import { traitements as t } from "@/i18n/traitements";
import type { Treatment } from "@/services/patient-treatments";

import { construirePlanPrises, dosePrescrite } from "./modele-traitements";

function dose(traitement: Treatment): string {
  return dosePrescrite(traitement.dose, traitement.doseUnit) ?? t.carte.aucunDosage;
}

function Colonne({
  titre,
  items,
}: {
  readonly titre: string;
  readonly items: readonly Treatment[];
}): React.JSX.Element {
  return (
    <Carte niveau="secondaire">
      <div className="flex min-h-40 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 font-ui text-label font-bold tracking-label text-ink-700">{titre}</h3>
          <span className="rounded-full bg-card px-2 py-0.5 font-num text-eyebrow tabular-nums text-ink-500">
            {items.length}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="m-0 font-ui text-label text-ink-300">{t.plan.aucun}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((traitement) => (
              <li
                key={traitement.id}
                className="flex items-start gap-2 rounded-xl bg-card px-3 py-2 shadow-douce"
              >
                <span className="mt-0.5 text-emeraude-700">
                  <Icone nom="traitements" taille={16} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words font-ui text-label font-semibold text-ink-900">
                    {traitement.medicationRaw || traitement.brandName || traitement.inn}
                  </span>
                  <span className="font-num text-eyebrow tabular-nums text-ink-500">
                    {dose(traitement)}
                    {traitement.frequency === null ? "" : ` · ${traitement.frequency}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Carte>
  );
}

export function PlanPrises({ liste }: { readonly liste: readonly Treatment[] }): React.JSX.Element {
  const plan = construirePlanPrises(liste);
  const vide =
    plan.matin.length === 0 &&
    plan.midi.length === 0 &&
    plan.soir.length === 0 &&
    plan.nonPrecise.length === 0;

  return (
    <section aria-labelledby="titre-plan-prises" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-azur text-azure-700">
              <Icone nom="horloge" taille={20} />
            </span>
            <h2 id="titre-plan-prises" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.plan.titre}
            </h2>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.plan.aide}</p>
        </div>
      </div>

      {vide ? (
        <Carte niveau="secondaire">
          <EtatVide message={t.plan.vide} icone="traitements" />
        </Carte>
      ) : (
        <div className="grid grid-cols-1 gap-3 tablet:grid-cols-3">
          <Colonne titre={t.plan.matin} items={plan.matin} />
          <Colonne titre={t.plan.midi} items={plan.midi} />
          <Colonne titre={t.plan.soir} items={plan.soir} />
        </div>
      )}

      {plan.nonPrecise.length === 0 ? null : (
        <Carte niveau="secondaire">
          <div className="p-4">
            <h3 className="m-0 font-ui text-label font-bold tracking-label text-ink-700">{t.plan.nonPrecise}</h3>
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {plan.nonPrecise.map((traitement) => (
                <li key={traitement.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-ui text-body font-semibold text-ink-900">
                    {traitement.medicationRaw || traitement.brandName || traitement.inn}
                  </span>
                  <span className="font-num text-label tabular-nums text-ink-500">
                    {dose(traitement)}
                    {traitement.frequency === null ? "" : ` · ${traitement.frequency}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Carte>
      )}
    </section>
  );
}
