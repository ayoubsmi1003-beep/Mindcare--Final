"use client";

import { useEffect, useMemo, useState } from "react";

import { Bouton, Icone, PastilleIcone } from "@/components/ui";
import { cliniqueUi } from "@/i18n/clinical-ui";
import {
  historiqueEchelles,
  listerEchelles,
  type AdministrationEchelle,
  type EchelleDisponible,
  type EchelleItem,
} from "@/services/scales";
import type { EchelleResume } from "@/services/patients";

function dateHeure(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  }).format(parsed);
}

function nomCourt(code: string, name: string): string {
  if (code === "PHQ9") return "PHQ-9";
  if (code === "GAD7") return "GAD-7";
  if (code === "ISI") return "ISI";
  return name;
}

function ecart(latest: AdministrationEchelle, previous: AdministrationEchelle | null): number | null {
  if (previous === null || latest.total === null || previous.total === null) return null;
  return latest.total - previous.total;
}

function texteEcart(value: number | null): string | null {
  if (value === null) return null;
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${String(Math.abs(value))}`;
}

function AnneauScore({ total, max }: { readonly total: number | null; readonly max: number | null }): React.JSX.Element {
  const pct = total === null || max === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (total / max) * 100));
  return (
    <div
      aria-hidden="true"
      className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(var(--action-600) ${String(pct)}%, var(--rule) 0)`,
      }}
    >
      <div className="flex h-12 w-12 flex-col items-center justify-center rounded-full bg-card text-ink-900 shadow-inner">
        <span className="font-num text-heading font-bold tabular-nums leading-none">{total === null ? "—" : String(total)}</span>
        <span className="font-ui text-eyebrow tabular-nums text-ink-500">{max === null ? "" : `/${String(max)}`}</span>
      </div>
    </div>
  );
}

function OptionReponse({
  item,
  value,
  selected,
}: {
  readonly item: EchelleItem;
  readonly value: number;
  readonly selected: boolean;
}): React.JSX.Element | null {
  const option = item.options.find((entry) => entry.valeur === value);
  if (option === undefined) return null;
  return (
    <span
      className={[
        "flex min-h-target items-center gap-2 rounded-xl border px-2.5 py-2",
        "font-ui text-label leading-snug transition-colors duration-quick",
        selected
          ? "border-action-600 bg-action-50 text-ink-900"
          : "border-rule bg-card text-ink-500",
      ].join(" ")}
      aria-current={selected ? "true" : undefined}
    >
      <span
        aria-hidden="true"
        className={[
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-action-600 bg-action-600 text-white" : "border-ink-300 bg-card",
        ].join(" ")}
      >
        {selected ? <Icone nom="valide" taille={16} /> : null}
      </span>
      <span className="min-w-0 break-words">
        <span className="font-num text-eyebrow tabular-nums text-ink-500">{option.valeur} · </span>
        {option.libelle}
      </span>
    </span>
  );
}

function ReponsesEchelle({
  definition,
  administration,
}: {
  readonly definition: EchelleDisponible | undefined;
  readonly administration: AdministrationEchelle;
}): React.JSX.Element {
  if (definition === undefined || Object.keys(administration.responses).length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-2xl border border-rule bg-sunken/70 px-4 py-3">
        <p className="m-0 font-ui text-label font-medium text-ink-700">{cliniqueUi.echelles.aucuneReponse}</p>
        <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{cliniqueUi.echelles.aucuneReponseAide}</p>
      </div>
    );
  }

  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {definition.items.map((item, index) => {
        const brut = administration.responses[item.id];
        const choisi = typeof brut === "number"
          ? brut
          : typeof brut === "string" && /^\d+$/u.test(brut)
            ? Number(brut)
            : null;
        const estRisque = item.risque === true && choisi !== null && choisi > 0;
        return (
          <li
            key={item.id}
            className={[
              "flex flex-col gap-2 rounded-2xl border px-3 py-3",
              estRisque ? "border-attention bg-attention-bg" : "border-rule bg-card",
            ].join(" ")}
          >
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sunken font-num text-label font-semibold tabular-nums text-ink-500">
                {index + 1}
              </span>
              <p className="m-0 min-w-0 break-words font-ui text-body font-medium leading-snug text-ink-900">
                {item.texte}
              </p>
            </div>
            <div className="grid gap-1.5 pl-8 sm:grid-cols-2">
              {item.options.map((option) => (
                <OptionReponse key={option.valeur} item={item} value={option.valeur} selected={choisi === option.valeur} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-8">
              <span className="font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-ink-500">
                {cliniqueUi.echelles.reponseChoisie}
              </span>
              <span className="rounded-full bg-action-50 px-2 py-0.5 font-ui text-label font-semibold text-action-700">
                {choisi === null
                  ? cliniqueUi.echelles.aucuneReponse
                  : item.options.find((option) => option.valeur === choisi)?.libelle ?? String(choisi)}
              </span>
            </div>
            {estRisque ? (
              <div className="ml-8 flex items-start gap-2 rounded-xl border border-attention bg-attention-bg px-3 py-2">
                <Icone nom="alerte" taille={16} className="mt-0.5 shrink-0 text-attention-ink" />
                <p className="m-0 font-ui text-label leading-relaxed text-attention-ink">
                  {item.alerte ?? cliniqueUi.echelles.risqueAlerte}
                </p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

interface GroupeEchelle {
  readonly code: string;
  readonly name: string;
  readonly definition: EchelleDisponible | undefined;
  readonly administrations: readonly AdministrationEchelle[];
}

function groupes(
  history: readonly AdministrationEchelle[],
  definitions: readonly EchelleDisponible[],
  fallback: readonly EchelleResume[],
): GroupeEchelle[] {
  const definitionByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const byCode = new Map<string, AdministrationEchelle[]>();
  for (const administration of [...history].sort(
    (a, b) => b.administeredAt.localeCompare(a.administeredAt) || b.id.localeCompare(a.id),
  )) {
    const list = byCode.get(administration.scaleCode) ?? [];
    list.push(administration);
    byCode.set(administration.scaleCode, list);
  }
  const sortie: GroupeEchelle[] = [...byCode.entries()].map(([code, list]) => {
    const latest = list[0]!;
    return {
      code,
      name: latest.scaleName,
      definition: definitionByCode.get(code),
      administrations: list,
    };
  });
  // Une base antérieure à 184 peut n'avoir que le résumé du workspace : on
  // l'affiche sans inventer de réponses (voir `ReponsesEchelle`).
  const connus = new Set(sortie.map((groupe) => groupe.code));
  for (const echelle of fallback) {
    if (connus.has(echelle.scaleCode)) continue;
    sortie.push({
      code: echelle.scaleCode,
      name: echelle.scaleName,
      definition: definitionByCode.get(echelle.scaleCode),
      administrations: [{
        id: `resume-${echelle.scaleCode}`,
        scaleCode: echelle.scaleCode,
        scaleName: echelle.scaleName,
        consultationId: null,
        total: echelle.dernier.score,
        interpretation: echelle.dernier.interpretation,
        administeredAt: echelle.dernier.date,
        responses: {},
      }],
    });
  }
  return sortie.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function CarteEchelles({
  patientId,
  echelles,
  encadre = true,
}: {
  readonly patientId: string;
  readonly echelles: readonly EchelleResume[];
  /** Faux quand la carte est déjà portée par la surface « État clinique ». */
  readonly encadre?: boolean;
}): React.JSX.Element {
  const [definitions, setDefinitions] = useState<readonly EchelleDisponible[]>([]);
  const [definitionsChargees, setDefinitionsChargees] = useState(false);
  const [historique, setHistorique] = useState<readonly AdministrationEchelle[] | null>(null);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [ouvertes, setOuvertes] = useState<ReadonlySet<string>>(new Set<string>());
  const [choisies, setChoisies] = useState<Readonly<Record<string, string>>>({});
  const [historiqueOuvert, setHistoriqueOuvert] = useState<ReadonlySet<string>>(new Set<string>());

  useEffect(() => {
    let actif = true;
    setErreur(undefined);
    void Promise.all([listerEchelles(), historiqueEchelles(patientId)]).then(([definitionsResult, historyResult]) => {
      if (!actif) return;
      setDefinitionsChargees(true);
      if (definitionsResult.ok) setDefinitions(definitionsResult.data);
      if (historyResult.ok) {
        setHistorique(historyResult.data);
        // Les dernières réponses sont visibles directement : c'est le geste
        // de lecture principal demandé par la praticienne, pas un dropdown.
        const defaultOuvertes = new Set<string>();
        for (const administration of historyResult.data) defaultOuvertes.add(administration.scaleCode);
        setOuvertes(defaultOuvertes);
      } else {
        setHistorique([]);
        setErreur(historyResult.error.message);
      }
    });
    return () => {
      actif = false;
    };
  }, [patientId]);

  const groupesAffiches = useMemo(
    () => groupes(historique ?? [], definitions, echelles),
    [historique, definitions, echelles],
  );

  function basculer(code: string): void {
    setOuvertes((courant) => {
      const suivant = new Set(courant);
      if (suivant.has(code)) suivant.delete(code);
      else suivant.add(code);
      return suivant;
    });
  }

  function administrationAffichee(groupe: GroupeEchelle): AdministrationEchelle | null {
    if (groupe.administrations.length === 0) return null;
    const choisie = choisies[groupe.code];
    return groupe.administrations.find((administration) => administration.id === choisie) ?? groupe.administrations[0]!;
  }

  const aucune = groupesAffiches.length === 0;

  return (
    <section
      aria-labelledby="titre-echelles"
      className={encadre
        ? "flex min-w-0 flex-col gap-5 rounded-3xl border border-rule bg-card p-5 shadow-carte sm:p-6"
        : "flex min-w-0 flex-col gap-5"}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-azure-200 bg-gradient-to-br from-azure-050 via-card to-action-50 text-azure-700 shadow-douce">
            <Icone nom="echelle" taille={24} />
            <span aria-hidden="true" className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-azure-200 blur-sm" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 id="titre-echelles" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
                {cliniqueUi.echelles.titre}
              </h2>
              <span className="font-ui text-label tabular-nums text-ink-500">
                {groupesAffiches.length === 0 ? "" : `${String(groupesAffiches.length)} échelle${groupesAffiches.length > 1 ? "s" : ""}`}
              </span>
            </div>
            <p className="m-0 max-w-prose font-ui text-label leading-relaxed text-ink-500">
              {cliniqueUi.echelles.sousTitre}
            </p>
          </div>
        </div>
      </header>

      {erreur === undefined ? null : (
        <p role="alert" className="m-0 rounded-xl border border-attention bg-attention-bg px-4 py-3 font-ui text-label text-attention-ink">
          {erreur}
        </p>
      )}
      {definitionsChargees && definitions.length === 0 && historique !== null && historique.length > 0 ? (
        <p role="status" className="m-0 rounded-xl border border-attention bg-attention-bg px-4 py-3 font-ui text-label text-attention-ink">
          {cliniqueUi.echelles.referentielIndisponible}
        </p>
      ) : null}

      {historique === null ? (
        <p role="status" className="m-0 font-ui text-label text-ink-500">{cliniqueUi.commun.chargement}</p>
      ) : aucune ? (
        <div className="relative flex flex-1 flex-col justify-center overflow-hidden rounded-3xl border border-dashed border-azure-200 bg-gradient-to-br from-azure-050 via-card to-action-50 px-5 py-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-azure-100 blur-2xl" />
          <div className="relative flex flex-col items-start gap-4">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-azure-200 bg-card text-azure-700 shadow-douce">
              <Icone nom="echelle" taille={24} />
            </span>
            <div className="flex max-w-prose flex-col gap-1.5">
              <p className="m-0 font-ui text-title font-semibold tracking-title text-ink-900">{cliniqueUi.echelles.videTitre}</p>
              <p className="m-0 font-ui text-body leading-relaxed text-ink-700">{cliniqueUi.echelles.videCorps}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          {groupesAffiches.map((groupe) => {
            const latest = administrationAffichee(groupe);
            const indexLatest = latest === null
              ? -1
              : groupe.administrations.findIndex((entry) => entry.id === latest.id);
            const previous = indexLatest >= 0 ? groupe.administrations[indexLatest + 1] ?? null : null;
            const ouvert = ouvertes.has(groupe.code);
            const delta = latest === null ? null : ecart(latest, previous);
            const deltaTexte = texteEcart(delta);
            const scoreMax = groupe.definition?.scoring.max ?? null;
            const risk = latest === null
              ? null
              : groupe.definition?.items.find((item) => {
                  const value = latest.responses[item.id];
                  return item.risque === true && typeof value === "number" && value > 0;
                }) ?? null;
            return (
              <article
                key={groupe.code}
                className="group flex min-w-0 flex-col gap-4 rounded-2xl border border-rule bg-card px-4 py-4 transition duration-quick ease-out hover:border-action-500 hover:shadow-douce"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <AnneauScore total={latest?.total ?? null} max={scoreMax} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="rounded-full border border-azure-200 bg-azure-050 px-2 py-0.5 font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-azure-700">
                          {nomCourt(groupe.code, groupe.name)}
                        </span>
                        <h3 className="m-0 min-w-0 break-words font-ui text-body font-semibold text-ink-900">{groupe.name}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-label text-ink-500">
                        <span>{latest === null ? cliniqueUi.echelles.videTitre : latest.interpretation ?? cliniqueUi.commun.aucuneDonnee}</span>
                        {deltaTexte === null ? null : (
                          <span className="rounded-full bg-sunken px-2 py-0.5 font-num text-label font-semibold tabular-nums text-ink-700">
                            {cliniqueUi.echelles.ecart} {deltaTexte}
                          </span>
                        )}
                      </div>
                      <span className="font-ui text-label tabular-nums text-ink-500">
                        {latest === null ? cliniqueUi.echelles.mesureUnique : dateHeure(latest.administeredAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {risk === null ? null : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-attention bg-attention-bg px-2.5 py-1 font-ui text-eyebrow font-semibold uppercase tracking-label text-attention-ink">
                        <Icone nom="alerte" taille={16} />
                        {cliniqueUi.echelles.itemRisque}
                      </span>
                    )}
                    <Bouton
                      rang="secondaire"
                      taille="compact"
                      onClick={() => basculer(groupe.code)}
                      deploye={ouvert}
                    >
                      {ouvert ? cliniqueUi.commun.masquerReponses : cliniqueUi.commun.voirReponses}
                    </Bouton>
                  </div>
                </div>

                {ouvert && latest !== null ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
                      <p className="m-0 font-ui text-label font-semibold tracking-label text-ink-500">
                        {cliniqueUi.echelles.questions}
                      </p>
                      <p className="m-0 font-ui text-label text-ink-500">
                        {latest.consultationId === null ? cliniqueUi.echelles.echelleHorsSeance : cliniqueUi.echelles.echelleAdministree}
                      </p>
                    </div>
                    <ReponsesEchelle definition={groupe.definition} administration={latest} />

                    {groupe.administrations.length > 1 ? (
                      <div className="flex flex-col gap-2 border-t border-rule pt-3">
                        <button
                          type="button"
                          onClick={() =>
                            setHistoriqueOuvert((courant) => {
                              const suivant = new Set(courant);
                              if (suivant.has(groupe.code)) suivant.delete(groupe.code);
                              else suivant.add(groupe.code);
                              return suivant;
                            })
                          }
                          aria-expanded={historiqueOuvert.has(groupe.code)}
                          className="min-h-target self-start rounded-lg font-ui text-label font-medium text-ink-500 outline-none transition-colors duration-quick hover:text-ink-900 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
                        >
                          {historiqueOuvert.has(groupe.code) ? cliniqueUi.echelles.masquerToutes : cliniqueUi.echelles.voirToutes} ({groupe.administrations.length})
                        </button>
                        {historiqueOuvert.has(groupe.code) ? (
                          <ul className="m-0 flex list-none flex-col divide-y divide-rule p-0">
                            {groupe.administrations.map((administration) => {
                              const active = latest.id === administration.id;
                              return (
                                <li key={administration.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                  <button
                                    type="button"
                                    onClick={() => setChoisies((courant) => ({ ...courant, [groupe.code]: administration.id }))}
                                    className={[
                                      "flex min-h-target min-w-0 flex-wrap items-baseline gap-x-3 rounded-lg px-2 text-left",
                                      "outline-none transition-colors duration-quick focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                                      active ? "bg-action-50 text-ink-900" : "text-ink-700 hover:bg-sunken",
                                    ].join(" ")}
                                    aria-current={active ? "true" : undefined}
                                  >
                                    <span className="font-ui text-label tabular-nums text-ink-500">{dateHeure(administration.administeredAt)}</span>
                                    <span className="font-num text-body font-semibold tabular-nums text-ink-900">
                                      {administration.total === null ? "—" : String(administration.total)}
                                      {scoreMax === null ? "" : `/${String(scoreMax)}`}
                                    </span>
                                    <span className="font-ui text-label text-ink-500">{administration.interpretation ?? ""}</span>
                                  </button>
                                  {active ? (
                                    <span className="font-ui text-eyebrow font-semibold uppercase tracking-label text-action-700">
                                      {cliniqueUi.echelles.selectionnee}
                                    </span>
                                  ) : (
                                    <Bouton
                                      rang="discret"
                                      taille="compact"
                                      onClick={() => setChoisies((courant) => ({ ...courant, [groupe.code]: administration.id }))}
                                    >
                                      {cliniqueUi.echelles.consulter}
                                    </Bouton>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
