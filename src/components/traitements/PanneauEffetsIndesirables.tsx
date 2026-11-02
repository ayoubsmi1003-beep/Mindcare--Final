"use client";

import { useState } from "react";

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
  recordAdverseEvent,
  type AdverseEvent,
  type AdverseSeverity,
} from "@/services/medication-phase2";
import type { Treatment } from "@/services/patient-treatments";

function tonSeverite(severite: AdverseSeverity): "attention" | "information" | "neutre" {
  if (severite === "grave" || severite === "severe") return "attention";
  if (severite === "modere") return "information";
  return "neutre";
}

function nomTraitement(liste: readonly Treatment[], traitementId: string | null): string | null {
  if (traitementId === null) return null;
  const traitement = liste.find((x) => x.id === traitementId);
  if (traitement === undefined) return t.phase2.effets.aucunTraitement;
  return [traitement.medicationRaw || traitement.brandName || traitement.inn, traitement.dose, traitement.doseUnit]
    .filter(Boolean)
    .join(" ");
}

export function PanneauEffetsIndesirables({
  patientId,
  consultationId,
  liste,
  evenements,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly liste: readonly Treatment[];
  readonly evenements: readonly AdverseEvent[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [traitementId, setTraitementId] = useState("");
  const [symptome, setSymptome] = useState("");
  const [severite, setSeverite] = useState<AdverseSeverity>("modere");
  const [debut, setDebut] = useState("");
  const [resolution, setResolution] = useState("");
  const [conduite, setConduite] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  async function enregistrer(): Promise<void> {
    if (symptome.trim() === "") {
      setErreurForm(t.phase2.effets.symptome);
      return;
    }
    if (debut !== "" && resolution !== "" && resolution < debut) {
      setErreurForm(t.formulaire.dateInvalide);
      return;
    }
    setBusy(true);
    setErreurForm(null);
    const r = await recordAdverseEvent({
      patientId,
      symptom: symptome.trim(),
      severity: severite,
      treatmentId: traitementId === "" ? null : traitementId,
      onsetDate: debut === "" ? null : debut,
      resolvedDate: resolution === "" ? null : resolution,
      actionTaken: conduite.trim() === "" ? null : conduite.trim(),
      description: description.trim() === "" ? null : description.trim(),
      consultationId,
    });
    setBusy(false);
    if (!r.ok) {
      setErreurForm(r.error.message);
      return;
    }
    setOuvert(false);
    setSymptome("");
    setDebut("");
    setResolution("");
    setConduite("");
    setDescription("");
    onChanged();
  }

  return (
    <section aria-labelledby="titre-effets" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-ambre text-ambre-700">
              <Icone nom="journalActivite" taille={20} />
            </span>
            <h3 id="titre-effets" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.phase2.effets.titre}
            </h3>
            <Badge ton={evenements.length === 0 ? "neutre" : "information"}>{String(evenements.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {t.phase2.effets.aide}
          </p>
        </div>
        <Bouton rang="secondaire" taille="compact" onClick={() => setOuvert(true)}>
          {t.phase2.effets.signaler}
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

      {chargement && evenements.length === 0 ? (
        <Squelette lignes={3} />
      ) : evenements.length === 0 ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.phase2.effets.vide}
            message={t.phase2.effets.aide}
            icone="journalActivite"
            action={
              <Bouton rang="principal" taille="compact" onClick={() => setOuvert(true)}>
                {t.phase2.effets.signaler}
              </Bouton>
            }
          />
        </Carte>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {evenements.map((effet) => (
            <li key={effet.id}>
              <Carte niveau="secondaire">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-ui text-body font-semibold text-ink-900">{effet.symptom}</span>
                      <Badge ton={tonSeverite(effet.severity)}>
                        {t.phase2.effets.severites[effet.severity] ?? effet.severity}
                      </Badge>
                      <Badge ton={effet.resolvedDate === null ? "attention" : "positif"}>
                        {effet.resolvedDate === null ? t.phase2.effets.enCours : t.phase2.effets.resolu}
                      </Badge>
                    </div>
                    {nomTraitement(liste, effet.treatmentId) === null ? null : (
                      <p className="m-0 break-words font-ui text-label text-ink-700">
                        {nomTraitement(liste, effet.treatmentId)}
                      </p>
                    )}
                    {effet.description === null ? null : (
                      <p className="m-0 break-words font-ui text-body text-ink-700">{effet.description}</p>
                    )}
                    {effet.actionTaken === null ? null : (
                      <p className="m-0 break-words font-ui text-label text-ink-500">
                        {t.phase2.effets.conduite} : {effet.actionTaken}
                      </p>
                    )}
                    <p className="m-0 font-num text-label tabular-nums text-ink-500">
                      {effet.onsetDate === null ? "" : `${t.phase2.effets.debut} ${dateCivile(effet.onsetDate) ?? effet.onsetDate}`}
                      {effet.resolvedDate === null
                        ? ""
                        : ` · ${t.phase2.effets.resolution} ${dateCivile(effet.resolvedDate) ?? effet.resolvedDate}`}
                    </p>
                  </div>
                  <span className="font-num text-label tabular-nums text-ink-500">
                    {jourLong(effet.recordedAt) ?? effet.recordedAt}
                  </span>
                </div>
              </Carte>
            </li>
          ))}
        </ul>
      )}

      <Dialogue
        ouvert={ouvert}
        titre={t.phase2.effets.titreDialogue}
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
            libelle={t.phase2.effets.traitement}
            valeur={traitementId}
            onChange={setTraitementId}
            options={[
              { valeur: "", libelle: t.phase2.effets.aucunTraitement },
              ...liste.map((traitement) => ({
                valeur: traitement.id,
                libelle: `${traitement.medicationRaw || traitement.brandName || traitement.inn} · ${t.statuts[traitement.status]}`,
              })),
            ]}
          />
          <ChampTexte
            libelle={t.phase2.effets.symptome}
            valeur={symptome}
            onChange={setSymptome}
            placeholder={t.phase2.effets.symptomePlaceholder}
            requis
          />
          <ChampSelection
            libelle={t.phase2.effets.severite}
            valeur={severite}
            onChange={(v) => setSeverite(v as AdverseSeverity)}
            options={Object.entries(t.phase2.effets.severites).map(([valeur, libelle]) => ({ valeur, libelle }))}
          />
          <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
            <ChampTexte libelle={t.phase2.effets.debut} type="date" valeur={debut} onChange={setDebut} />
            <ChampTexte libelle={t.phase2.effets.resolution} type="date" valeur={resolution} onChange={setResolution} />
          </div>
          <ChampTexte
            libelle={t.phase2.effets.conduite}
            valeur={conduite}
            onChange={setConduite}
            placeholder={t.phase2.effets.conduitePlaceholder}
          />
          <ChampZoneTexte
            libelle={t.phase2.effets.description}
            valeur={description}
            onChange={setDescription}
            lignes={3}
          />
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
