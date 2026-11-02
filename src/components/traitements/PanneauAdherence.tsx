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
import { dateCivile, jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import {
  recordAdherence,
  type AdherenceReport,
  type AdherenceSource,
  type AdherenceStatus,
} from "@/services/medication-phase2";
import type { Treatment } from "@/services/patient-treatments";

import { derniereAdherence } from "./modele-phase2";

function tonStatut(statut: AdherenceStatus): "positif" | "attention" | "information" | "neutre" {
  if (statut === "observant") return "positif";
  if (statut === "partiel" || statut === "non_observant") return "attention";
  if (statut === "inconnu") return "neutre";
  return "information";
}

function aujourdHui(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function debutMois(): string {
  return `${aujourdHui().slice(0, 7)}-01`;
}

export function PanneauAdherence({
  patientId,
  consultationId,
  liste,
  rapports,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly liste: readonly Treatment[];
  readonly rapports: readonly AdherenceReport[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [traitementId, setTraitementId] = useState("");
  const [debut, setDebut] = useState(debutMois());
  const [fin, setFin] = useState(aujourdHui());
  const [statut, setStatut] = useState<AdherenceStatus>("inconnu");
  const [source, setSource] = useState<AdherenceSource>("patient");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  const suivis = useMemo(() => {
    const ordre = { active: 0, paused: 1, stopped: 2 } as const;
    return [...liste]
      .filter((traitement) => traitement.status !== "stopped" || rapports.some((r) => r.treatmentId === traitement.id))
      .sort((a, b) => ordre[a.status] - ordre[b.status] || a.medicationRaw.localeCompare(b.medicationRaw, "fr"));
  }, [liste, rapports]);

  async function enregistrer(): Promise<void> {
    if (traitementId === "") {
      setErreurForm(t.phase2.observance.traitement);
      return;
    }
    if (debut === "" || fin === "" || fin < debut) {
      setErreurForm(t.formulaire.dateInvalide);
      return;
    }
    setBusy(true);
    setErreurForm(null);
    const r = await recordAdherence({
      patientId,
      treatmentId: traitementId,
      periodStart: debut,
      periodEnd: fin,
      status: statut,
      source,
      notes: notes.trim() === "" ? null : notes.trim(),
      consultationId,
    });
    setBusy(false);
    if (!r.ok) {
      setErreurForm(r.error.message);
      return;
    }
    setOuvert(false);
    setNotes("");
    onChanged();
  }

  return (
    <section aria-labelledby="titre-observance" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-menthe text-emeraude-700">
              <Icone nom="horloge" taille={20} />
            </span>
            <h3 id="titre-observance" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.phase2.observance.titre}
            </h3>
            <Badge ton={rapports.length === 0 ? "neutre" : "information"}>{String(rapports.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {t.phase2.observance.aide}
          </p>
        </div>
        <Bouton rang="secondaire" taille="compact" onClick={() => setOuvert(true)}>
          {t.phase2.observance.ajouter}
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

      {chargement && rapports.length === 0 ? (
        <Squelette lignes={3} />
      ) : suivis.length === 0 ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.phase2.observance.vide}
            message={t.phase2.observance.aide}
            icone="horloge"
            action={
              <Bouton rang="principal" taille="compact" onClick={() => setOuvert(true)}>
                {t.phase2.observance.ajouter}
              </Bouton>
            }
          />
        </Carte>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {suivis.map((traitement) => {
            const dernier = derniereAdherence(rapports, traitement.id);
            const nom = traitement.medicationRaw || traitement.brandName || traitement.inn;
            return (
              <li key={traitement.id}>
                <Carte niveau="secondaire">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words font-ui text-body font-semibold text-ink-900">{nom}</span>
                        <Badge ton={dernier === null ? "neutre" : tonStatut(dernier.status)}>
                          {dernier === null
                            ? t.phase2.observance.vide
                            : (t.phase2.observance.statuts[dernier.status] ?? dernier.status)}
                        </Badge>
                      </div>
                      {dernier === null ? null : (
                        <>
                          <p className="m-0 font-num text-label tabular-nums text-ink-500">
                            {dateCivile(dernier.periodStart) ?? dernier.periodStart} →{" "}
                            {dateCivile(dernier.periodEnd) ?? dernier.periodEnd}
                            {" · "}
                            {t.phase2.observance.sources[dernier.source] ?? dernier.source}
                          </p>
                          {dernier.notes === null ? null : (
                            <p className="m-0 break-words font-ui text-label text-ink-700">{dernier.notes}</p>
                          )}
                        </>
                      )}
                    </div>
                    <span className="font-num text-label tabular-nums text-ink-500">
                      {dernier === null ? "" : (jourLong(dernier.recordedAt) ?? dernier.recordedAt)}
                    </span>
                  </div>
                </Carte>
              </li>
            );
          })}
        </ul>
      )}

      {rapports.length === 0 ? null : (
        <details className="rounded-xl border border-rule bg-sunken p-3">
          <summary className="cursor-pointer font-ui text-label font-semibold text-ink-700">
            {t.chronologie.journalTitre}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {rapports.map((r) => {
              const traitement = liste.find((x) => x.id === r.treatmentId);
              const nom = traitement === undefined
                ? t.phase2.aucun
                : (traitement.medicationRaw || traitement.brandName || traitement.inn);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 font-ui text-label text-ink-700">
                  <span className="min-w-0 break-words">
                    {nom} · {t.phase2.observance.statuts[r.status] ?? r.status} · {dateCivile(r.periodEnd) ?? r.periodEnd}
                  </span>
                  <span className="font-num tabular-nums text-ink-500">{jourLong(r.recordedAt) ?? r.recordedAt}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <Dialogue
        ouvert={ouvert}
        titre={t.phase2.observance.titreDialogue}
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
            libelle={t.phase2.observance.traitement}
            valeur={traitementId}
            onChange={setTraitementId}
            options={[
              { valeur: "", libelle: t.phase2.choisir },
              ...liste.map((traitement) => ({
                valeur: traitement.id,
                libelle: `${traitement.medicationRaw || traitement.brandName || traitement.inn} · ${t.statuts[traitement.status]}`,
              })),
            ]}
          />
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <ChampTexte libelle={t.phase2.observance.debut} type="date" valeur={debut} onChange={setDebut} requis />
            <ChampTexte libelle={t.phase2.observance.fin} type="date" valeur={fin} onChange={setFin} requis />
          </div>
          <ChampSelection
            libelle={t.phase2.observance.statut}
            valeur={statut}
            onChange={(v) => setStatut(v as AdherenceStatus)}
            options={Object.entries(t.phase2.observance.statuts).map(([valeurStatut, libelle]) => ({
              valeur: valeurStatut,
              libelle,
            }))}
          />
          <ChampSelection
            libelle={t.phase2.observance.source}
            valeur={source}
            onChange={(v) => setSource(v as AdherenceSource)}
            options={Object.entries(t.phase2.observance.sources).map(([valeurSource, libelle]) => ({
              valeur: valeurSource,
              libelle,
            }))}
          />
          <ChampZoneTexte libelle={t.phase2.observance.notes} valeur={notes} onChange={setNotes} lignes={2} />
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
