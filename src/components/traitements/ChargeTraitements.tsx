"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, BlocErreur, Bouton, Carte, EtatVide, Icone, Squelette } from "@/components/ui";
import { Tuile } from "@/components/ui/Tuile";
import { dateCivile, jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import {
  getMedicationWorkload,
  type MedicationWorkloadRow,
  type MedicationWorkloadSummary,
} from "@/services/medication-workspace";

type Filtre = "tout" | "revue" | "fin";

function aujourdHuiAlger(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function limiteProche(aujourdHui: string): string {
  const date = new Date(`${aujourdHui}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

function attention(row: MedicationWorkloadRow, limite: string): readonly string[] {
  const items: string[] = [];
  if (row.hasOverdueEndDate) items.push(t.charge.finDepassee);
  if (row.hasMissingPosology) items.push(t.charge.posologie);
  if (!row.hasOverdueEndDate && row.nextEndDate !== null && row.nextEndDate <= limite) {
    items.push(t.charge.finProche);
  }
  return items;
}

function medsLisible(row: MedicationWorkloadRow): string {
  return row.meds
    .slice(0, 3)
    .map((m) => [m.medicationName, m.dose, m.doseUnit].filter(Boolean).join(" "))
    .join(" · ");
}

function Resume({ resume }: { readonly resume: MedicationWorkloadSummary }): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
      <Tuile
        etiquette={t.charge.resumePatients}
        valeur={String(resume.patients)}
        icone="patients"
        ton="menthe"
        aide={t.charge.sousTitre}
      />
      <Tuile
        etiquette={t.charge.resumeActifs}
        valeur={String(resume.actifs)}
        icone="traitements"
        ton="azur"
        aide={t.charge.sousTitre}
      />
      <Tuile
        etiquette={t.charge.resumeRevue}
        valeur={String(resume.revue)}
        icone="alerte"
        ton="ambre"
        aide={t.charge.chargeAide}
      />
      <Tuile
        etiquette={t.charge.resumeChangements}
        valeur={String(resume.changements)}
        icone="journalActivite"
        ton="lavande"
        aide={t.charge.changementsAide}
      />
    </div>
  );
}

export function ChargeTraitements(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<readonly MedicationWorkloadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [resume, setResume] = useState<MedicationWorkloadSummary>({
    patients: 0,
    actifs: 0,
    revue: 0,
    changements: 0,
  });
  const [restreint, setRestreint] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [chargementPlus, setChargementPlus] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const today = aujourdHuiAlger();
  const limite = limiteProche(today);

  const charger = useCallback(
    (q: string, offset: number, ajouter: boolean, attention: Filtre) => {
      if (ajouter) setChargementPlus(true);
      else setChargement(true);
      setErreur(null);
      void getMedicationWorkload(q, 30, offset, attention).then((r) => {
        setChargement(false);
        setChargementPlus(false);
        if (!r.ok) {
          setErreur(r.error.message);
          return;
        }
        setRestreint(r.data.restreint);
        setTotal(r.data.total);
        setResume(r.data.resume);
        setRows((precedents) => (ajouter ? [...precedents, ...r.data.rows] : r.data.rows));
      });
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => charger(query, 0, false, filtre), 250);
    return () => clearTimeout(timer);
  }, [query, filtre, charger]);

  const filtrees = rows;

  const revue = useMemo(
    () => rows.filter((row) => attention(row, limite).length > 0).slice(0, 6),
    [rows, limite],
  );

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-3xl bg-tuile-menthe p-6 shadow-carte">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex max-w-form flex-col gap-2">
            <p className="m-0 font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-emeraude-700">
              {t.hero.eyebrow}
            </p>
            <h1 className="m-0 font-editorial text-display font-bold tracking-display text-ink-900">
              {t.charge.titre}
            </h1>
            <p className="m-0 font-ui text-body leading-relaxed text-ink-700">{t.charge.sousTitre}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-emeraude-700 shadow-douce">
              <Icone nom="traitements" taille={24} />
            </span>
            <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.charge.chargeAide}</p>
          </div>
        </div>
      </section>

      {restreint ? (
        <Carte niveau="secondaire">
          <EtatVide message={t.charge.restreint} icone="alerte" />
        </Carte>
      ) : (
        <>
          <Resume resume={resume} />

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-0 flex-1 tablet:max-w-form">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300">
                  <Icone nom="recherche" taille={20} />
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.charge.recherche}
                  aria-label={t.charge.recherche}
                  className="min-h-target w-full rounded-full border border-rule bg-card py-2 pl-11 pr-4 font-ui text-body text-ink-900 shadow-lift1 outline-none transition focus:border-action-600 focus:ring-2 focus:ring-action-600/20"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["tout", t.charge.filtreTout],
                  ["revue", t.charge.filtreRevue],
                  ["fin", t.charge.filtreFinProche],
                ] as const).map(([cle, libelle]) => (
                  <Bouton
                    key={cle}
                    type="button"
                    rang="secondaire"
                    taille="compact"
                    sansFleches
                    enfonce={filtre === cle}
                    onClick={() => setFiltre(cle)}
                  >
                    {libelle}
                  </Bouton>
                ))}
              </div>
            </div>

            {erreur !== null ? (
              <BlocErreur message={erreur} action={<Bouton onClick={() => charger(query, 0, false, filtre)}>{t.commune.reessayer}</Bouton>} />
            ) : chargement && rows.length === 0 ? (
              <Squelette lignes={6} />
            ) : filtrees.length === 0 ? (
              <Carte niveau="secondaire">
                <EtatVide
                  message={t.charge.aucun}
                  action={
                    <Bouton
                      onClick={() => {
                        setQuery("");
                        setFiltre("tout");
                      }}
                    >
                      {t.charge.filtreTout}
                    </Bouton>
                  }
                />
              </Carte>
            ) : (
              <div className="flex flex-col gap-4 desktop:flex-row desktop:items-start">
                <div className="min-w-0 flex-1">
                  <Carte niveau="clinique">
                    <div className="flex flex-col">
                      <div className="hidden items-center gap-3 border-b border-rule bg-sunken px-4 py-2 font-ui text-label font-semibold text-ink-500 tablet:flex">
                        <span className="min-w-0 flex-1">{t.charge.colonneDossier}</span>
                        <span className="min-w-0 flex-1">{t.charge.colonneTraitements}</span>
                        <span className="w-28 shrink-0">{t.charge.colonneDerniere}</span>
                        <span className="w-28 shrink-0">{t.charge.colonneProchain}</span>
                        <span className="w-32 shrink-0">{t.charge.colonneAttention}</span>
                        <span className="w-4 shrink-0" />
                      </div>
                      <ul className="m-0 flex list-none flex-col p-0">
                        {filtrees.map((row) => {
                          const items = attention(row, limite);
                          return (
                            <li key={row.patientId} className="border-b border-rule last:border-b-0">
                              <Link
                                href={`/patients/${encodeURIComponent(row.patientId)}?onglet=traitements`}
                                className="flex flex-wrap items-center gap-3 px-4 py-3 no-underline transition duration-quick hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
                                aria-label={`${row.lastName.toUpperCase()} ${row.firstName} — ${t.charge.ouvrir}`}
                              >
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className="break-words font-ui text-body font-semibold text-ink-900">
                                    {row.lastName.toUpperCase()} {row.firstName}
                                  </span>
                                  <span className="font-num text-label tabular-nums text-ink-500">{row.recordNumber}</span>
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className="break-words font-ui text-body text-ink-700">{medsLisible(row)}</span>
                                  <span className="font-ui text-label text-ink-500">{t.charge.medicaments(row.activeCount)}</span>
                                </span>
                                <span className="w-28 shrink-0 font-num text-label tabular-nums text-ink-700">
                                  {row.lastConsultationAt === null ? t.commune.nonDisponible : (jourLong(row.lastConsultationAt) ?? t.commune.nonDisponible)}
                                </span>
                                <span className="w-28 shrink-0 font-num text-label tabular-nums text-ink-700">
                                  {row.nextAppointmentAt === null ? t.commune.nonDisponible : (jourLong(row.nextAppointmentAt) ?? t.commune.nonDisponible)}
                                </span>
                                <span className="flex w-32 shrink-0 flex-wrap gap-1">
                                  {items.length === 0 ? (
                                    <span className="font-ui text-label text-ink-300">{t.charge.sansAttention}</span>
                                  ) : (
                                    items.map((item) => (
                                      <Badge key={item} ton="attention">
                                        {item}
                                      </Badge>
                                    ))
                                  )}
                                </span>
                                <span className="text-ink-300">
                                  <Icone nom="fleche" taille={16} />
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </Carte>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="m-0 font-ui text-label text-ink-500">
                      {t.charge.resultats(total)}
                    </p>
                    {rows.length < total ? (
                      <Bouton
                        rang="secondaire"
                        onClick={() => charger(query, rows.length, true, filtre)}
                        disabled={chargementPlus}
                      >
                        {chargementPlus ? t.commune.chargement : t.actions.chargerPlus}
                      </Bouton>
                    ) : null}
                  </div>
                </div>

                <aside className="flex w-full flex-col gap-3 desktop:w-charge desktop:shrink-0">
                  <Carte niveau="secondaire">
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.charge.chargeTitre}</h2>
                        <Badge ton={resume.revue === 0 ? "neutre" : "attention"}>{String(resume.revue)}</Badge>
                      </div>
                      {revue.length === 0 ? (
                        resume.revue === 0 ? (
                          <p className="m-0 font-ui text-body text-ink-500">{t.charge.chargeVide}</p>
                        ) : (
                          <Bouton rang="discret" taille="compact" sansFleches onClick={() => setFiltre("revue")}>
                            {t.charge.autresRevue(resume.revue)}
                          </Bouton>
                        )
                      ) : (
                        <>
                          <ul className="m-0 flex list-none flex-col gap-2 p-0">
                            {revue.map((row) => {
                              const items = attention(row, limite);
                              return (
                                <li key={row.patientId}>
                                  <Link
                                    href={`/patients/${encodeURIComponent(row.patientId)}?onglet=traitements`}
                                    className="flex flex-col gap-0.5 rounded-xl bg-card px-3 py-2 no-underline transition hover:bg-tuile-menthe"
                                  >
                                    <span className="font-ui text-label font-semibold text-ink-900">
                                      {row.lastName.toUpperCase()} {row.firstName}
                                    </span>
                                    <span className="font-ui text-label text-ink-500">
                                      {items.length === 0
                                        ? t.charge.sansAttention
                                        : row.nextEndDate === null
                                          ? items.join(" · ")
                                          : `${items.join(" · ")} · ${t.ordonnances.finLe} ${dateCivile(row.nextEndDate) ?? ""}`}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                          {resume.revue > revue.length ? (
                            <Bouton rang="discret" taille="compact" sansFleches onClick={() => setFiltre("revue")}>
                              {t.charge.autresRevue(resume.revue - revue.length)}
                            </Bouton>
                          ) : null}
                        </>
                      )}
                      <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{t.charge.chargeAide}</p>
                    </div>
                  </Carte>

                  <Carte niveau="secondaire">
                    <div className="flex flex-col gap-2 p-4">
                      <h2 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.charge.changementsTitre}</h2>
                      <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{t.charge.changementsAide}</p>
                      <p className="m-0 font-num text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
                        {resume.changements}
                      </p>
                    </div>
                  </Carte>
                </aside>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
