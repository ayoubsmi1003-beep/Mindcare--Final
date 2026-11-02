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
import { jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import {
  recordInteractionReview,
  type InteractionConclusion,
  type InteractionReview,
} from "@/services/medication-phase2";
import type { Treatment } from "@/services/patient-treatments";

function tonConclusion(conclusion: InteractionConclusion): "attention" | "information" | "neutre" {
  if (conclusion === "interaction_majeure" || conclusion === "interaction_possible") return "attention";
  if (conclusion === "aucune_interaction_retenue") return "information";
  return "neutre";
}

export function PanneauInteractions({
  patientId,
  consultationId,
  liste,
  revues,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly liste: readonly Treatment[];
  readonly revues: readonly InteractionReview[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [source, setSource] = useState("");
  const [conclusion, setConclusion] = useState<InteractionConclusion>("non_conclu");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  function basculer(id: string): void {
    setSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function enregistrer(): Promise<void> {
    if (selection.length === 0) {
      setErreurForm(t.phase2.interactions.choisirTraitement);
      return;
    }
    if (source.trim() === "") {
      setErreurForm(t.phase2.interactions.source);
      return;
    }
    setBusy(true);
    setErreurForm(null);
    const r = await recordInteractionReview({
      patientId,
      treatmentIds: selection,
      source: source.trim(),
      conclusion,
      notes: notes.trim() === "" ? null : notes.trim(),
      consultationId,
    });
    setBusy(false);
    if (!r.ok) {
      setErreurForm(r.error.message);
      return;
    }
    setOuvert(false);
    setSelection([]);
    setSource("");
    setNotes("");
    onChanged();
  }

  return (
    <section aria-labelledby="titre-interactions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-lavande text-violet-700">
              <Icone nom="traitements" taille={20} />
            </span>
            <h3 id="titre-interactions" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.phase2.interactions.titre}
            </h3>
            <Badge ton={revues.length === 0 ? "neutre" : "information"}>{String(revues.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {t.phase2.interactions.aide}
          </p>
        </div>
        <Bouton rang="secondaire" taille="compact" onClick={() => setOuvert(true)}>
          {t.phase2.interactions.enregistrer}
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

      {chargement && revues.length === 0 ? (
        <Squelette lignes={3} />
      ) : revues.length === 0 ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.phase2.interactions.vide}
            message={t.phase2.interactions.aucunMoteur}
            icone="traitements"
            action={
              <Bouton rang="principal" taille="compact" onClick={() => setOuvert(true)}>
                {t.phase2.interactions.enregistrer}
              </Bouton>
            }
          />
        </Carte>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {revues.map((revue) => (
            <li key={revue.id}>
              <Carte niveau="secondaire">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge ton={tonConclusion(revue.conclusion)}>
                        {t.phase2.interactions.conclusions[revue.conclusion] ?? revue.conclusion}
                      </Badge>
                      <span className="break-words font-ui text-label text-ink-500">
                        {t.phase2.interactions.source} : {revue.source}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {revue.treatments.map((traitement) => (
                        <span
                          key={traitement.treatmentId}
                          className="rounded-full border border-rule bg-card px-2.5 py-1 font-ui text-label text-ink-700"
                        >
                          {traitement.medicationName}
                          {traitement.dose === null ? "" : ` · ${[traitement.dose, traitement.doseUnit].filter(Boolean).join(" ")}`}
                        </span>
                      ))}
                    </div>
                    {revue.notes === null ? null : (
                      <p className="m-0 break-words font-ui text-body text-ink-700">{revue.notes}</p>
                    )}
                    <p className="m-0 font-num text-label tabular-nums text-ink-500">
                      {jourLong(revue.recordedAt) ?? revue.recordedAt}
                      {revue.practitionerName === null ? "" : ` · ${t.phase2.interactions.praticienne} ${revue.practitionerName}`}
                    </p>
                  </div>
                </div>
              </Carte>
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{t.phase2.interactions.aucunMoteur}</p>

      <Dialogue
        ouvert={ouvert}
        titre={t.phase2.interactions.titreDialogue}
        busy={busy}
        large
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
          <div className="flex flex-col gap-2">
            <span className="font-ui text-label font-semibold text-ink-700">{t.phase2.interactions.traitements}</span>
            {liste.length === 0 ? (
              <p className="m-0 font-ui text-body text-ink-500">{t.phase2.interactions.choisirTraitement}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {liste.map((traitement) => {
                  const actif = selection.includes(traitement.id);
                  return (
                    <Bouton
                      key={traitement.id}
                      type="button"
                      rang="secondaire"
                      taille="compact"
                      sansFleches
                      enfonce={actif}
                      onClick={() => basculer(traitement.id)}
                    >
                      {traitement.medicationRaw || traitement.brandName || traitement.inn} · {t.statuts[traitement.status]}
                    </Bouton>
                  );
                })}
              </div>
            )}
          </div>
          <ChampTexte
            libelle={t.phase2.interactions.source}
            valeur={source}
            onChange={setSource}
            placeholder={t.phase2.interactions.sourcePlaceholder}
            requis
          />
          <ChampSelection
            libelle={t.phase2.interactions.conclusion}
            valeur={conclusion}
            onChange={(v) => setConclusion(v as InteractionConclusion)}
            options={Object.entries(t.phase2.interactions.conclusions).map(([valeur, libelle]) => ({ valeur, libelle }))}
          />
          <ChampZoneTexte
            libelle={t.phase2.interactions.notes}
            valeur={notes}
            onChange={setNotes}
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
