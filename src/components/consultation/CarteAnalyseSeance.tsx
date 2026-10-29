"use client";

import { BorderBeamPanel, Bouton, EtatVide, Icone, PastilleIcone } from "@/components/ui";
import { cliniqueUi } from "@/i18n/clinical-ui";
import { fr } from "@/i18n/fr";
import type { AnalyseSeance } from "@/services/jarvis";

/**
 * L'analyse de séance, dans le fil principal de la consultation.
 *
 * Elle était auparavant dans le rail de contexte : un résultat qui existe mais
 * qu'on ne voit pas ne rend pas service. La carte affiche toujours un état —
 * absente, en cours, en échec, ou prête — et ne fabrique jamais de contenu.
 */
export function CarteAnalyseSeance({
  analyse,
  enAnalyse,
  erreur,
  noteVide,
  echellesCount,
  onAnalyser,
  onAnnuler,
}: {
  readonly analyse: AnalyseSeance | null;
  readonly enAnalyse: boolean;
  readonly erreur: string | undefined;
  readonly noteVide: boolean;
  readonly echellesCount: number;
  readonly onAnalyser: () => void;
  readonly onAnnuler: () => void;
}): React.JSX.Element {
  const method = analyse !== null
    && analyse.resumeNotes !== undefined
    && analyse.resume !== analyse.resumeNotes
    ? "structured"
    : analyse?.method;
  const methodLabel = method === "extractive"
    ? cliniqueUi.resume.methodeExtraite
    : method === "structured"
      ? cliniqueUi.resume.methodeStructuree
      : cliniqueUi.resume.methodeReformulee;

  return (
    <BorderBeamPanel
      beams={analyse === null ? 1 : 2}
      thickness={1.75}
      radius={24}
      idleSpeed={20}
      hoverSpeed={100}
      glow={analyse !== null}
      seed={5}
      className="p-0"
    >
      <section aria-labelledby="titre-analyse-seance" className="flex flex-col gap-4 bg-card p-5 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PastilleIcone nom="resume" ton="action" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="m-0 font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-action-700">
                {fr.consultation.assistance}
              </p>
              <h2 id="titre-analyse-seance" className="m-0 font-ui text-title font-bold tracking-title text-ink-900">
                {cliniqueUi.resume.synthese}
              </h2>
              <p className="m-0 font-ui text-label text-ink-500">
                {analyse === null
                  ? cliniqueUi.resume.analyseAbsenteCorps
                  : `${methodLabel} · ${analyse.sources.historiqueNotes > 0 ? `${String(analyse.sources.historiqueNotes)} séance(s) antérieure(s)` : "séance du jour"}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enAnalyse ? (
              <Bouton rang="secondaire" taille="compact" onClick={onAnnuler}>
                {fr.actions.annuler}
              </Bouton>
            ) : (
              <Bouton
                rang={analyse === null ? "principal" : "secondaire"}
                taille="compact"
                onClick={onAnalyser}
                disabled={noteVide && echellesCount === 0}
              >
                {analyse === null ? cliniqueUi.resume.analyser : cliniqueUi.resume.analyseRelancer}
              </Bouton>
            )}
          </div>
        </header>

        <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{fr.disclaimer}</p>

        {enAnalyse ? (
          <div className="flex items-center gap-3 rounded-2xl border border-action-100 bg-action-50 px-4 py-4">
            <span className="inline-flex h-9 w-9 animate-respire items-center justify-center rounded-full bg-action-600 text-white">
              <Icone nom="jarvis" taille={20} />
            </span>
            <div className="flex flex-col gap-0.5">
              <p className="m-0 font-ui text-body font-semibold text-ink-900">{cliniqueUi.resume.analyseEnCours}</p>
              <p className="m-0 font-ui text-label text-ink-500">{cliniqueUi.resume.paragrapheUnique}</p>
            </div>
          </div>
        ) : erreur !== undefined ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-attention bg-attention-bg px-4 py-3">
            <p className="m-0 font-ui text-body font-medium text-attention-ink">{erreur}</p>
            <p className="m-0 font-ui text-label text-ink-700">{cliniqueUi.resume.analyseIndisponible}</p>
          </div>
        ) : analyse === null ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-action-100 bg-gradient-to-br from-action-50 via-card to-azure-050 px-4 py-4 sm:flex-row sm:items-center">
            <div className="flex flex-col gap-1">
              <p className="m-0 font-ui text-body font-semibold text-ink-900">{cliniqueUi.resume.analyseAbsenteTitre}</p>
              <p className="m-0 max-w-prose font-ui text-label leading-relaxed text-ink-700">
                {cliniqueUi.resume.analyseAbsenteCorps}
              </p>
            </div>
            <span className="hidden text-action-600 sm:inline-flex" aria-hidden="true">
              <Icone nom="jarvis" taille={24} />
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {analyse.resume === undefined || analyse.resume.trim() === "" ? (
              <EtatVide message={cliniqueUi.resume.analyseAbsenteCorps} />
            ) : (
              <p className="m-0 max-w-prose break-words font-ui text-body leading-notes text-ink-900">
                {analyse.resume.replace(/\s*\n+\s*/gu, " ")}
              </p>
            )}

            {analyse.evaluations.length === 0 ? null : (
              <div className="flex flex-wrap gap-2">
                {analyse.evaluations.map((evaluation) => (
                  <span
                    key={`${evaluation.scaleCode}-${evaluation.administeredAt}`}
                    className="inline-flex flex-wrap items-baseline gap-1.5 rounded-full border border-azure-200 bg-azure-050 px-3 py-1.5 font-ui text-label text-ink-700"
                  >
                    <span className="font-semibold text-azure-700">{evaluation.scaleName}</span>
                    <span className="font-num text-body font-bold tabular-nums text-ink-900">
                      {evaluation.score === null ? "—" : String(evaluation.score)}
                      {evaluation.max === null ? "" : `/${String(evaluation.max)}`}
                    </span>
                    {evaluation.interpretation === null ? null : <span className="text-ink-500">{evaluation.interpretation}</span>}
                  </span>
                ))}
              </div>
            )}

            {analyse.evolution.length === 0 ? null : (
              <div className="flex flex-col gap-1.5">
                <p className="m-0 font-ui text-label font-semibold tracking-label text-ink-500">{fr.consultation.evolutionTitre}</p>
                <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 font-ui text-body text-ink-900">
                  {analyse.evolution.map((ligne) => <li key={ligne}>{ligne}</li>)}
                </ul>
              </div>
            )}

            {analyse.pointsNonExplores.length === 0 ? null : (
              <div className="flex flex-col gap-1.5">
                <p className="m-0 font-ui text-label font-semibold tracking-label text-ink-500">
                  {fr.consultation.pointsNonExploresTitre}
                </p>
                <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 font-ui text-body text-ink-900">
                  {analyse.pointsNonExplores.map((ligne) => <li key={ligne}>{ligne}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </BorderBeamPanel>
  );
}
