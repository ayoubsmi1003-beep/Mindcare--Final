"use client";

import { useState } from "react";

import { Badge, Bouton, Carte, Dialogue, Icone, PastilleIcone } from "@/components/ui";
import { traitements } from "@/i18n/traitements";
import {
  pauseTreatment,
  renewTreatment,
  restartTreatment,
  resumeTreatment,
  stopTreatment,
  type StoppedReason,
  type Treatment,
} from "@/services/patient-treatments";

import { dateCivile, jourLong } from "@/components/patients/format";

import { dosePrescrite } from "./modele-traitements";

function doseLabel(t: Treatment): string {
  return dosePrescrite(t.dose, t.doseUnit) ?? traitements.carte.aucunDosage;
}

function horaires(t: Treatment): string {
  return t.timing.length === 0 ? traitements.carte.aucunHoraire : t.timing.join(" · ");
}

function badgeTon(t: Treatment): "positif" | "attention" | "neutre" {
  return t.status === "active" ? "positif" : t.status === "paused" ? "attention" : "neutre";
}

function accent(t: Treatment): string {
  return t.status === "active"
    ? "bg-emeraude-600"
    : t.status === "paused"
      ? "bg-attention"
      : "bg-ink-300";
}

function estConflit(technical: string | undefined): boolean {
  return technical === "40001" || technical === "conflit";
}

function motifLisible(reason: StoppedReason | null): string | null {
  if (reason === null) return null;
  return traitements.formulaire.motifs[reason] ?? reason;
}

export function CarteTraitement({
  traitement,
  consultationId,
  prescripteurEnChargement = false,
  onModifier,
  onHistorique,
  onChanged,
}: {
  readonly traitement: Treatment;
  readonly consultationId: string | null;
  /** Le workspace initial ne porte pas encore le prescripteur : ne pas le dire absent. */
  readonly prescripteurEnChargement?: boolean;
  readonly onModifier: (t: Treatment) => void;
  readonly onHistorique: (id: string) => void;
  readonly onChanged: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [arretOuvert, setArretOuvert] = useState(false);
  const [prolongerOuvert, setProlongerOuvert] = useState(false);
  const [motif, setMotif] = useState<StoppedReason>("decision_clinique");
  const [nouvelleFin, setNouvelleFin] = useState(traitement.endDate ?? "");

  function traiterErreur(message: string, technical?: string): void {
    setErreur(estConflit(technical) ? traitements.formulaire.conflit : message);
    setBusy(false);
  }

  function suspendre(): void {
    setBusy(true);
    setErreur(null);
    void pauseTreatment(traitement.id, traitement.currentVersion, consultationId).then((r) => {
      if (!r.ok) return traiterErreur(r.error.message, r.error.technical);
      setBusy(false);
      onChanged();
    });
  }

  function reprendre(): void {
    setBusy(true);
    setErreur(null);
    void resumeTreatment(traitement.id, traitement.currentVersion, consultationId).then((r) => {
      if (!r.ok) return traiterErreur(r.error.message, r.error.technical);
      setBusy(false);
      onChanged();
    });
  }

  function arreter(): void {
    setBusy(true);
    setErreur(null);
    void stopTreatment(
      traitement.id,
      traitement.currentVersion,
      motif,
      consultationId,
      null,
    ).then((r) => {
      setArretOuvert(false);
      if (!r.ok) return traiterErreur(r.error.message, r.error.technical);
      setBusy(false);
      onChanged();
    });
  }

  function redemarrer(): void {
    setBusy(true);
    setErreur(null);
    void restartTreatment(traitement.id, { consultationId }).then((r) => {
      if (!r.ok) return traiterErreur(r.error.message, r.error.technical);
      setBusy(false);
      onChanged();
    });
  }

  function prolonger(): void {
    if (nouvelleFin === "") {
      setErreur(traitements.formulaire.dateInvalide);
      return;
    }
    setBusy(true);
    setErreur(null);
    void renewTreatment(traitement.id, traitement.currentVersion, nouvelleFin, consultationId).then((r) => {
      setProlongerOuvert(false);
      if (!r.ok) return traiterErreur(r.error.message, r.error.technical);
      setBusy(false);
      onChanged();
    });
  }

  const nom = traitement.medicationRaw || traitement.brandName || traitement.inn || traitements.commune.aucun;
  const details = [traitement.brandName, traitement.inn, traitement.form]
    .filter((v): v is string => Boolean(v) && v !== nom)
    .join(" · ");

  return (
    <Carte niveau="clinique">
      <article id={`traitement-${traitement.id}`} className="relative flex flex-col gap-4 p-5 pl-6">
        <span aria-hidden="true" className={["absolute inset-y-0 left-0 w-1", accent(traitement)].join(" ")} />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <PastilleIcone nom="traitements" ton={traitement.status === "active" ? "action" : "neutre"} taille="grande" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 break-words font-ui text-heading font-bold tracking-heading text-ink-900">
                  {nom}
                </h3>
                <Badge ton={badgeTon(traitement)}>{traitements.statuts[traitement.status]}</Badge>
                {traitement.atcClass === null ? null : (
                  <span className="rounded-full border border-rule bg-sunken px-2 py-0.5 font-num text-eyebrow text-ink-500">
                    {traitement.atcClass}
                  </span>
                )}
                {traitement.consultationId === null ? null : (
                  <Badge ton="information">{traitements.chronologie.seance}</Badge>
                )}
              </div>
              {details === "" ? null : (
                <p className="m-0 break-words font-ui text-label text-ink-500">{details}</p>
              )}
              <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-ui text-body text-ink-700">
                <span className="font-num font-semibold tabular-nums text-ink-900">{doseLabel(traitement)}</span>
                {traitement.frequency === null ? null : (
                  <span>
                    {traitement.frequency} · {horaires(traitement)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {traitement.status === "active" ? (
              <>
                <Bouton rang="secondaire" taille="compact" disabled={busy} onClick={() => onModifier(traitement)}>
                  {traitements.actions.modifier}
                </Bouton>
                <Bouton rang="discret" taille="compact" disabled={busy} onClick={() => onHistorique(traitement.id)}>
                  {traitements.actions.historique}
                </Bouton>
                <Bouton rang="discret" taille="compact" disabled={busy} onClick={suspendre}>
                  {traitements.actions.mettreEnPause}
                </Bouton>
                {traitement.endDate === null ? null : (
                  <Bouton
                    rang="discret"
                    taille="compact"
                    disabled={busy}
                    onClick={() => {
                      setNouvelleFin(traitement.endDate ?? "");
                      setProlongerOuvert(true);
                    }}
                  >
                    {traitements.actions.prolonger}
                  </Bouton>
                )}
                <Bouton retrait taille="compact" disabled={busy} onClick={() => setArretOuvert(true)}>
                  {traitements.actions.arreter}
                </Bouton>
              </>
            ) : null}

            {traitement.status === "paused" ? (
              <>
                <Bouton rang="secondaire" taille="compact" disabled={busy} onClick={reprendre}>
                  {traitements.actions.reprendre}
                </Bouton>
                <Bouton rang="discret" taille="compact" disabled={busy} onClick={() => onModifier(traitement)}>
                  {traitements.actions.modifier}
                </Bouton>
                <Bouton rang="discret" taille="compact" disabled={busy} onClick={() => onHistorique(traitement.id)}>
                  {traitements.actions.historique}
                </Bouton>
                <Bouton retrait taille="compact" disabled={busy} onClick={() => setArretOuvert(true)}>
                  {traitements.actions.arreter}
                </Bouton>
              </>
            ) : null}

            {traitement.status === "stopped" ? (
              <>
                <Bouton rang="secondaire" taille="compact" disabled={busy} onClick={redemarrer}>
                  {traitements.actions.redemarrer}
                </Bouton>
                <Bouton rang="discret" taille="compact" disabled={busy} onClick={() => onHistorique(traitement.id)}>
                  {traitements.actions.historique}
                </Bouton>
              </>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-rule pt-4 tablet:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <dt className="font-ui text-label text-ink-500">{traitements.carte.depuis}</dt>
            <dd className="m-0 font-num text-body tabular-nums text-ink-900">{dateCivile(traitement.startDate) ?? traitements.commune.aucun}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-ui text-label text-ink-500">{traitements.carte.jusquau}</dt>
            <dd className="m-0 font-num text-body tabular-nums text-ink-900">
              {traitement.endDate === null ? traitements.commune.nonDisponible : (dateCivile(traitement.endDate) ?? traitements.commune.aucun)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-ui text-label text-ink-500">{traitements.carte.prescritPar}</dt>
            <dd className="m-0 break-words font-ui text-body text-ink-900">
              {prescripteurEnChargement
                ? traitements.commune.chargement
                : (traitement.practitionerName ?? traitements.hero.nonRenseigne)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="font-ui text-label text-ink-500">{traitements.carte.derniereModification}</dt>
            <dd className="m-0 font-num text-body tabular-nums text-ink-900">
              {jourLong(traitement.updatedAt) ?? traitements.commune.aucun}
            </dd>
          </div>
        </dl>

        {traitement.status === "stopped" && traitement.stoppedAt !== null ? (
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-rule bg-sunken px-3 py-2 font-ui text-label text-ink-700">
            <span className="font-semibold text-ink-900">{traitements.carte.arretLe}</span>
            <span className="font-num tabular-nums">{jourLong(traitement.stoppedAt) ?? traitement.stoppedAt}</span>
            {motifLisible(traitement.stoppedReason) === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {traitements.carte.motif} : {motifLisible(traitement.stoppedReason)}
                </span>
              </>
            )}
          </p>
        ) : null}

        {traitement.instructions === null ? null : (
          <p className="m-0 flex items-start gap-2 rounded-xl bg-sunken px-3 py-2 font-ui text-body text-ink-700">
            <Icone nom="journalActivite" taille={16} />
            <span className="min-w-0 break-words">{traitement.instructions}</span>
          </p>
        )}

        {erreur === null ? null : (
          <p role="alert" className="m-0 rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
            {erreur}
          </p>
        )}

        <Dialogue
          ouvert={arretOuvert}
          titre={traitements.formulaire.arretTitre}
          sousTitre={nom}
          busy={busy}
          onFermer={() => setArretOuvert(false)}
          pied={
            <div className="flex flex-wrap justify-end gap-2">
              <Bouton rang="discret" onClick={() => setArretOuvert(false)} disabled={busy}>
                {traitements.actions.annuler}
              </Bouton>
              <Bouton retrait onClick={arreter} disabled={busy}>
                {busy ? traitements.formulaire.enregistrement : traitements.actions.confirmer}
              </Bouton>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="m-0 font-ui text-body text-ink-700">{traitements.formulaire.arretCorps}</p>
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-label font-semibold text-ink-700">{traitements.formulaire.motif}</span>
              <select
                value={motif}
                onChange={(e) => setMotif(e.target.value as StoppedReason)}
                className="min-h-target rounded-xl border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none focus:border-action-600 focus:ring-2 focus:ring-action-600/20"
              >
                {Object.entries(traitements.formulaire.motifs).map(([cle, libelle]) => (
                  <option key={cle} value={cle}>
                    {libelle}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Dialogue>

        <Dialogue
          ouvert={prolongerOuvert}
          titre={traitements.formulaire.prolongerTitre}
          sousTitre={nom}
          busy={busy}
          onFermer={() => setProlongerOuvert(false)}
          pied={
            <div className="flex flex-wrap justify-end gap-2">
              <Bouton rang="discret" onClick={() => setProlongerOuvert(false)} disabled={busy}>
                {traitements.actions.annuler}
              </Bouton>
              <Bouton rang="principal" onClick={prolonger} disabled={busy || nouvelleFin === ""}>
                {busy ? traitements.formulaire.enregistrement : traitements.actions.confirmer}
              </Bouton>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="m-0 font-ui text-body text-ink-700">{traitements.formulaire.prolongerCorps}</p>
            <label className="flex flex-col gap-1.5">
              <span className="font-ui text-label font-semibold text-ink-700">{traitements.formulaire.nouvelleFin}</span>
              <input
                type="date"
                value={nouvelleFin}
                onChange={(e) => setNouvelleFin(e.target.value)}
                className="min-h-target rounded-xl border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none focus:border-action-600 focus:ring-2 focus:ring-action-600/20"
              />
            </label>
          </div>
        </Dialogue>
      </article>
    </Carte>
  );
}
