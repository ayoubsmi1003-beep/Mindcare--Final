"use client";

/**
 * LA SYNTHÈSE — une vedette, quatre satellites.
 *
 * ⚠️ UNE SEULE TUILE VEDETTE PAR ÉCRAN, et c'est le principe : hiérarchiser
 * tout revient à ne rien hiérarchiser. Le chiffre que l'œil cherche en premier
 * est le nombre de séances ; le reste est à un niveau en dessous, et l'est
 * visuellement (matière claire, corps plus petit).
 *
 * ⚠️ LES VALEURS SONT SUR DES PLAQUES OPAQUES. Le verre est le cadre ; un
 * contraste qui dépend de ce qui défile derrière n'est pas un contraste.
 */

import { analyse } from "@/i18n/analyse";
import { ecart, formaterNombre } from "@/lib/analyse-series";
import { cn } from "@/lib/utils";
import type { FluxAnalyse, PulseAnalyse, SeauActivite, CleDetail } from "@/services/analyse";

import { EcartPastille } from "./PanneauAnalyse";

/** Le tracé blanc de la vedette — décor d'agrégat, jamais une valeur cliquable. */
function EtincelleVedette({ valeurs }: { readonly valeurs: readonly number[] }): React.JSX.Element | null {
  if (valeurs.length < 2) return null;
  const max = Math.max(1, ...valeurs);
  const pas = 100 / (valeurs.length - 1);
  const points = valeurs
    .map((v, i) => `${(i * pas).toFixed(2)},${(100 - (v / max) * 78).toFixed(2)}`)
    .join(" ");
  const aire = `0,100 ${points} 100,100`;
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full opacity-50"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="vedette-aire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={aire} fill="url(#vedette-aire)" />
      <polyline
        points={points}
        fill="none"
        stroke="rgba(255,255,255,0.72)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TuileSatellite({
  etiquette,
  aide,
  valeur,
  detail,
  onClick,
}: {
  readonly etiquette: string;
  readonly aide: string;
  readonly valeur: number;
  readonly detail?: React.ReactNode;
  readonly onClick?: () => void;
}): React.JSX.Element {
  const cliquable = onClick !== undefined;
  return (
    <button
      type="button"
      disabled={!cliquable}
      onClick={onClick}
      title={aide}
      className={cn(
        "verre-panneau verre-liseret group flex min-w-0 flex-col justify-between gap-2 p-4 text-left",
        cliquable
          ? "transition duration-quick ease-soft hover:-translate-y-px hover:shadow-elevee focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
          : "cursor-default",
      )}
    >
      <span className="font-ui text-label font-medium text-ink-500">{etiquette}</span>
      <span className="font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900">
        {formaterNombre(valeur)}
      </span>
      {detail === undefined ? null : <span className="min-h-5">{detail}</span>}
    </button>
  );
}

export function Synthese({
  pulse,
  comparaison,
  serie,
  onOuvrir,
}: {
  readonly pulse: PulseAnalyse;
  readonly comparaison: FluxAnalyse;
  readonly serie: readonly SeauActivite[];
  readonly onOuvrir: (kind: CleDetail) => void;
}): React.JSX.Element {
  const seances = ecart(pulse.seances, comparaison.seances);
  const vues = ecart(pulse.patientes_vues, comparaison.patientes_vues);
  const nouveaux = ecart(pulse.nouveaux, comparaison.nouveaux);
  const retours = ecart(pulse.retours, comparaison.retours);
  const absences = ecart(pulse.absences, comparaison.absences);

  const serieVedette = serie.map((s) => (s.couvert ? s.seances : 0));

  return (
    <div className="grid grid-cols-1 gap-3 desktop:grid-cols-12">
      {/* La vedette — 5 colonnes, deux rangées. */}
      <button
        type="button"
        onClick={() => onOuvrir("seances")}
        className="verre-vedette analyse-monte group relative flex min-h-[13.5rem] flex-col justify-between overflow-hidden p-6 text-left transition duration-quick ease-soft hover:shadow-vedette focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600 desktop:col-span-5 desktop:row-span-2"
        style={{ ["--delai" as string]: "0ms" }}
      >
        <EtincelleVedette valeurs={serieVedette} />
        <span className="relative z-10 flex items-center gap-2 font-ui text-label font-medium text-on-brand/80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emeraude-400" aria-hidden="true" />
          {analyse.pulse.seances}
          <span className="text-on-brand/60">·</span>
          <span className="font-normal text-on-brand/60">{analyse.pulse.comparaison}</span>
        </span>

        <span className="relative z-10 flex flex-col gap-2 pb-12">
          <span className="flex flex-wrap items-end gap-3">
            <span className="font-ui text-[3.4rem] font-extrabold leading-none tabular-nums tracking-[-0.04em] text-on-brand">
              {formaterNombre(pulse.seances)}
            </span>
            {seances.pct === null ? (
              <span className="mb-1 inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2.5 py-0.5 font-ui text-label font-medium text-on-brand/80">
                {analyse.etats.sansComparaison}
              </span>
            ) : (
              <span className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-2.5 py-0.5 font-ui text-label font-semibold text-on-brand backdrop-blur-sm">
                <span aria-hidden="true">{seances.pct > 0 ? "↑" : seances.pct < 0 ? "↓" : "→"}</span>
                <span className="font-num tabular-nums">
                  {seances.pct > 0 ? "+" : ""}
                  {seances.pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
                </span>
              </span>
            )}
          </span>
          <span className="max-w-[34ch] font-ui text-label leading-snug text-on-brand/70">
            {analyse.pulse.seancesAide}
          </span>
        </span>
      </button>

      {/* Les quatre satellites — 7 colonnes, 2 × 2. */}
      <div className="grid grid-cols-2 gap-3 desktop:col-span-7">
        <TuileSatellite
          etiquette={analyse.pulse.patientesVues}
          aide={analyse.pulse.patientesVuesAide}
          valeur={pulse.patientes_vues}
          onClick={() => onOuvrir("patientes_vues")}
          detail={<EcartPastille pct={vues.pct} absolu={vues.absolu} comparaison={analyse.pulse.comparaison} taille="petit" />}
        />
        <TuileSatellite
          etiquette={analyse.pulse.nouveaux}
          aide={analyse.pulse.nouveauxAide}
          valeur={pulse.nouveaux}
          onClick={() => onOuvrir("nouveaux")}
          detail={<EcartPastille pct={nouveaux.pct} absolu={nouveaux.absolu} comparaison={analyse.pulse.comparaison} taille="petit" />}
        />
        <TuileSatellite
          etiquette={analyse.pulse.retours}
          aide={analyse.pulse.retoursAide}
          valeur={pulse.retours}
          onClick={() => onOuvrir("retours")}
          detail={<EcartPastille pct={retours.pct} absolu={retours.absolu} comparaison={analyse.pulse.comparaison} taille="petit" />}
        />
        <TuileSatellite
          etiquette={analyse.pulse.absences}
          aide={analyse.pulse.absencesAide}
          valeur={pulse.absences}
          onClick={() => onOuvrir("absences")}
          detail={<EcartPastille pct={absences.pct} absolu={absences.absolu} comparaison={analyse.pulse.comparaison} taille="petit" />}
        />
      </div>
    </div>
  );
}
