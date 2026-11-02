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
import type { Document } from "@/services/documents";
import { linkPrescriptionRenewal, type RenewalLink } from "@/services/medication-phase2";

export function PanneauRenouvellements({
  patientId,
  documents,
  liens,
  chargement,
  erreur,
  onChanged,
  onReessayer,
}: {
  readonly patientId: string;
  readonly documents: readonly Document[];
  readonly liens: readonly RenewalLink[];
  readonly chargement: boolean;
  readonly erreur: string | null;
  readonly onChanged: () => void;
  readonly onReessayer: () => void;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [nouvelle, setNouvelle] = useState("");
  const [precedente, setPrecedente] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreurForm, setErreurForm] = useState<string | null>(null);

  const emises = useMemo(
    () =>
      documents
        .filter((d) => d.docType === "ordonnance" && d.status === "issued")
        .slice()
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    [documents],
  );
  const dejaLies = useMemo(() => new Set(liens.map((l) => l.newDocumentId)), [liens]);
  const disponibles = emises.filter((d) => !dejaLies.has(d.id));

  async function enregistrer(): Promise<void> {
    if (nouvelle === "" || precedente === "") {
      setErreurForm(t.phase2.renouvellements.aucunePrecedente);
      return;
    }
    if (nouvelle === precedente) {
      setErreurForm(t.phase2.renouvellements.aucunePrecedente);
      return;
    }
    setBusy(true);
    setErreurForm(null);
    const r = await linkPrescriptionRenewal({
      patientId,
      newDocumentId: nouvelle,
      previousDocumentId: precedente,
      notes: notes.trim() === "" ? null : notes.trim(),
    });
    setBusy(false);
    if (!r.ok) {
      setErreurForm(r.error.message);
      return;
    }
    setOuvert(false);
    setNouvelle("");
    setPrecedente("");
    setNotes("");
    onChanged();
  }

  return (
    <section aria-labelledby="titre-renouvellements" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-azur text-azure-700">
              <Icone nom="documents" taille={20} />
            </span>
            <h3 id="titre-renouvellements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {t.phase2.renouvellements.titre}
            </h3>
            <Badge ton={liens.length === 0 ? "neutre" : "information"}>{String(liens.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {t.phase2.renouvellements.aide}
          </p>
        </div>
        <Bouton
          rang="secondaire"
          taille="compact"
          onClick={() => setOuvert(true)}
          disabled={emises.length < 2 || disponibles.length === 0}
        >
          {t.phase2.renouvellements.lier}
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

      {chargement && liens.length === 0 ? (
        <Squelette lignes={2} />
      ) : liens.length === 0 ? (
        <Carte niveau="secondaire">
          <EtatVide
            titre={t.phase2.renouvellements.vide}
            message={
              emises.length < 2
                ? t.phase2.renouvellements.aucunePrecedente
                : t.phase2.renouvellements.aide
            }
            icone="documents"
            {...(emises.length < 2
              ? {}
              : {
                  action: (
                    <Bouton rang="principal" taille="compact" onClick={() => setOuvert(true)}>
                      {t.phase2.renouvellements.lier}
                    </Bouton>
                  ),
                })}
          />
        </Carte>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {liens.map((lien) => (
            <li key={lien.id}>
              <Carte niveau="secondaire">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge ton="information">{t.phase2.renouvellements.badge}</Badge>
                      <span className="font-num text-body font-semibold tabular-nums text-ink-900">
                        {lien.newDocumentNumber}
                      </span>
                    </div>
                    <p className="m-0 font-ui text-label text-ink-700">
                      {t.phase2.renouvellements.precedente} :{" "}
                      <span className="font-num tabular-nums">{lien.previousDocumentNumber}</span>
                      {" · "}
                      {dateCivile(lien.previousIssuedAt.slice(0, 10)) ?? lien.previousIssuedAt.slice(0, 10)}
                    </p>
                    {lien.notes === null ? null : (
                      <p className="m-0 break-words font-ui text-label text-ink-500">{lien.notes}</p>
                    )}
                  </div>
                  <span className="font-num text-label tabular-nums text-ink-500">
                    {jourLong(lien.linkedAt) ?? lien.linkedAt}
                  </span>
                </div>
              </Carte>
            </li>
          ))}
        </ul>
      )}

      <Dialogue
        ouvert={ouvert}
        titre={t.phase2.renouvellements.titreDialogue}
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
            libelle={t.phase2.renouvellements.nouvelle}
            valeur={nouvelle}
            onChange={setNouvelle}
            options={[
              { valeur: "", libelle: t.phase2.choisir },
              ...disponibles.map((d) => ({
                valeur: d.id,
                libelle: `${d.docNumber} · ${dateCivile(d.issuedAt.slice(0, 10)) ?? d.issuedAt.slice(0, 10)}`,
              })),
            ]}
          />
          <ChampSelection
            libelle={t.phase2.renouvellements.precedente}
            valeur={precedente}
            onChange={setPrecedente}
            options={[
              { valeur: "", libelle: t.phase2.choisir },
              ...emises
                .filter((d) => d.id !== nouvelle)
                .map((d) => ({
                  valeur: d.id,
                  libelle: `${d.docNumber} · ${dateCivile(d.issuedAt.slice(0, 10)) ?? d.issuedAt.slice(0, 10)}`,
                })),
            ]}
          />
          <ChampZoneTexte libelle={t.phase2.renouvellements.notes} valeur={notes} onChange={setNotes} lignes={2} />
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
