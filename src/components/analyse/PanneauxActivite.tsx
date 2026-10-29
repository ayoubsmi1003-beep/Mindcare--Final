"use client";

/**
 * LES PANNEAUX D'ACTIVITÉ — temps, statuts, rythme.
 *
 * Chaque panneau répond à UNE question, écrite dans son sous-titre. Aucune
 * valeur n'est calculée ici : les comptes viennent de `get_analysis_overview`
 * et ces composants ne font que les disposer et les nommer.
 */

import { Courbe, type PointCourbe } from "@/components/ui/Courbe";
import { BarresComparees, type CategorieBarre } from "@/components/ui/Barres";
import { DonutChart, type DonutChartSegment } from "@/components/ui/donut-chart";
import { analyse } from "@/i18n/analyse";
import {
  ecart,
  formaterNombre,
  libelleSeau,
  titreSeau,
  type Granularite,
} from "@/lib/analyse-series";
import type { PartAnalyse, SeauActivite } from "@/services/analyse";

import { EcartPastille, PanneauAnalyse, type TeinteAnalyse } from "./PanneauAnalyse";

/* ═══════════════════════════════════════════════════════════════════════════
 * ACTIVITÉ DANS LE TEMPS
 * ═══════════════════════════════════════════════════════════════════════════ */

export function ActiviteDansLeTemps({
  serie,
  granularite,
  total,
  precedent,
  onPoint,
}: {
  readonly serie: readonly SeauActivite[];
  readonly granularite: Granularite;
  readonly total: number;
  readonly precedent: number;
  readonly onPoint: (cle: string) => void;
}): React.JSX.Element {
  const e = ecart(total, precedent);
  const points: PointCourbe[] = serie.map((s) => ({
    cle: s.cle,
    libelle: libelleSeau(s.cle, granularite),
    titre: titreSeau(s.cle, granularite),
    valeur: s.couvert ? s.seances : null,
    secondaire: s.couvert ? s.absences : null,
    couvert: s.couvert,
  }));

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.activite.titre}
      question={analyse.panneaux.activite.question}
      icone="statistiques"
      teinte="emeraude"
      delai={40}
      actions={
        <EcartPastille pct={e.pct} absolu={e.absolu} comparaison={analyse.pulse.comparaison} />
      }
    >
      <div className="flex items-baseline gap-2 pb-1">
        <span className="font-ui text-title font-bold tabular-nums text-ink-900">
          {formaterNombre(total)}
        </span>
        <span className="font-ui text-label text-ink-500">{analyse.pulse.seances.toLowerCase()}</span>
      </div>
      <Courbe
        points={points}
        libellePrimaire={analyse.pulse.seances}
        libelleSecondaire={analyse.pulse.absences}
        ariaLabel={analyse.panneaux.activite.titre}
        onPoint={onPoint}
      />
      <LegendeCourbe />
    </PanneauAnalyse>
  );
}

function LegendeCourbe(): React.JSX.Element {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-4">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-0.5 w-5 rounded-full bg-emeraude-600" />
        <span className="font-ui text-label text-ink-700">{analyse.pulse.seances}</span>
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="h-0.5 w-5 rounded-full border-t-2 border-dashed border-ambre-600" />
        <span className="font-ui text-label text-ink-700">{analyse.pulse.absences}</span>
      </li>
    </ul>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * STATUTS DES RENDEZ-VOUS
 * ═══════════════════════════════════════════════════════════════════════════ */

const COULEUR_STATUT: Record<string, string> = {
  completed: "var(--emeraude-600)",
  arrived: "var(--aqua-600)",
  in_session: "var(--azure-600)",
  confirmed: "var(--azure-600)",
  requested: "var(--muted-foreground)",
  no_show: "var(--ambre-600)",
  cancelled: "var(--corail-600)",
};

/** L'ordre de lecture : ce qui a eu lieu, puis ce qui est prévu, puis l'écart. */
const ORDRE_STATUT = [
  "completed",
  "arrived",
  "in_session",
  "confirmed",
  "requested",
  "no_show",
  "cancelled",
];

export function StatutsRendezVous({
  statuts,
  onStatut,
}: {
  readonly statuts: readonly PartAnalyse[];
  readonly onStatut: (cle: string) => void;
}): React.JSX.Element {
  const rang = new Map(ORDRE_STATUT.map((s, i) => [s, i] as const));
  const ordonnees = [...statuts].sort(
    (a, b) => (rang.get(a.cle) ?? 99) - (rang.get(b.cle) ?? 99),
  );
  const total = ordonnees.reduce((s, p) => s + p.n, 0);

  const segments: DonutChartSegment[] = ordonnees.map((s) => ({
    value: s.n,
    color: COULEUR_STATUT[s.cle] ?? "var(--muted-foreground)",
    label: analyse.statuts[s.cle] ?? s.cle,
  }));

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.statuts.titre}
      question={analyse.panneaux.statuts.question}
      icone="agenda"
      teinte="aqua"
      delai={80}
    >
      {total === 0 ? (
        <p className="py-8 text-center font-ui text-body text-ink-500">{analyse.etats.vide}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="mx-auto">
            <DonutChart
              data={segments}
              totalValue={total}
              size={168}
              strokeWidth={16}
              ariaLabel={analyse.panneaux.statuts.titre}
              centerContent={
                <span className="flex flex-col items-center">
                  <span className="font-ui text-title font-extrabold tabular-nums text-ink-900">
                    {formaterNombre(total)}
                  </span>
                  <span className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
                    rendez-vous
                  </span>
                </span>
              }
            />
          </div>
          <ul className="flex flex-col gap-0.5">
            {ordonnees.map((s) => (
              <li key={s.cle}>
                <button
                  type="button"
                  onClick={() => onStatut(s.cle)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left transition hover:bg-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: COULEUR_STATUT[s.cle] ?? "var(--muted-foreground)" }}
                    />
                    <span className="truncate font-ui text-label text-ink-700">
                      {analyse.statuts[s.cle] ?? s.cle}
                    </span>
                  </span>
                  <span className="shrink-0 font-num text-label font-semibold tabular-nums text-ink-900">
                    {formaterNombre(s.n)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PanneauAnalyse>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * NOUVEAUX ET RETOURS
 * ═══════════════════════════════════════════════════════════════════════════ */

export function NouveauxEtRetours({
  nouveaux,
  retours,
  onNouveaux,
  onRetours,
}: {
  readonly nouveaux: number;
  readonly retours: number;
  readonly onNouveaux: () => void;
  readonly onRetours: () => void;
}): React.JSX.Element {
  const total = nouveaux + retours;

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.nouveauxRetours.titre}
      question={analyse.panneaux.nouveauxRetours.question}
      icone="patients"
      teinte="azure"
      delai={120}
    >
      {total === 0 ? (
        <p className="py-6 text-center font-ui text-body text-ink-500">{analyse.etats.vide}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {/* Une barre empilée de deux parts : la largeur est une GÉOMÉTRIE,
              les libellés portent les COMPTES. Aucun pourcentage affiché. */}
          <div className="flex h-9 w-full overflow-hidden rounded-lg">
            <button
              type="button"
              onClick={onNouveaux}
              style={{ flexGrow: nouveaux }}
              className="group relative min-w-0 bg-emeraude-600 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
              aria-label={`${analyse.panneaux.nouveauxRetours.nouveaux} — ${analyse.actions.voirDossiers}`}
            >
              <span className="absolute inset-0 flex items-center justify-center font-num text-label font-semibold tabular-nums text-white">
                {nouveaux > 0 ? formaterNombre(nouveaux) : ""}
              </span>
            </button>
            <button
              type="button"
              onClick={onRetours}
              style={{ flexGrow: retours }}
              className="group relative min-w-0 bg-aqua-600 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
              aria-label={`${analyse.panneaux.nouveauxRetours.retours} — ${analyse.actions.voirDossiers}`}
            >
              <span className="absolute inset-0 flex items-center justify-center font-num text-label font-semibold tabular-nums text-white">
                {retours > 0 ? formaterNombre(retours) : ""}
              </span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onNouveaux}
              className="plaque-analyse flex flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600"
            >
              <span className="flex items-center gap-1.5 font-ui text-label text-ink-500">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emeraude-600" />
                {analyse.panneaux.nouveauxRetours.nouveaux}
              </span>
              <span className="font-ui text-title font-bold tabular-nums text-ink-900">
                {formaterNombre(nouveaux)}
              </span>
            </button>
            <button
              type="button"
              onClick={onRetours}
              className="plaque-analyse flex flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600"
            >
              <span className="flex items-center gap-1.5 font-ui text-label text-ink-500">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-aqua-600" />
                {analyse.panneaux.nouveauxRetours.retours}
              </span>
              <span className="font-ui text-title font-bold tabular-nums text-ink-900">
                {formaterNombre(retours)}
              </span>
            </button>
          </div>
        </div>
      )}
    </PanneauAnalyse>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RYTHME DE LA SEMAINE
 * ═══════════════════════════════════════════════════════════════════════════ */

export function RythmeSemaine({
  jours,
  onJour,
}: {
  readonly jours: readonly PartAnalyse[];
  readonly onJour: (cle: string) => void;
}): React.JSX.Element {
  const parCle = new Map(jours.map((j) => [j.cle, j.n] as const));
  const categories: CategorieBarre[] = ["1", "2", "3", "4", "5", "6", "7"].map((cle) => ({
    cle,
    libelle: (analyse.jours[cle] ?? cle).slice(0, 1),
    titre: analyse.jours[cle] ?? cle,
  }));
  const valeurs = categories.map((c) => parCle.get(c.cle) ?? 0);

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.semaine.titre}
      question={analyse.panneaux.semaine.question}
      icone="agenda"
      teinte="violet"
      delai={160}
    >
      <BarresComparees
        categories={categories}
        series={[
          {
            cle: "rdv",
            libelle: analyse.panneaux.semaine.titre,
            famille: "violet",
            valeurs,
          },
        ]}
        hauteur={132}
        ariaLabel={analyse.panneaux.semaine.titre}
        onCategorie={onJour}
      />
    </PanneauAnalyse>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MOMENTS DE LA JOURNÉE
 * ═══════════════════════════════════════════════════════════════════════════ */

export function MomentsJournee({
  heures,
  onHeure,
}: {
  readonly heures: readonly PartAnalyse[];
  readonly onHeure: (cle: string) => void;
}): React.JSX.Element {
  const parCle = new Map(heures.map((h) => [h.cle, h.n] as const));
  const bornes = heures.length === 0 ? [] : heures.map((h) => Number(h.cle)).sort((a, b) => a - b);
  const debut = Math.min(...(bornes.length === 0 ? [8] : bornes));
  const fin = Math.max(...(bornes.length === 0 ? [18] : bornes));
  const categories: CategorieBarre[] = [];
  for (let h = Math.max(0, debut); h <= Math.min(23, fin); h += 1) {
    const cle = String(h);
    categories.push({
      cle,
      libelle: `${String(h).padStart(2, "0")}h`,
      titre: `${String(h).padStart(2, "0")}:00 – ${String(h + 1).padStart(2, "0")}:00`,
    });
  }
  const valeurs = categories.map((c) => parCle.get(c.cle) ?? 0);

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.heures.titre}
      question={analyse.panneaux.heures.question}
      icone="horloge"
      teinte="ambre"
      delai={200}
    >
      <BarresComparees
        categories={categories}
        series={[
          {
            cle: "rdv",
            libelle: analyse.panneaux.heures.titre,
            famille: "ambre",
            valeurs,
          },
        ]}
        hauteur={132}
        etiquettesMax={6}
        ariaLabel={analyse.panneaux.heures.titre}
        onCategorie={onHeure}
      />
    </PanneauAnalyse>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * DÉLAI ENTRE DEUX SÉANCES
 * ═══════════════════════════════════════════════════════════════════════════ */

const ORDRE_DELAI = ["0-7", "8-30", "31-90", "91-180", "181+"];

export function DelaisSuivi({
  delais,
  onDelai,
}: {
  readonly delais: readonly PartAnalyse[];
  readonly onDelai: (cle: string) => void;
}): React.JSX.Element {
  const parCle = new Map(delais.map((d) => [d.cle, d.n] as const));
  const lignes = ORDRE_DELAI.map((cle) => ({
    cle,
    libelle: analyse.delais[cle] ?? cle,
    valeur: parCle.get(cle) ?? 0,
    detail: analyse.panneaux.delais.titre,
  })).filter((l) => l.valeur > 0);

  const total = lignes.reduce((s, l) => s + l.valeur, 0);

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.delais.titre}
      question={analyse.panneaux.delais.question}
      icone="horloge"
      teinte="aqua"
      delai={240}
      pied={analyse.panneaux.delais.aide}
    >
      {total === 0 ? (
        <p className="py-6 text-center font-ui text-body text-ink-500">
          {analyse.etats.insuffisantAide}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lignes.map((l) => {
            const pct = total === 0 ? 0 : Math.round((l.valeur * 100) / total);
            return (
              <li key={l.cle}>
                <button
                  type="button"
                  onClick={() => onDelai(l.cle)}
                  className="group flex w-full min-w-0 flex-col gap-1 rounded-md px-1 py-0.5 text-left transition hover:bg-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-ui text-label text-ink-700">{l.libelle}</span>
                    <span className="shrink-0 font-num text-label font-semibold tabular-nums text-ink-900">
                      {formaterNombre(l.valeur)}
                      <span className="ml-1.5 font-ui font-normal text-ink-500">· {pct} %</span>
                    </span>
                  </span>
                  <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-white/70">
                    <span
                      className="analyse-pousse absolute inset-y-0 left-0 rounded-full bg-aqua-600"
                      style={{ width: `${Math.max(1.5, pct)}%`, transformOrigin: "left center" }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanneauAnalyse>
  );
}
