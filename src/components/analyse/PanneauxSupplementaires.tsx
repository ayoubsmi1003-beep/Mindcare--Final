"use client";

/**
 * LES CINQ GRAPHIQUES SUPPLÉMENTAIRES — âges, modalités, durées, continuité,
 * diagnostics dans le temps.
 *
 * ⚠️ AUCUN N'EST UNE CARTE DE CHIFFRES. Chacun porte une forme : barres
 * appariées, barres classées, histogramme, courbe. Les comptes viennent de
 * `app.analysis_extra` ; ici on ne calcule qu'une hauteur et une position.
 */

import { BarresRang } from "@/components/ui/Barres";
import { Courbe, type PointCourbe } from "@/components/ui/Courbe";
import { analyse } from "@/i18n/analyse";
import { formaterNombre, libelleSeau, titreSeau } from "@/lib/analyse-series";
import type {
  BandeAgeAnalyse,
  ContinuiteAnalyse,
  PartAnalyse,
  StockDiagnosticAnalyse,
} from "@/services/analyse";

import { Histogramme, PyramideAges } from "./GraphiquesSupplementaires";
import { PanneauAnalyse } from "./PanneauAnalyse";

/* ── 1 · Pyramide des âges ──────────────────────────────────────────────── */

export function PyramidePanel({
  bandes,
}: {
  readonly bandes: readonly BandeAgeAnalyse[];
}): React.JSX.Element {
  const total = bandes.reduce((s, b) => s + b.f + b.m + b.nr, 0);

  return (
    <PanneauAnalyse
      titre={analyse.supplementaires.ages.titre}
      question={analyse.supplementaires.ages.question}
      icone="patients"
      teinte="aqua"
      delai={440}
      pied={analyse.supplementaires.ages.aide}
    >
      <div className="flex items-baseline gap-2 pb-1">
        <span className="font-ui text-title font-bold tabular-nums text-ink-900">
          {formaterNombre(total)}
        </span>
        <span className="font-ui text-label text-ink-500">
          {analyse.pulse.patientesVues.toLowerCase()}
        </span>
      </div>
      <PyramideAges bandes={bandes} ariaLabel={analyse.supplementaires.ages.titre} />
    </PanneauAnalyse>
  );
}

/* ── 2 · Types de consultation ─────────────────────────────────────────── */

export function TypesConsultation({
  types,
  onType,
}: {
  readonly types: readonly PartAnalyse[];
  readonly onType: (cle: string) => void;
}): React.JSX.Element {
  const total = types.reduce((s, t) => s + t.n, 0);
  const lignes = types.slice(0, 8).map((t) => ({
    cle: t.cle,
    libelle: analyse.types[t.cle] ?? t.cle,
    valeur: t.n,
    ...(total === 0 ? {} : { detail: `${Math.round((t.n * 100) / total)} %` }),
  }));

  return (
    <PanneauAnalyse
      titre={analyse.supplementaires.types.titre}
      question={analyse.supplementaires.types.question}
      icone="agenda"
      teinte="violet"
      delai={480}
      pied={analyse.supplementaires.types.aide}
    >
      {lignes.length === 0 ? (
        <p className="py-8 text-center font-ui text-body text-ink-500">
          {analyse.supplementaires.types.vide}
        </p>
      ) : (
        <BarresRang
          lignes={lignes}
          famille="violet"
          ariaLabel={analyse.supplementaires.types.titre}
          onLigne={onType}
        />
      )}
    </PanneauAnalyse>
  );
}

/* ── 3 · Durée des séances ─────────────────────────────────────────────── */

export function DureesSeances({
  barres,
  mediane,
}: {
  readonly barres: readonly { readonly cle: string; readonly n: number }[];
  readonly mediane: number | null;
}): React.JSX.Element {
  return (
    <PanneauAnalyse
      titre={analyse.supplementaires.durees.titre}
      question={analyse.supplementaires.durees.question}
      icone="horloge"
      teinte="ambre"
      delai={520}
      pied={analyse.supplementaires.durees.aide}
    >
      <Histogramme
        barres={barres}
        mediane={mediane}
        ariaLabel={analyse.supplementaires.durees.titre}
      />
    </PanneauAnalyse>
  );
}

/* ── 4 · Continuité des soins ──────────────────────────────────────────── */

export function ContinuiteSoins({
  points,
}: {
  readonly points: readonly ContinuiteAnalyse[];
}): React.JSX.Element {
  const exploitable = points.some((p) => p.cohorte > 0 && p.pct !== null);

  const serie: PointCourbe[] = points.map((p) => ({
    cle: String(p.horizon),
    libelle: `${p.horizon} j`,
    titre: `${analyse.supplementaires.continuite.horizon} ${p.horizon} ${analyse.supplementaires.continuite.jours} · ${p.revenus}/${p.cohorte}`,
    valeur: p.pct,
    secondaire: p.revenus,
    couvert: p.cohorte > 0,
  }));

  const cohorte = points[0]?.cohorte ?? 0;

  return (
    <PanneauAnalyse
      titre={analyse.supplementaires.continuite.titre}
      question={analyse.supplementaires.continuite.question}
      icone="suivi"
      teinte="emeraude"
      delai={560}
      pied={analyse.supplementaires.continuite.aide}
    >
      {!exploitable ? (
        <p className="py-8 text-center font-ui text-body text-ink-500">
          {analyse.supplementaires.continuite.vide}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 pb-1">
            <span className="font-ui text-title font-bold tabular-nums text-ink-900">
              {formaterNombre(cohorte)}
            </span>
            <span className="font-ui text-label text-ink-500">
              {analyse.supplementaires.continuite.cohorte}
            </span>
          </div>
          <Courbe
            points={serie}
            libellePrimaire="%"
            libelleSecondaire={analyse.supplementaires.continuite.revenus}
            ariaLabel={analyse.supplementaires.continuite.titre}
            hauteur={188}
          />
        </>
      )}
    </PanneauAnalyse>
  );
}

/* ── 5 · Diagnostics actifs dans le temps ──────────────────────────────── */

export function DiagnosticsStock({
  points,
}: {
  readonly points: readonly StockDiagnosticAnalyse[];
}): React.JSX.Element {
  const serie: PointCourbe[] = points.map((p) => ({
    cle: p.cle,
    libelle: libelleSeau(p.cle, "mois"),
    titre: titreSeau(p.cle, "mois"),
    valeur: p.actifs,
    secondaire: p.nouveaux,
    couvert: true,
  }));

  const dernier = points.at(-1);
  const premier = points[0];
  const variation =
    dernier !== undefined && premier !== undefined ? dernier.actifs - premier.actifs : 0;

  return (
    <PanneauAnalyse
      titre={analyse.supplementaires.diagStock.titre}
      question={analyse.supplementaires.diagStock.question}
      icone="statistiques"
      teinte="azure"
      delai={600}
      pied={analyse.supplementaires.diagStock.aide}
    >
      {points.length === 0 ? (
        <p className="py-8 text-center font-ui text-body text-ink-500">
          {analyse.supplementaires.diagStock.vide}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1">
            <span className="font-ui text-title font-bold tabular-nums text-ink-900">
              {formaterNombre(dernier?.actifs ?? 0)}
            </span>
            <span className="font-ui text-label text-ink-500">
              {analyse.supplementaires.diagStock.actifs.toLowerCase()}
            </span>
            {variation !== 0 ? (
              <span className="font-num text-label tabular-nums text-ink-500">
                {variation > 0 ? "+" : "−"}
                {formaterNombre(Math.abs(variation))} {analyse.supplementaires.diagStock.nouveaux.toLowerCase()}
              </span>
            ) : null}
          </div>
          <Courbe
            points={serie}
            libellePrimaire={analyse.supplementaires.diagStock.actifs}
            libelleSecondaire={analyse.supplementaires.diagStock.nouveaux}
            ariaLabel={analyse.supplementaires.diagStock.titre}
            hauteur={188}
          />
        </>
      )}
    </PanneauAnalyse>
  );
}
