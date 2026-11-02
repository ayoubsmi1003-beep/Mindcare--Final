"use client";

import { useEffect, useMemo, useState } from "react";

import { BlocErreur, Bouton, Carte, Icone, Squelette } from "@/components/ui";
import { Courbe } from "@/components/ui/Courbe";
import { dateCivile } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import type { AdherenceReport, Measurement } from "@/services/medication-phase2";
import type { Treatment } from "@/services/patient-treatments";
import type { SessionMeasure } from "@/services/medication-workspace";
import type { AdministrationEchelle, EchelleDisponible } from "@/services/scales";

import { pointsEchelle, pointsMesure } from "./adaptateurs";
import { PanneauAdherence } from "./PanneauAdherence";
import { PanneauMesures } from "./PanneauMesures";

function GroupesEchelles({
  echelles,
  selection,
  onSelection,
}: {
  readonly echelles: readonly AdministrationEchelle[];
  readonly selection: string;
  readonly onSelection: (code: string) => void;
}): React.JSX.Element {
  const groupes = useMemo(() => {
    const parCode = new Map<string, AdministrationEchelle[]>();
    for (const e of echelles) {
      const liste = parCode.get(e.scaleCode) ?? [];
      liste.push(e);
      parCode.set(e.scaleCode, liste);
    }
    return [...parCode.entries()].map(([code, liste]) => {
      const trie = liste.slice().sort((a, b) => b.administeredAt.localeCompare(a.administeredAt));
      return { code, nom: trie[0]?.scaleName ?? code, dernier: trie[0] ?? null, nombre: trie.length };
    });
  }, [echelles]);

  return (
    <div className="grid grid-cols-1 gap-2 tablet:grid-cols-3">
      {groupes.map((groupe) => (
        <button
          key={groupe.code}
          type="button"
          onClick={() => onSelection(groupe.code)}
          aria-pressed={selection === groupe.code}
          className={[
            "flex min-w-0 flex-col gap-1 rounded-2xl border p-3 text-left transition",
            selection === groupe.code
              ? "border-action-600 bg-tuile-menthe shadow-douce"
              : "border-rule bg-card hover:border-action-500",
          ].join(" ")}
        >
          <span className="font-ui text-label font-bold text-ink-900">{groupe.nom}</span>
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-num text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
              {groupe.dernier?.total ?? t.commune.nonDisponible}
            </span>
            <span className="font-ui text-label text-ink-500">
              {groupe.dernier === null ? "" : dateCivile(groupe.dernier.administeredAt.slice(0, 10))}
            </span>
          </span>
          <span className="font-ui text-label text-ink-500">
            {groupe.dernier?.interpretation ?? `${groupe.nombre} mesure${groupe.nombre > 1 ? "s" : ""}`}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SurveillanceTraitements({
  patientId,
  consultationId,
  echelles,
  definitions,
  mesures,
  liste,
  mesuresPhysiques,
  observance,
  chargement,
  chargementPhase2,
  erreur,
  erreurPhase2,
  onReessayer,
  onReessayerPhase2,
  onChanged,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly echelles: readonly AdministrationEchelle[];
  readonly definitions: readonly EchelleDisponible[];
  readonly mesures: readonly SessionMeasure[];
  readonly liste: readonly Treatment[];
  readonly mesuresPhysiques: readonly Measurement[];
  readonly observance: readonly AdherenceReport[];
  readonly chargement: boolean;
  readonly chargementPhase2: boolean;
  readonly erreur: string | null;
  readonly erreurPhase2: string | null;
  readonly onReessayer: () => void;
  readonly onReessayerPhase2: () => void;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const [selection, setSelection] = useState("");

  useEffect(() => {
    if (selection !== "" || echelles.length === 0) return;
    setSelection(echelles[0]?.scaleCode ?? "");
  }, [echelles, selection]);

  if (erreur !== null) {
    return <BlocErreur message={erreur} action={<Bouton onClick={onReessayer}>{t.commune.reessayer}</Bouton>} />;
  }
  if (chargement) return <Squelette lignes={8} />;

  const definition = definitions.find((d) => d.code === selection) ?? null;
  const points = selection === "" ? [] : pointsEchelle(echelles, selection);

  return (
    <section aria-labelledby="titre-surveillance-traitements" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-azur text-azure-700">
            <Icone nom="suivi" taille={20} />
          </span>
          <h2 id="titre-surveillance-traitements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
            {t.surveillance.titre}
          </h2>
        </div>
        <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">{t.surveillance.aide}</p>
      </div>

      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.surveillance.echellesTitre}</h3>
            <p className="m-0 max-w-form font-ui text-label text-ink-500">{t.surveillance.echellesAide}</p>
          </div>
          {echelles.length === 0 ? (
            <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.surveillance.aucuneEchelle}</p>
          ) : (
            <>
              <GroupesEchelles echelles={echelles} selection={selection} onSelection={setSelection} />
              {points.length === 0 ? (
                <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.surveillance.aucuneEchelle}</p>
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
                  famille="azure"
                  libellePrimaire={t.surveillance.uniteScore(definition?.scoring.max ?? 0)}
                  ariaLabel={`${t.surveillance.echellesTitre} — ${selection}`}
                  {...(definition === null ? {} : { plafond: definition.scoring.max })}
                  hauteur={240}
                />
              )}
            </>
          )}
        </div>
      </Carte>

      <Carte niveau="clinique">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.surveillance.mesuresTitre}</h3>
            <p className="m-0 max-w-form font-ui text-label text-ink-500">{t.surveillance.mesuresAide}</p>
          </div>
          {mesures.length === 0 ? (
            <p className="m-0 py-6 text-center font-ui text-body text-ink-500">{t.surveillance.aucuneMesure}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-3">
              {([
                ["anxiete", "Anxiété", "azure"],
                ["sommeil", "Sommeil", "violet"],
                ["humeur", "Humeur", "ambre"],
              ] as const).map(([cle, libelle, famille]) => {
                const serie = pointsMesure(mesures, cle);
                return (
                  <div key={cle} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-rule bg-card p-3">
                    <h4 className="m-0 font-ui text-label font-bold text-ink-700">{libelle}</h4>
                    {serie.some((p) => p.valeur !== null) ? (
                      <Courbe
                        points={serie}
                        famille={famille}
                        libellePrimaire={t.surveillance.uniteMesure}
                        ariaLabel={`${libelle} — ${t.surveillance.mesuresTitre}`}
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

      <PanneauMesures
        patientId={patientId}
        consultationId={consultationId}
        mesures={mesuresPhysiques}
        chargement={chargementPhase2}
        erreur={erreurPhase2}
        onChanged={onChanged}
        onReessayer={onReessayerPhase2}
      />

      <PanneauAdherence
        patientId={patientId}
        consultationId={consultationId}
        liste={liste}
        rapports={observance}
        chargement={chargementPhase2}
        erreur={erreurPhase2}
        onChanged={onChanged}
        onReessayer={onReessayerPhase2}
      />
    </section>
  );
}
