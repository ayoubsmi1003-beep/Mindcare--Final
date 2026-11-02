"use client";

import { useEffect, useMemo, useState } from "react";

import { BlocErreur, Bouton, Carte, ChampSelection, Icone, Squelette } from "@/components/ui";
import { Courbe } from "@/components/ui/Courbe";
import { dateCivile, jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import type { MedicationTimelineEvent, SessionMeasure } from "@/services/medication-workspace";
import type { Treatment } from "@/services/patient-treatments";
import type { AdministrationEchelle, EchelleDisponible } from "@/services/scales";

import { CourbePosologie } from "./CourbePosologie";
import { evenementsPosologie, pointsEchelle, pointsMesure } from "./adaptateurs";
import {
  comparerEpisodes,
  construireEvolutionPosologie,
  dosePrescrite,
  type EpisodeComparable,
  type EvolutionPosologie,
} from "./modele-traitements";

type Periode = "6" | "12" | "tout";

function cutoff(periode: Periode): Date | null {
  if (periode === "tout") return null;
  const date = new Date();
  date.setMonth(date.getMonth() - Number(periode));
  return date;
}

function dansPeriode(iso: string, periode: Periode): boolean {
  const limite = cutoff(periode);
  if (limite === null) return true;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d >= limite;
}

function dateRepere(e: MedicationTimelineEvent): string {
  if (e.kind === "treatment" && e.action === "started") {
    const valeurs = e.newValues;
    if (valeurs !== null && typeof valeurs === "object" && !Array.isArray(valeurs)) {
      const debut = (valeurs as Record<string, unknown>)["start_date"];
      if (typeof debut === "string" && debut.trim() !== "") return debut;
    }
  }
  return e.occurredAt;
}

function episode(traitement: Treatment): EpisodeComparable {
  return {
    id: traitement.id,
    nom: traitement.medicationRaw || traitement.brandName || traitement.inn || t.commune.aucun,
    dose: dosePrescrite(traitement.dose, traitement.doseUnit),
    statut: traitement.status,
    debut: traitement.startDate,
    fin: traitement.status === "active" ? null : (traitement.endDate ?? traitement.stoppedAt?.slice(0, 10) ?? null),
  };
}

function echellesPeriode(
  echelles: readonly AdministrationEchelle[],
  debut: string,
  fin: string | null,
): readonly AdministrationEchelle[] {
  return echelles.filter((e) => {
    const jour = e.administeredAt.slice(0, 10);
    return jour >= debut && (fin === null || jour <= fin);
  });
}

export function EvolutionTraitements({
  liste,
  evenements,
  echelles,
  definitions,
  mesures,
  chargement,
  erreur,
  tronquee = false,
  onReessayer,
}: {
  readonly liste: readonly Treatment[];
  readonly evenements: readonly MedicationTimelineEvent[];
  readonly echelles: readonly AdministrationEchelle[];
  readonly definitions: readonly EchelleDisponible[];
  readonly mesures: readonly SessionMeasure[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly tronquee?: boolean;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [traitementId, setTraitementId] = useState("");
  const [periode, setPeriode] = useState<Periode>("12");
  const [echelleCode, setEchelleCode] = useState("");
  const [episodeA, setEpisodeA] = useState("");
  const [episodeB, setEpisodeB] = useState("");

  useEffect(() => {
    if (traitementId !== "" || liste.length === 0) return;
    const premier = liste.find((x) => x.status === "active") ?? liste[0];
    if (premier !== undefined) setTraitementId(premier.id);
  }, [liste, traitementId]);

  useEffect(() => {
    if (echelleCode !== "" || echelles.length === 0) return;
    setEchelleCode(echelles[0]?.scaleCode ?? "");
  }, [echelles, echelleCode]);

  useEffect(() => {
    if (episodeA !== "" || liste.length === 0) return;
    setEpisodeA(liste[0]?.id ?? "");
  }, [liste, episodeA]);

  useEffect(() => {
    if (episodeB !== "" || liste.length < 2) return;
    setEpisodeB(liste[1]?.id ?? "");
  }, [liste, episodeB]);

  const posologie = useMemo<EvolutionPosologie>(() => {
    if (traitementId === "") return { points: [], unite: null, nonNumeriques: [] };
    const toutes = construireEvolutionPosologie(evenementsPosologie(evenements), traitementId);
    return {
      ...toutes,
      points: toutes.points.filter((p) => dansPeriode(p.date, periode)),
    };
  }, [evenements, traitementId, periode]);

  const reperesTraitement = useMemo(
    () =>
      evenements
        .filter((e) => e.kind === "treatment" && dansPeriode(e.occurredAt, periode))
        .slice()
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [evenements, periode],
  );

  const definition = definitions.find((d) => d.code === echelleCode) ?? null;
  const points =
    echelleCode === ""
      ? []
      : pointsEchelle(
          echelles.filter((e) => dansPeriode(e.administeredAt, periode)),
          echelleCode,
        );
  const optionsTraitements = liste.map((x) => ({
    valeur: x.id,
    libelle: `${x.medicationRaw || x.brandName || x.inn || t.commune.aucun} · ${t.statuts[x.status]}`,
  }));
  const optionsEchelles = [...new Map(echelles.map((e) => [e.scaleCode, e.scaleName])).entries()].map(
    ([valeur, libelle]) => ({ valeur, libelle }),
  );

  if (erreur !== null) {
    return <BlocErreur message={erreur} action={<Bouton onClick={onReessayer}>{t.commune.reessayer}</Bouton>} />;
  }
  if (chargement) return <Squelette lignes={8} />;

  const a = liste.find((x) => x.id === episodeA) ?? null;
  const b = liste.find((x) => x.id === episodeB) ?? null;
  const comparaison = a !== null && b !== null ? comparerEpisodes(episode(a), episode(b), new Date().toISOString().slice(0, 10)) : null;
  const echellesA = a === null ? [] : echellesPeriode(echelles, a.startDate, a.status === "active" ? null : (a.endDate ?? a.stoppedAt?.slice(0, 10) ?? null));
  const echellesB = b === null ? [] : echellesPeriode(echelles, b.startDate, b.status === "active" ? null : (b.endDate ?? b.stoppedAt?.slice(0, 10) ?? null));

  return (
    <section aria-labelledby="titre-evolution-traitements" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-azur text-azure-700">
              <Icone nom="statistiques" taille={20} />
            </span>
            <h2 id="titre-evolution-traitements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.evolution.titre}
            </h2>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.evolution.aide}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["6", "12", "tout"] as const).map((p) => (
            <Bouton
              key={p}
              type="button"
              rang="secondaire"
              taille="compact"
              sansFleches
              enfonce={periode === p}
              onClick={() => setPeriode(p)}
            >
              {p === "6" ? t.evolution.periode6 : p === "12" ? t.evolution.periode12 : t.evolution.periodeTout}
            </Bouton>
          ))}
        </div>
      </div>

      {tronquee ? (
        <p className="m-0 rounded-xl bg-attention-bg px-3 py-2 font-ui text-label text-attention-ink">
          {t.evolution.historiqueTronque}
        </p>
      ) : null}

      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <ChampSelection
              libelle={t.evolution.choisirTraitement}
              valeur={traitementId}
              onChange={setTraitementId}
              options={optionsTraitements}
            />
            <div className="flex items-end">
              <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{t.evolution.posologieAide}</p>
            </div>
          </div>

          {posologie.unite === null && posologie.nonNumeriques.length > 0 ? (
            <div className="rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
              {t.evolution.unitesMixtes}
            </div>
          ) : posologie.points.length === 0 ? (
            <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.evolution.aucunPoint}</p>
          ) : posologie.points.length === 1 ? (
            <div className="flex flex-col gap-1 rounded-2xl bg-sunken px-4 py-3">
              <span className="font-num text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
                {posologie.points[0]?.libelle}
              </span>
              <span className="font-ui text-label text-ink-500">
                {dateCivile(posologie.points[0]?.date.slice(0, 10) ?? "") ?? t.commune.nonDisponible}
              </span>
              <p className="m-0 font-ui text-label text-ink-500">{t.evolution.unSeulPoint}</p>
            </div>
          ) : (
            <CourbePosologie points={posologie.points} unite={posologie.unite ?? t.commune.aucun} />
          )}

          {posologie.nonNumeriques.length > 0 ? (
            <details className="rounded-xl border border-rule bg-sunken p-3">
              <summary className="cursor-pointer font-ui text-label font-semibold text-ink-700">
                {t.evolution.variations}
              </summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                {posologie.nonNumeriques.map((v) => (
                  <li key={v.cle} className="flex flex-wrap justify-between gap-2 font-ui text-label text-ink-700">
                    <span>{jourLong(v.date) ?? v.date}</span>
                    <span className="font-num tabular-nums text-ink-900">{v.libelle}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

        </div>
      </Carte>

      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.evolution.reponseTitre}</h3>
            <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.evolution.reponseAide}</p>
          </div>

          {optionsEchelles.length === 0 ? (
            <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.evolution.aucuneEchelle}</p>
          ) : (
            <>
              <ChampSelection
                libelle={t.evolution.choisirEchelle}
                valeur={echelleCode}
                onChange={setEchelleCode}
                options={optionsEchelles}
              />
              {points.length === 0 ? (
                <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.evolution.aucuneEchelle}</p>
              ) : points.length === 1 ? (
                <div className="flex flex-col gap-1 rounded-2xl bg-sunken px-4 py-3">
                  <span className="font-num text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
                    {points[0]?.valeur ?? t.commune.nonDisponible}
                  </span>
                  <span className="font-ui text-label text-ink-500">
                    {points[0]?.titre ?? t.commune.nonDisponible}
                  </span>
                  <p className="m-0 font-ui text-label text-ink-500">{t.evolution.unSeulPoint}</p>
                </div>
              ) : (
                <Courbe
                  points={points}
                  famille="violet"
                  libellePrimaire={t.evolution.choisirEchelle}
                  ariaLabel={`${t.evolution.reponseTitre} — ${echelleCode}`}
                  {...(definition === null ? {} : { plafond: definition.scoring.max })}
                  hauteur={220}
                />
              )}
            </>
          )}

          {reperesTraitement.length === 0 ? null : (
            <div className="flex flex-col gap-2 border-t border-rule pt-4">
              <h4 className="m-0 font-ui text-label font-bold tracking-label text-ink-500">
                {t.evolution.reperesTraitement}
              </h4>
              <p className="m-0 font-ui text-label text-ink-500">{t.evolution.reperesAide}</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {reperesTraitement.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 font-ui text-label text-ink-700">
                    <span className="min-w-0 break-words">
                      {e.medicationName === null ? "" : `${e.medicationName} · `}
                      {t.chronologie.actions[e.action] ?? e.action}
                    </span>
                    <span className="font-num tabular-nums text-ink-500">
                      {jourLong(dateRepere(e)) ?? dateRepere(e)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Carte>

      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.evolution.mesuresTitre}</h3>
            <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.evolution.mesuresAide}</p>
          </div>
          {mesures.length === 0 ? (
            <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.evolution.aucuneMesure}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-3">
              {([
                ["anxiete", "Anxiété", "azure"],
                ["sommeil", "Sommeil", "violet"],
                ["humeur", "Humeur", "ambre"],
              ] as const).map(([cle, libelle, famille]) => {
                const serieMesure = pointsMesure(
                  mesures.filter((m) => dansPeriode(m.measuredAt, periode)),
                  cle,
                );
                return (
                  <div key={cle} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-rule bg-card p-3">
                    <h4 className="m-0 font-ui text-label font-bold text-ink-700">{libelle}</h4>
                    {serieMesure.some((p) => p.valeur !== null) ? (
                      <Courbe
                        points={serieMesure}
                        famille={famille}
                        libellePrimaire={t.surveillance.uniteMesure}
                        ariaLabel={`${libelle} — ${t.evolution.mesuresTitre}`}
                        plafond={10}
                        hauteur={150}
                      />
                    ) : (
                      <p className="m-0 py-4 text-center font-ui text-label text-ink-300">{t.commune.nonDisponible}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Carte>

      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.evolution.comparaisonTitre}</h3>
            <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.evolution.comparaisonAide}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <ChampSelection
              libelle={t.evolution.episodeA}
              valeur={episodeA}
              onChange={setEpisodeA}
              options={optionsTraitements}
            />
            <ChampSelection
              libelle={t.evolution.episodeB}
              valeur={episodeB}
              onChange={setEpisodeB}
              options={optionsTraitements}
            />
          </div>

          {comparaison === null ? (
            <p className="m-0 py-4 text-center font-ui text-body text-ink-500">{t.evolution.pasAssez}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
              {[
                { episode: comparaison.a, echelles: echellesA },
                { episode: comparaison.b, echelles: echellesB },
              ].map(({ episode, echelles: listeEchelles }) => (
                <div key={episode.id} className="flex flex-col gap-3 rounded-2xl border border-rule bg-sunken p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="m-0 break-words font-ui text-body font-bold text-ink-900">{episode.nom}</h4>
                    <span className="rounded-full bg-card px-2 py-0.5 font-ui text-label text-ink-500">
                      {t.statuts[episode.statut]}
                    </span>
                  </div>
                  <dl className="m-0 grid grid-cols-2 gap-2 font-ui text-label">
                    <div>
                      <dt className="text-ink-500">{t.carte.dose}</dt>
                      <dd className="m-0 font-num tabular-nums text-ink-900">{episode.dose ?? t.commune.aucun}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-500">{t.evolution.duree}</dt>
                      <dd className="m-0 font-num tabular-nums text-ink-900">
                        {t.evolution.jours(episode.dureeJours)} {episode.fin === null ? `· ${t.evolution.enCours}` : ""}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-col gap-1">
                    <span className="font-ui text-label text-ink-500">{t.evolution.echellesPeriode}</span>
                    {listeEchelles.length === 0 ? (
                      <span className="font-ui text-label text-ink-500">{t.evolution.aucuneEchellePeriode}</span>
                    ) : (
                      <ul className="m-0 flex list-none flex-col gap-1 p-0">
                        {listeEchelles.slice(0, 6).map((e) => (
                          <li key={e.id} className="flex flex-wrap justify-between gap-2 font-ui text-label text-ink-700">
                            <span>
                              {e.scaleName} · {e.total ?? t.commune.nonDisponible}
                            </span>
                            <span className="font-num tabular-nums text-ink-500">{dateCivile(e.administeredAt.slice(0, 10))}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Carte>
    </section>
  );
}
