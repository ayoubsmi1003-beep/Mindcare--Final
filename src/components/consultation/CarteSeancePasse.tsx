"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BorderBeamPanel, Bouton, Icone, PastilleIcone, Squelette } from "@/components/ui";
import { jourLong, heure } from "@/components/patients/format";
import { cliniqueUi } from "@/i18n/clinical-ui";
import { analyzeSession, chargerAnalyse, type AnalyseSeance } from "@/services/jarvis";
import { getConsultation, type Consultation } from "@/services/consultations";
import type { TimelineEvent } from "@/services/patients";

import { enqueueChargeSeance } from "./charge-seance";
import { DetailSeanceAccordion } from "./DetailSeanceAccordion";
import { resumeDeSeance } from "./resume-seance";

interface Charge {
  readonly seance: Consultation | null;
  readonly analyse: AnalyseSeance | null;
  readonly erreur: string | undefined;
}

/**
 * Une séance passée, résumé d'abord.
 *
 * Le parent décide si le résumé doit être chargé tout de suite (les trois
 * dernières séances) ou à la demande (les plus anciennes) : chaque lecture
 * passe par les portes journalisantes, on ne lit donc pas cinquante dossiers
 * pour afficher une liste.
 */
export function CarteSeancePasse({
  evenement,
  chargementAuto = false,
  ouverteParDefaut = false,
}: {
  readonly evenement: TimelineEvent;
  readonly chargementAuto?: boolean;
  readonly ouverteParDefaut?: boolean;
}): React.JSX.Element {
  const [detail, setDetail] = useState<Charge | undefined>(undefined);
  const [ouverte, setOuverte] = useState(ouverteParDefaut);
  const [chargement, setChargement] = useState(false);
  const [analyseEnCours, setAnalyseEnCours] = useState(false);
  const [erreurAnalyse, setErreurAnalyse] = useState<string | undefined>(undefined);

  const charger = useCallback((): void => {
    if (detail !== undefined || chargement) return;
    setChargement(true);
    void enqueueChargeSeance(() => Promise.all([
      getConsultation(evenement.eventId),
      chargerAnalyse(evenement.eventId),
    ])).then(([seance, analyse]) => {
      setChargement(false);
      setDetail({
        seance: seance.ok ? seance.data : null,
        analyse: analyse.ok ? analyse.data : null,
        erreur: seance.ok ? undefined : seance.error.message,
      });
    });
  }, [detail, chargement, evenement.eventId]);

  useEffect(() => {
    if (!chargementAuto) return;
    charger();
  }, [chargementAuto, charger]);

  function analyser(): void {
    setErreurAnalyse(undefined);
    setAnalyseEnCours(true);
    void analyzeSession(evenement.eventId).then((resultat) => {
      setAnalyseEnCours(false);
      if (!resultat.ok) {
        setErreurAnalyse(cliniqueUi.resume.analyseIndisponible);
        return;
      }
      const analyse = resultat.data;
      setDetail((courant) => ({
        seance: courant?.seance ?? null,
        analyse,
        erreur: courant?.erreur,
      }));
      setOuverte(true);
    });
  }

  const resume = detail === undefined
    ? null
    : resumeDeSeance(detail.analyse, detail.seance);
  const jour = jourLong(evenement.occurredAt);
  const h = heure(evenement.occurredAt);

  return (
    <BorderBeamPanel
      beams={1}
      thickness={1.75}
      radius={22}
      idleSpeed={22}
      hoverSpeed={110}
      className="p-0"
      seed={Number.parseInt(evenement.eventId.slice(-6), 16) || 1}
    >
      <article className="flex flex-col gap-4 p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PastilleIcone nom="resume" ton="action" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="m-0 font-ui text-body font-semibold text-ink-900">
                {cliniqueUi.seances.seanceDu(jour ?? cliniqueUi.commun.dateInconnue, h)}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-label text-ink-500">
                {evenement.practitionerName === null ? null : <span>{evenement.practitionerName}</span>}
                <span aria-hidden="true">·</span>
                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-ui text-eyebrow font-semibold uppercase tracking-label",
                    detail === undefined
                      ? "border-rule bg-sunken text-ink-500"
                      : detail.analyse === null
                        ? "border-rule bg-sunken text-ink-500"
                        : "border-positive bg-positive-bg text-positive",
                  ].join(" ")}
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                  {detail === undefined
                    ? cliniqueUi.commun.chargement
                    : detail.analyse === null
                      ? cliniqueUi.seances.analyseAbsente
                      : detail.analyse.aJour
                        ? cliniqueUi.seances.analyseDisponible
                        : cliniqueUi.seances.analyseAncienne}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {detail?.analyse === null || detail?.analyse?.aJour === false ? (
              <Bouton rang="principal" taille="compact" onClick={analyser} disabled={analyseEnCours}>
                {analyseEnCours
                  ? cliniqueUi.resume.analyseEnCoursCourt
                  : detail?.analyse === null
                    ? cliniqueUi.resume.analyser
                    : cliniqueUi.resume.analyseRelancer}
              </Bouton>
            ) : null}
            <Bouton
              rang="secondaire"
              taille="compact"
              onClick={() => {
                if (!ouverte) charger();
                setOuverte((valeur) => !valeur);
              }}
              deploye={ouverte}
            >
              {ouverte ? cliniqueUi.commun.masquerDetail : cliniqueUi.commun.voirDetail}
            </Bouton>
          </div>
        </header>

        {detail === undefined ? (
          chargementAuto || chargement ? (
            <div className="flex flex-col gap-2">
              <Squelette lignes={2} />
              <p className="m-0 font-ui text-label text-ink-500">{cliniqueUi.commun.chargement}</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={charger}
              className="flex min-h-target items-center gap-2 self-start rounded-xl border border-dashed border-rule px-3 py-2 font-ui text-label text-ink-500 outline-none transition-colors duration-quick hover:border-action-500 hover:text-ink-900 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
            >
              <Icone nom="documents" taille={16} />
              {cliniqueUi.seances.voirNotes}
            </button>
          )
        ) : resume === null || resume.source === "aucun" ? (
          <div className="flex flex-col gap-1 rounded-2xl border border-rule bg-sunken/70 px-4 py-3">
            <p className="m-0 font-ui text-label font-medium text-ink-700">{cliniqueUi.seances.resumeAbsent}</p>
            <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{cliniqueUi.seances.resumeAbsentAide}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-action-700">
                {resume.source === "analyse" ? cliniqueUi.resume.synthese : cliniqueUi.resume.syntheseFactuelle}
              </span>
              {detail.analyse === null ? (
                <span className="rounded-full border border-rule bg-sunken px-2 py-0.5 font-ui text-eyebrow text-ink-500">
                  {cliniqueUi.resume.syntheseFactuelleAide}
                </span>
              ) : null}
            </div>
            <p className="m-0 max-w-prose whitespace-pre-line break-words font-ui text-body leading-relaxed text-ink-900">
              {resume.texte}
            </p>
            {resume.actions.length === 0 ? null : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="font-ui text-label font-semibold tracking-label text-ink-500">
                  {cliniqueUi.resume.actions}
                </span>
                {resume.actions.slice(0, 3).map((action) => (
                  <span key={action} className="rounded-full border border-rule bg-card px-2.5 py-1 font-ui text-label text-ink-700">
                    {action}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {erreurAnalyse === undefined ? null : (
          <p role="alert" className="m-0 rounded-xl border border-attention bg-attention-bg px-3 py-2 font-ui text-label text-attention-ink">
            {erreurAnalyse}
          </p>
        )}

        {ouverte && detail !== undefined ? (
          <div className="border-t border-rule pt-4">
            {detail.erreur === undefined ? null : (
              <p role="alert" className="m-0 mb-3 rounded-xl border border-attention bg-attention-bg px-3 py-2 font-ui text-label text-attention-ink">
                {detail.erreur}
              </p>
            )}
            <DetailSeanceAccordion detail={detail} resumeExterne />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                href={`/consultation/${evenement.eventId}`}
                className="inline-flex min-h-target items-center gap-2 rounded-lg font-ui text-label font-medium text-action-700 outline-none transition-colors duration-quick hover:text-action-900 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
              >
                {cliniqueUi.seances.ouvrirConsultation}
                <Icone nom="fleche" taille={16} />
              </Link>
            </div>
          </div>
        ) : null}
      </article>
    </BorderBeamPanel>
  );
}
