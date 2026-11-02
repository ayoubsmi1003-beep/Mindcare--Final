"use client";

import { Carte, Icone } from "@/components/ui";
import { traitements as t } from "@/i18n/traitements";
import type { Treatment } from "@/services/patient-treatments";

import { resumerPolypharmacie } from "./modele-traitements";

function Metrique({
  valeur,
  libelle,
  ton,
}: {
  readonly valeur: string;
  readonly libelle: string;
  readonly ton: "emeraude" | "azur" | "violet" | "ambre";
}): React.JSX.Element {
  const fond = {
    emeraude: "bg-tuile-menthe text-emeraude-700",
    azur: "bg-tuile-azur text-azure-700",
    violet: "bg-tuile-lavande text-violet-700",
    ambre: "bg-tuile-ambre text-ambre-700",
  } as const;
  return (
    <div className={["flex min-w-0 flex-col gap-1 rounded-2xl p-4 shadow-douce", fond[ton]].join(" ")}>
      <span className="font-num text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">{valeur}</span>
      <span className="font-ui text-label font-medium leading-snug text-ink-700">{libelle}</span>
    </div>
  );
}

export function Polypharmacie({ liste }: { readonly liste: readonly Treatment[] }): React.JSX.Element {
  const resume = resumerPolypharmacie(liste);
  const actifs = liste.filter((traitement) => traitement.status === "active");
  const parClasse = new Map<string, number>();
  for (const traitement of actifs) {
    const cle = traitement.atcClass === null || traitement.atcClass.trim() === "" ? t.polypharmacie.aucuneCategorie : traitement.atcClass;
    parClasse.set(cle, (parClasse.get(cle) ?? 0) + 1);
  }

  return (
    <section aria-labelledby="titre-polypharmacie" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-lavande text-violet-700">
          <Icone nom="traitements" taille={20} />
        </span>
        <h2 id="titre-polypharmacie" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
          {t.polypharmacie.titre}
        </h2>
      </div>
      <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.polypharmacie.aide}</p>

      <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
        <Metrique valeur={String(resume.actifs)} libelle={t.polypharmacie.actifs} ton="emeraude" />
        <Metrique valeur={String(resume.categories)} libelle={t.polypharmacie.categories} ton="azur" />
        <Metrique valeur={String(resume.chevauchements)} libelle={t.polypharmacie.chevauchements} ton="violet" />
        <Metrique valeur={String(resume.posologiesIncompletes)} libelle={t.polypharmacie.posologies} ton="ambre" />
      </div>

      {actifs.length === 0 ? null : (
        <Carte niveau="secondaire">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap gap-2">
              {[...parClasse.entries()].map(([classe, nombre]) => (
                <span
                  key={classe}
                  className="inline-flex items-center gap-2 rounded-full border border-rule bg-card px-3 py-1 font-ui text-label text-ink-700"
                >
                  <span className="font-num text-label tabular-nums text-ink-900">{nombre}</span>
                  {classe}
                </span>
              ))}
            </div>
            <p className="m-0 flex items-center gap-2 font-ui text-label text-ink-500">
              <Icone nom="alerte" taille={16} />
              {t.polypharmacie.revueInteraction}
            </p>
          </div>
        </Carte>
      )}
    </section>
  );
}
