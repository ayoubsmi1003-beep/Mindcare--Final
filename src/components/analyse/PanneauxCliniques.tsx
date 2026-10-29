"use client";

/**
 * LES PANNEAUX CLINIQUES — diagnostics, échelles, qualité, traitements.
 *
 * ⚠️ RIEN ICI N'INTERPRÈTE UNE DONNÉE CLINIQUE. Les diagnostics sont rendus
 * avec le libellé STOCKÉ, les échelles avec le barème de l'instrument, et
 * aucun texte ne dit « amélioration », « efficacité » ou « adhérence » : le
 * logiciel n'enregistre pas de quoi le savoir.
 */

import { BarresRang } from "@/components/ui/Barres";
import { analyse } from "@/i18n/analyse";
import { formaterNombre } from "@/lib/analyse-series";
import type { DiagnosticAnalyse, EchelleAnalyse } from "@/services/analyse";

import { PanneauAnalyse } from "./PanneauAnalyse";

/* ═══════════════════════════════════════════════════════════════════════════
 * DIAGNOSTICS DOCUMENTÉS
 * ═══════════════════════════════════════════════════════════════════════════ */

export function DiagnosticsDocumentes({
  diagnostics,
  onDiagnostic,
}: {
  readonly diagnostics: readonly DiagnosticAnalyse[];
  readonly onDiagnostic: (label: string) => void;
}): React.JSX.Element {
  return (
    <PanneauAnalyse
      titre={analyse.panneaux.diagnostics.titre}
      question={analyse.panneaux.diagnostics.question}
      icone="suivi"
      teinte="emeraude"
      delai={280}
      pied={analyse.panneaux.diagnostics.aide}
    >
      {diagnostics.length === 0 ? (
        <p className="py-6 text-center font-ui text-body text-ink-500">
          {analyse.panneaux.diagnostics.vide}
        </p>
      ) : (
        <BarresRang
          lignes={diagnostics.map((d) => ({
            cle: d.label,
            libelle: d.label,
            valeur: d.total,
            detail:
              d.actifs === d.total
                ? analyse.panneaux.diagnostics.actifs
                : `${d.actifs} ${analyse.panneaux.diagnostics.actifs}`,
          }))}
          ariaLabel={analyse.panneaux.diagnostics.titre}
          onLigne={onDiagnostic}
        />
      )}
    </PanneauAnalyse>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ÉCHELLES CLINIQUES
 * ═══════════════════════════════════════════════════════════════════════════ */

function nomBande(cle: string | null): string {
  if (cle === null || cle === "") return "—";
  return analyse.panneaux.echelles.bandes[cle] ?? cle;
}

export function EchellesCliniques({
  echelles,
  onMesure,
}: {
  readonly echelles: readonly EchelleAnalyse[];
  readonly onMesure: (code: string, bande: string) => void;
}): React.JSX.Element {
  const visibles = echelles.filter((e) => e.n > 0);

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.echelles.titre}
      question={analyse.panneaux.echelles.question}
      icone="suivi"
      teinte="azure"
      delai={320}
      pied={analyse.panneaux.echelles.aide}
    >
      {visibles.length === 0 ? (
        <p className="py-6 text-center font-ui text-body text-ink-500">
          {analyse.panneaux.echelles.vide}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {visibles.map((e) => (
            <div key={e.code} className="plaque-analyse flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-ui text-body font-semibold text-ink-900">{e.nom}</span>
                <span className="font-num text-label tabular-nums text-ink-500">
                  {formaterNombre(e.n)} mesures · {formaterNombre(e.patientes)} dossiers
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
                    {analyse.panneaux.echelles.toutes}
                  </p>
                  <BarresRang
                    lignes={e.bandes.map((b) => ({
                      cle: `${e.code}|${b.cle ?? ""}`,
                      libelle: nomBande(b.cle),
                      valeur: b.n,
                    }))}
                    famille="azure"
                    ariaLabel={`${e.nom} — ${analyse.panneaux.echelles.toutes}`}
                    onLigne={() => undefined}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <p className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
                    {analyse.panneaux.echelles.dernieres}
                  </p>
                  <BarresRang
                    lignes={e.derniers.map((b) => ({
                      cle: `${e.code}|${b.cle ?? ""}`,
                      libelle: nomBande(b.cle),
                      valeur: b.n,
                    }))}
                    famille="aqua"
                    ariaLabel={`${e.nom} — ${analyse.panneaux.echelles.dernieres}`}
                  />
                </div>
              </div>

              {e.repetes > 0 ? (
                <button
                  type="button"
                  onClick={() => onMesure(e.code, "")}
                  className="w-fit font-ui text-label font-medium text-action-700 underline decoration-action-300 underline-offset-4 transition hover:text-action-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
                >
                  {formaterNombre(e.repetes)} {analyse.panneaux.echelles.repetees}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </PanneauAnalyse>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * QUALITÉ DU DOSSIER
 * ═══════════════════════════════════════════════════════════════════════════ */

export function QualiteDossier({
  notesManquantes,
  rdvNonClotures,
  onNotes,
  onRdv,
}: {
  readonly notesManquantes: number;
  readonly rdvNonClotures: number;
  readonly onNotes: () => void;
  readonly onRdv: () => void;
}): React.JSX.Element {
  const rien = notesManquantes === 0 && rdvNonClotures === 0;

  return (
    <PanneauAnalyse
      titre={analyse.panneaux.qualite.titre}
      question={analyse.panneaux.qualite.question}
      icone="documents"
      teinte="ambre"
      delai={360}
    >
      {rien ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
          <span className="icone-lueur" data-teinte="emeraude" aria-hidden="true">
            <span className="font-ui text-title">✓</span>
          </span>
          <p className="font-ui text-body font-medium text-ink-700">
            {analyse.panneaux.qualite.vide}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          <LigneQualite
            valeur={notesManquantes}
            titre={analyse.panneaux.qualite.notesManquantes}
            aide={analyse.panneaux.qualite.notesManquantesAide}
            onClick={onNotes}
            teinte="ambre"
          />
          <LigneQualite
            valeur={rdvNonClotures}
            titre={analyse.panneaux.qualite.rdvNonClotures}
            aide={analyse.panneaux.qualite.rdvNonCloturesAide}
            onClick={onRdv}
            teinte="corail"
          />
        </ul>
      )}
    </PanneauAnalyse>
  );
}

function LigneQualite({
  valeur,
  titre,
  aide,
  onClick,
  teinte,
}: {
  readonly valeur: number;
  readonly titre: string;
  readonly aide: string;
  readonly onClick: () => void;
  readonly teinte: "ambre" | "corail";
}): React.JSX.Element {
  const vide = valeur === 0;
  return (
    <li>
      <button
        type="button"
        disabled={vide}
        onClick={onClick}
        className={[
          "plaque-analyse flex w-full items-center gap-3 p-3 text-left transition",
          vide
            ? "cursor-default opacity-60"
            : "hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600",
        ].join(" ")}
      >
        <span className="icone-lueur" data-teinte={vide ? "emeraude" : teinte} aria-hidden="true">
          <span className="font-ui text-body font-bold">{vide ? "✓" : valeur}</span>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-ui text-label font-semibold text-ink-900">{titre}</span>
          <span className="truncate font-ui text-label text-ink-500">{aide}</span>
        </span>
        {vide ? null : (
          <span className="ml-auto shrink-0 font-ui text-label font-medium text-action-700">
            {analyse.panneaux.qualite.ouvrir}
          </span>
        )}
      </button>
    </li>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TRAITEMENTS
 * ═══════════════════════════════════════════════════════════════════════════ */

export function Traitements({
  actifs,
  changements,
  onActifs,
  onChangements,
}: {
  readonly actifs: number;
  readonly changements: number;
  readonly onActifs: () => void;
  readonly onChangements: () => void;
}): React.JSX.Element {
  return (
    <PanneauAnalyse
      titre={analyse.panneaux.traitements.titre}
      question={analyse.panneaux.traitements.question}
      icone="traitements"
      teinte="violet"
      delai={400}
      pied={analyse.panneaux.traitements.aide}
    >
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onActifs}
          className="plaque-analyse flex flex-col gap-1 p-4 text-left transition hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600"
        >
          <span className="font-ui text-label text-ink-500">{analyse.panneaux.traitements.actifs}</span>
          <span className="font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900">
            {formaterNombre(actifs)}
          </span>
        </button>
        <button
          type="button"
          onClick={onChangements}
          className="plaque-analyse flex flex-col gap-1 p-4 text-left transition hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action-600"
        >
          <span className="font-ui text-label text-ink-500">{analyse.panneaux.traitements.changements}</span>
          <span className="font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-ink-900">
            {formaterNombre(changements)}
          </span>
        </button>
      </div>
    </PanneauAnalyse>
  );
}
