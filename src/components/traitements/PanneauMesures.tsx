"use client";

import { useMemo, useState } from "react";

import {
  Badge,
  Bouton,
  Carte,
  ChampSelection,
  ChampTexte,
  ChampZoneTexte,
  Dialogue,
  EtatVide,
  Icone,
  Squelette,
} from "@/components/ui";
import { Courbe } from "@/components/ui/Courbe";
import { dateCivile, heure, jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import {
  recordMeasurement,
  type Measurement,
  type MeasurementSource,
} from "@/services/medication-phase2";

import { estHorsReference, formaterMesure, mesuresParKind } from "./modele-phase2";

function maintenantLocal(): string {
  const date = new Date();
  const decalage = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - decalage).toISOString().slice(0, 16);
}

export function PanneauMesures({
  patientId,
  consultationId,
  mesures,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly mesures: readonly Measurement[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [filtre, setFiltre] = useState("weight_kg");
  const [ouvert, setOuvert] = useState(false);
  const [kind, setKind] = useState("weight_kg");
  const [valeur, setValeur] = useState("");
  const [unite, setUnite] = useState("kg");
  const [date, setDate] = useState(maintenantLocal());
  const [source, setSource] = useState<MeasurementSource>("consultation");
  const [referenceBas, setReferenceBas] = useState("");
  const [referenceHaute, setReferenceHaute] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  const serie = useMemo(() => mesuresParKind(mesures, filtre), [mesures, filtre]);
  const unitesMixtes = useMemo(
    () => new Set(serie.map((m) => m.unit.trim().toLocaleLowerCase("fr"))).size > 1,
    [serie],
  );
  const points = useMemo(
    () =>
      serie.map((m) => ({
        cle: m.id,
        libelle: dateCivile(m.measuredAt.slice(0, 10)) ?? m.measuredAt.slice(0, 10),
        titre: jourLong(m.measuredAt) ?? m.measuredAt,
        valeur: m.value,
        couvert: true,
      })),
    [serie],
  );

  const derniers = useMemo(() => {
    const parKind = new Map<string, Measurement>();
    for (const mesure of mesures) {
      const actuel = parKind.get(mesure.kind);
      if (actuel === undefined || mesure.measuredAt > actuel.measuredAt) parKind.set(mesure.kind, mesure);
    }
    return [...parKind.values()].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  }, [mesures]);

  function changerKind(valeurKind: string): void {
    setKind(valeurKind);
    setUnite(t.phase2.mesures.unites[valeurKind] ?? "");
  }

  async function enregistrer(): Promise<void> {
    const nombre = Number(valeur.replace(",", "."));
    if (!Number.isFinite(nombre) || valeur.trim() === "") {
      setErreurForm(t.phase2.mesures.valeur);
      return;
    }
    if (unite.trim() === "") {
      setErreurForm(t.phase2.mesures.unite);
      return;
    }
    if (date === "") {
      setErreurForm(t.phase2.mesures.date);
      return;
    }
    const bas = referenceBas.trim() === "" ? null : Number(referenceBas.replace(",", "."));
    const haut = referenceHaute.trim() === "" ? null : Number(referenceHaute.replace(",", "."));
    if ((bas !== null && !Number.isFinite(bas)) || (haut !== null && !Number.isFinite(haut))) {
      setErreurForm(t.phase2.mesures.referenceBas);
      return;
    }
    if (bas !== null && haut !== null && bas > haut) {
      setErreurForm(t.phase2.mesures.referenceBas);
      return;
    }
    setBusy(true);
    setErreurForm(null);
    const r = await recordMeasurement({
      patientId,
      kind,
      value: nombre,
      unit: unite.trim(),
      measuredAt: new Date(date).toISOString(),
      source,
      referenceLow: bas,
      referenceHigh: haut,
      notes: notes.trim() === "" ? null : notes.trim(),
      consultationId,
    });
    setBusy(false);
    if (!r.ok) {
      setErreurForm(r.error.message);
      return;
    }
    setOuvert(false);
    setValeur("");
    setReferenceBas("");
    setReferenceHaute("");
    setNotes("");
    onChanged();
  }

  return (
    <section aria-labelledby="titre-mesures" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-azur text-azure-700">
              <Icone nom="suivi" taille={20} />
            </span>
            <h3 id="titre-mesures" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.phase2.mesures.titre}
            </h3>
            <Badge ton={mesures.length === 0 ? "neutre" : "information"}>{String(mesures.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {t.phase2.mesures.aide}
          </p>
        </div>
        <Bouton rang="secondaire" taille="compact" onClick={() => setOuvert(true)}>
          {t.phase2.mesures.ajouter}
        </Bouton>
      </div>

      {erreur === null ? null : (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
          {erreur}
          <Bouton rang="discret" taille="compact" onClick={onReessayer}>
            {t.commune.reessayer}
          </Bouton>
        </p>
      )}

      {chargement && mesures.length === 0 ? (
        <Squelette lignes={4} />
      ) : mesures.length === 0 ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.phase2.mesures.vide}
            message={t.phase2.mesures.aide}
            icone="suivi"
            action={
              <Bouton rang="principal" taille="compact" onClick={() => setOuvert(true)}>
                {t.phase2.mesures.ajouter}
              </Bouton>
            }
          />
        </Carte>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
            {derniers.slice(0, 8).map((mesure) => (
              <div key={mesure.kind} className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-rule bg-card px-3 py-2">
                <span className="font-ui text-label text-ink-500">
                  {t.phase2.mesures.kinds[mesure.kind] ?? mesure.kind}
                </span>
                <span className="font-num text-body font-bold tabular-nums text-ink-900">
                  {formaterMesure(mesure.value, mesure.unit)}
                </span>
                <span className="font-num text-eyebrow tabular-nums text-ink-500">
                  {dateCivile(mesure.measuredAt.slice(0, 10)) ?? mesure.measuredAt.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-2">
            <ChampSelection
              libelle={t.phase2.mesures.kind}
              valeur={filtre}
              onChange={setFiltre}
              options={Object.entries(t.phase2.mesures.kinds).map(([valeurKind, libelle]) => ({
                valeur: valeurKind,
                libelle,
              }))}
            />
          </div>

          {serie.length === 0 ? (
            <p className="m-0 font-ui text-label text-ink-500">{t.phase2.mesures.vide}</p>
          ) : unitesMixtes ? (
            <p className="m-0 rounded-xl bg-attention-bg px-3 py-2 font-ui text-label text-attention-ink">
              {t.phase2.mesures.unitesMixtes}
            </p>
          ) : points.length >= 2 ? (
            <Courbe
              points={points}
              famille="azure"
              libellePrimaire={serie[0]?.unit ?? ""}
              ariaLabel={t.phase2.mesures.titre}
              hauteur={220}
            />
          ) : (
            <p className="m-0 font-ui text-label text-ink-500">{t.evolution.unSeulPoint}</p>
          )}

          <Carte niveau="clinique">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-ui text-body">
                <caption className="cache-visuellement">{t.phase2.mesures.titre}</caption>
                <thead>
                  <tr className="border-b border-rule text-left font-ui text-label text-ink-500">
                    <th scope="col" className="px-3 py-2">{t.phase2.mesures.date}</th>
                    <th scope="col" className="px-3 py-2">{t.phase2.mesures.kind}</th>
                    <th scope="col" className="px-3 py-2">{t.phase2.mesures.valeur}</th>
                    <th scope="col" className="px-3 py-2">{t.phase2.mesures.source}</th>
                    <th scope="col" className="px-3 py-2">{t.phase2.mesures.reference}</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.slice().reverse().map((mesure) => {
                    const hors = estHorsReference(mesure);
                    const reference =
                      mesure.referenceLow === null && mesure.referenceHigh === null
                        ? t.phase2.mesures.sansReference
                        : `${mesure.referenceLow === null ? "—" : formaterMesure(mesure.referenceLow, "").trim()} – ${
                            mesure.referenceHigh === null ? "—" : formaterMesure(mesure.referenceHigh, mesure.unit)
                          }`;
                    return (
                      <tr key={mesure.id} className="border-b border-rule last:border-b-0">
                        <td className="px-3 py-2 font-num tabular-nums text-ink-700">
                          {dateCivile(mesure.measuredAt.slice(0, 10)) ?? mesure.measuredAt.slice(0, 10)}
                          {heure(mesure.measuredAt) === null ? "" : ` · ${heure(mesure.measuredAt)}`}
                        </td>
                        <td className="px-3 py-2 text-ink-700">{t.phase2.mesures.kinds[mesure.kind] ?? mesure.kind}</td>
                        <td className="px-3 py-2 font-num font-semibold tabular-nums text-ink-900">
                          {formaterMesure(mesure.value, mesure.unit)}
                        </td>
                        <td className="px-3 py-2 text-ink-700">{t.phase2.mesures.sources[mesure.source] ?? mesure.source}</td>
                        <td className="px-3 py-2">
                          <Badge ton={hors ? "attention" : "neutre"}>{reference}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Carte>
        </>
      )}

      <Dialogue
        ouvert={ouvert}
        titre={t.phase2.mesures.titreDialogue}
        busy={busy}
        onFermer={() => setOuvert(false)}
        pied={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton rang="discret" onClick={() => setOuvert(false)} disabled={busy}>
              {t.phase2.annuler}
            </Bouton>
            <Bouton rang="principal" onClick={() => void enregistrer()} disabled={busy}>
              {busy ? t.phase2.enregistrement : t.phase2.enregistrer}
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <ChampSelection
            libelle={t.phase2.mesures.kind}
            valeur={kind}
            onChange={changerKind}
            options={Object.entries(t.phase2.mesures.kinds).map(([valeurKind, libelle]) => ({
              valeur: valeurKind,
              libelle,
            }))}
          />
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <ChampTexte libelle={t.phase2.mesures.valeur} valeur={valeur} onChange={setValeur} requis />
            <ChampTexte libelle={t.phase2.mesures.unite} valeur={unite} onChange={setUnite} requis />
          </div>
          <ChampTexte libelle={t.phase2.mesures.date} type="datetime-local" valeur={date} onChange={setDate} requis />
          <ChampSelection
            libelle={t.phase2.mesures.source}
            valeur={source}
            onChange={(v) => setSource(v as MeasurementSource)}
            options={Object.entries(t.phase2.mesures.sources).map(([valeurSource, libelle]) => ({
              valeur: valeurSource,
              libelle,
            }))}
          />
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <ChampTexte libelle={t.phase2.mesures.referenceBas} valeur={referenceBas} onChange={setReferenceBas} />
            <ChampTexte libelle={t.phase2.mesures.referenceHaute} valeur={referenceHaute} onChange={setReferenceHaute} />
          </div>
          <ChampZoneTexte libelle={t.phase2.mesures.notes} valeur={notes} onChange={setNotes} lignes={2} />
          {erreurForm === null ? null : (
            <p role="alert" className="m-0 rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
              {erreurForm}
            </p>
          )}
        </div>
      </Dialogue>
    </section>
  );
}
