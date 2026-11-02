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
  recordPatientAllergy,
  type AllergyEvent,
  type AllergyEventKind,
  type AllergySeverity,
} from "@/services/medication-phase2";

import { allergiesCourantes } from "./modele-phase2";

function tonSeverite(severite: AllergySeverity | null): "attention" | "information" | "neutre" {
  if (severite === "anaphylaxie" || severite === "severe") return "attention";
  if (severite === "moderee") return "information";
  return "neutre";
}

export function PanneauAllergies({
  patientId,
  consultationId,
  evenements,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly evenements: readonly AllergyEvent[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [cloture, setCloture] = useState<{ substance: string; kind: AllergyEventKind } | null>(null);
  const [substance, setSubstance] = useState("");
  const [reaction, setReaction] = useState("");
  const [severite, setSeverite] = useState<AllergySeverity>("moderee");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  const courantes = allergiesCourantes(evenements);

  async function enregistrer(kind: AllergyEventKind, valeurs: {
    substance: string;
    reaction: string | null;
    severite: AllergySeverity | null;
    notes: string | null;
  }): Promise<void> {
    setBusy(true);
    setErreurForm(null);
    const r = await recordPatientAllergy({
      patientId,
      substance: valeurs.substance,
      reaction: valeurs.reaction,
      severity: valeurs.severite,
      eventKind: kind,
      notes: valeurs.notes,
      consultationId,
    });
    setBusy(false);
    if (!r.ok) {
      setErreurForm(r.error.message);
      return;
    }
    setOuvert(false);
    setCloture(null);
    setSubstance("");
    setReaction("");
    setNotes("");
    onChanged();
  }

  function declarer(): void {
    if (substance.trim() === "") {
      setErreurForm(t.phase2.allergies.aucuneSubstance);
      return;
    }
    void enregistrer("noted", {
      substance: substance.trim(),
      reaction: reaction.trim() === "" ? null : reaction.trim(),
      severite,
      notes: notes.trim() === "" ? null : notes.trim(),
    });
  }

  return (
    <section aria-labelledby="titre-allergies" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-attention-bg text-attention-ink">
              <Icone nom="alerte" taille={20} />
            </span>
            <h3 id="titre-allergies" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.phase2.allergies.titre}
            </h3>
            <Badge ton={courantes.length === 0 ? "neutre" : "attention"}>{String(courantes.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {t.phase2.allergies.aide}
          </p>
        </div>
        <Bouton rang="secondaire" taille="compact" onClick={() => setOuvert(true)}>
          {t.phase2.allergies.declarer}
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
      ) : courantes.length === 0 ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.phase2.allergies.vide}
            message={t.phase2.allergies.videAide}
            icone="alerte"
            action={
              <Bouton rang="principal" taille="compact" onClick={() => setOuvert(true)}>
                {t.phase2.allergies.declarer}
              </Bouton>
            }
          />
        </Carte>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {courantes.map((allergie) => (
            <li key={allergie.substanceKey}>
              <Carte niveau="secondaire">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-attention-bg text-attention-ink">
                      <Icone nom="alerte" taille={16} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words font-ui text-body font-semibold text-ink-900">
                          {allergie.substance}
                        </span>
                        <Badge ton={tonSeverite(allergie.severity)}>
                          {allergie.severity === null
                            ? t.phase2.aucun
                            : (t.phase2.allergies.severites[allergie.severity] ?? allergie.severity)}
                        </Badge>
                      </div>
                      {allergie.reaction === null ? null : (
                        <p className="m-0 break-words font-ui text-body text-ink-700">{allergie.reaction}</p>
                      )}
                      <p className="m-0 font-num text-label tabular-nums text-ink-500">
                        {t.phase2.allergies.depuis} {dateCivile(allergie.since.slice(0, 10)) ?? t.phase2.aucun}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Bouton
                      rang="discret"
                      taille="compact"
                      onClick={() => setCloture({ substance: allergie.substance, kind: "resolved" })}
                    >
                      {t.phase2.allergies.resoudre}
                    </Bouton>
                    <Bouton
                      rang="discret"
                      taille="compact"
                      onClick={() => setCloture({ substance: allergie.substance, kind: "refuted" })}
                    >
                      {t.phase2.allergies.infirmer}
                    </Bouton>
                  </div>
                </div>
              </Carte>
            </li>
          ))}
        </ul>
      )}

      {evenements.length === 0 ? null : (
        <details className="rounded-xl border border-rule bg-sunken p-3">
          <summary className="cursor-pointer font-ui text-label font-semibold text-ink-700">
            {t.chronologie.journalTitre}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {evenements.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 font-ui text-label text-ink-700">
                <span className="min-w-0 break-words">
                  {e.substance} ·{" "}
                  {e.eventKind === "noted"
                    ? t.phase2.allergies.active
                    : e.eventKind === "resolved"
                      ? t.phase2.allergies.resoudre
                      : t.phase2.allergies.infirmer}
                </span>
                <span className="font-num tabular-nums text-ink-500">{jourLong(e.recordedAt) ?? e.recordedAt}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialogue
        ouvert={ouvert}
        titre={t.phase2.allergies.titreDialogue}
        busy={busy}
        onFermer={() => setOuvert(false)}
        pied={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton rang="discret" onClick={() => setOuvert(false)} disabled={busy}>
              {t.phase2.annuler}
            </Bouton>
            <Bouton rang="principal" onClick={declarer} disabled={busy}>
              {busy ? t.phase2.enregistrement : t.phase2.enregistrer}
            </Bouton>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <ChampTexte
            libelle={t.phase2.allergies.substance}
            valeur={substance}
            onChange={setSubstance}
            placeholder={t.phase2.allergies.substancePlaceholder}
            requis
          />
          <ChampTexte
            libelle={t.phase2.allergies.reaction}
            valeur={reaction}
            onChange={setReaction}
            placeholder={t.phase2.allergies.reactionPlaceholder}
          />
          <ChampSelection
            libelle={t.phase2.allergies.severite}
            valeur={severite}
            onChange={(v) => setSeverite(v as AllergySeverity)}
            options={Object.entries(t.phase2.allergies.severites).map(([valeur, libelle]) => ({ valeur, libelle }))}
          />
          <ChampZoneTexte
            libelle={t.phase2.allergies.notes}
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

      <Dialogue
        ouvert={cloture !== null}
        titre={t.phase2.allergies.clotureTitre}
        sousTitre={cloture?.substance ?? ""}
        busy={busy}
        onFermer={() => setCloture(null)}
        pied={
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton rang="discret" onClick={() => setCloture(null)} disabled={busy}>
              {t.phase2.annuler}
            </Bouton>
            <Bouton
              rang="principal"
              disabled={busy}
              onClick={() => {
                if (cloture === null) return;
                void enregistrer(cloture.kind, {
                  substance: cloture.substance,
                  reaction: null,
                  severite: null,
                  notes: null,
                });
              }}
            >
              {busy ? t.phase2.enregistrement : t.phase2.enregistrer}
            </Bouton>
          </div>
        }
      >
        <p className="m-0 font-ui text-body text-ink-700">{t.phase2.allergies.clotureCorps}</p>
        {erreurForm === null ? null : (
          <p role="alert" className="m-0 mt-3 rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
            {erreurForm}
          </p>
        )}
      </Dialogue>
    </section>
  );
}
