"use client";

import { useMemo, useState } from "react";

import { BlocErreur, Bouton, EtatVide, Icone, Squelette } from "@/components/ui";
import { dateCivile, heure, jourLong, moisLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import type { MedicationTimelineEvent } from "@/services/medication-workspace";

import { motifArretLisible } from "./modele-traitements";

type Filtre = "tout" | "traitement" | "ordonnance";

function objet(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function texte(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function doseDe(value: unknown): string | null {
  const o = objet(value);
  if (o === null) return null;
  const dose = texte(o["dose"]);
  const unite = texte(o["dose_unit"]);
  const lisible = [dose, unite].filter(Boolean).join(" ");
  return lisible === "" ? null : lisible;
}

function horaireDe(value: unknown): string | null {
  const o = objet(value);
  if (o === null) return null;
  const frequence = texte(o["frequency"]);
  const timing = Array.isArray(o["timing"])
    ? o["timing"].filter((x): x is string => typeof x === "string").join(" · ")
    : null;
  return [frequence, timing].filter(Boolean).join(" · ") || null;
}

function dateFinDe(value: unknown): string | null {
  const o = objet(value);
  if (o === null) return null;
  const fin = texte(o["end_date"]);
  return fin === null ? null : fin.slice(0, 10);
}

function iconPour(e: MedicationTimelineEvent): "traitements" | "documents" | "journalActivite" {
  if (e.kind === "document") return "documents";
  if (e.kind === "prescription") return "journalActivite";
  return "traitements";
}

function libelle(e: MedicationTimelineEvent): string {
  return t.chronologie.actions[e.action] ?? e.action;
}

function detail(e: MedicationTimelineEvent): React.JSX.Element | null {
  if (e.kind === "prescription") {
    return e.lineCount === null ? null : (
      <p className="m-0 font-ui text-label text-ink-500">{t.chronologie.lignes(e.lineCount)}</p>
    );
  }
  if (e.kind === "document") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {e.documentNumber === null ? null : (
          <span className="rounded-full border border-rule bg-card px-2 py-0.5 font-num text-eyebrow tabular-nums text-ink-700">
            {e.documentNumber}
          </span>
        )}
        {e.reason === null ? null : <span className="font-ui text-label text-ink-500">{e.reason}</span>}
      </div>
    );
  }

  if (e.action === "started") {
    const valeur = doseDe(e.newValues) ?? horaireDe(e.newValues);
    return valeur === null ? null : (
      <p className="m-0 font-num text-label tabular-nums text-ink-700">{valeur}</p>
    );
  }

  if (e.action === "stopped") {
    const motif = motifArretLisible(e.reason, t.formulaire.motifs);
    return motif === null ? null : (
      <p className="m-0 font-ui text-label text-ink-700">
        {t.formulaire.motif} : {motif}
      </p>
    );
  }

  if (e.action === "renewed") {
    const fin = dateFinDe(e.newValues);
    return fin === null ? null : (
      <p className="m-0 font-num text-label tabular-nums text-ink-700">
        {t.carte.jusquau} {dateCivile(fin) ?? fin}
      </p>
    );
  }

  if (e.action !== "dose_changed" && e.action !== "schedule_changed") {
    return e.reason === null ? null : <p className="m-0 font-ui text-body text-ink-700">{e.reason}</p>;
  }

  const avant = e.action === "dose_changed" ? doseDe(e.previousValues) : horaireDe(e.previousValues);
  const apres = e.action === "dose_changed" ? doseDe(e.newValues) : horaireDe(e.newValues);

  if (avant === null && apres === null) {
    return e.reason === null ? null : <p className="m-0 font-ui text-body text-ink-700">{e.reason}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 font-num text-label tabular-nums text-ink-700">
        <span className="rounded-lg bg-sunken px-2 py-1 text-ink-500">{avant ?? t.chronologie.valeurAbsente}</span>
        <Icone nom="fleche" taille={16} />
        <span className="rounded-lg bg-card px-2 py-1 font-semibold text-ink-900">{apres ?? t.chronologie.valeurAbsente}</span>
      </div>
      {e.reason === null ? null : <p className="m-0 font-ui text-label text-ink-500">{e.reason}</p>}
    </div>
  );
}

export function ChronologieTraitements({
  events,
  chargement,
  erreur,
  fini,
  onPlus,
  onReessayer,
}: {
  readonly events: readonly MedicationTimelineEvent[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly fini: boolean;
  readonly onPlus: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const filtres: readonly { cle: Filtre; libelle: string }[] = [
    { cle: "tout", libelle: t.chronologie.tout },
    { cle: "traitement", libelle: t.chronologie.traitements },
    { cle: "ordonnance", libelle: t.chronologie.ordonnances },
  ];

  const affiches = useMemo(
    () =>
      events.filter((e) => {
        if (filtre === "tout") return true;
        if (filtre === "traitement") return e.kind === "treatment";
        return e.kind === "prescription" || e.kind === "document";
      }),
    [events, filtre],
  );

  let moisCourant: string | null = null;

  return (
    <section aria-labelledby="titre-chronologie-traitements" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-menthe text-emeraude-700">
              <Icone nom="journalActivite" taille={20} />
            </span>
            <h2 id="titre-chronologie-traitements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.chronologie.titre}
            </h2>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.chronologie.aide}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filtres.map((f) => (
            <Bouton
              key={f.cle}
              rang="secondaire"
              taille="compact"
              sansFleches
              enfonce={filtre === f.cle}
              onClick={() => setFiltre(f.cle)}
            >
              {f.libelle}
            </Bouton>
          ))}
        </div>
      </div>

      {erreur !== null ? (
        <BlocErreur message={erreur} action={<Bouton onClick={onReessayer}>{t.commune.reessayer}</Bouton>} />
      ) : chargement && events.length === 0 ? (
        <Squelette lignes={6} />
      ) : affiches.length === 0 ? (
        <EtatVide
          message={events.length === 0 ? t.chronologie.vide : t.chronologie.videAide}
          icone="journalActivite"
        />
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {affiches.map((e) => {
            const mois = moisLong(e.occurredAt);
            const nouveauMois = mois !== null && mois !== moisCourant;
            if (nouveauMois) moisCourant = mois;
            return (
              <li key={`${e.kind}-${e.id}`} className="list-none">
                {nouveauMois ? (
                  <h3 className="mb-2 mt-4 border-b border-rule pb-2 font-ui text-label font-bold tracking-label text-ink-500 first:mt-0">
                    {mois}
                  </h3>
                ) : null}
                <div className="flex gap-3 py-3">
                  <div className="flex shrink-0 flex-col items-center gap-2">
                    <span
                      className={[
                        "inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-douce",
                        e.kind === "document"
                          ? "border-azure-100 bg-tuile-azur text-azure-700"
                          : e.kind === "prescription"
                            ? "border-violet-100 bg-tuile-lavande text-violet-700"
                            : "border-emeraude-100 bg-tuile-menthe text-emeraude-700",
                      ].join(" ")}
                    >
                      <Icone nom={iconPour(e)} taille={20} />
                    </span>
                    <span aria-hidden="true" className="w-0 grow border-l border-rule" />
                  </div>

                  <div className="flex min-w-0 grow flex-col gap-1.5 pb-2">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-ui text-body font-semibold text-ink-900">{libelle(e)}</span>
                      {e.medicationName === null ? null : (
                        <span className="break-words font-ui text-body text-ink-700">{e.medicationName}</span>
                      )}
                      <span className="font-num text-label tabular-nums text-ink-500">
                        {jourLong(e.occurredAt) ?? t.commune.nonDisponible}
                        {heure(e.occurredAt) === null ? "" : ` · ${heure(e.occurredAt)}`}
                      </span>
                    </div>

                    {detail(e)}

                    <div className="flex flex-wrap items-center gap-2">
                      {e.actorName === null ? null : (
                        <span className="font-ui text-label text-ink-500">
                          {t.chronologie.acteur} {e.actorName}
                        </span>
                      )}
                      {e.consultationId === null ? null : (
                        <span className="rounded-full border border-info-100 bg-info-50 px-2 py-0.5 font-ui text-eyebrow text-info-600">
                          {t.chronologie.seance}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {erreur !== null || affiches.length === 0 ? null : fini ? (
        <p className="m-0 py-2 font-ui text-label text-ink-500">{t.chronologie.fin}</p>
      ) : (
        <Bouton rang="secondaire" onClick={onPlus} disabled={chargement}>
          {chargement ? t.commune.chargement : t.actions.chargerPlus}
        </Bouton>
      )}
    </section>
  );
}
