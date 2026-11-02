"use client";

import { useCallback, useEffect, useState } from "react";

import { BlocErreur, Bouton, Dialogue, EtatVide, Icone, Squelette } from "@/components/ui";
import { dateCivile, heure, jourLong } from "@/components/patients/format";
import { traitements as t } from "@/i18n/traitements";
import {
  getTreatmentHistory,
  type TreatmentCursor,
  type TreatmentHistoryEntry,
} from "@/services/patient-treatments";

import { motifArretLisible } from "./modele-traitements";

function objet(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function texte(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function dose(value: unknown): string | null {
  const o = objet(value);
  if (o === null) return null;
  const d = texte(o["dose"]);
  const u = texte(o["dose_unit"]);
  return [d, u].filter(Boolean).join(" ") || null;
}

function horaire(value: unknown): string | null {
  const o = objet(value);
  if (o === null) return null;
  const f = texte(o["frequency"]);
  const timing = Array.isArray(o["timing"])
    ? o["timing"].filter((x): x is string => typeof x === "string").join(" · ")
    : null;
  return [f, timing].filter(Boolean).join(" · ") || null;
}

function dateFin(value: unknown): string | null {
  const o = objet(value);
  if (o === null) return null;
  const fin = texte(o["end_date"]);
  return fin === null ? null : fin.slice(0, 10);
}

function Detail({ entree }: { readonly entree: TreatmentHistoryEntry }): React.JSX.Element | null {
  if (entree.action === "started") {
    const valeur = dose(entree.newValues) ?? horaire(entree.newValues);
    return valeur === null ? null : (
      <p className="m-0 font-num text-label tabular-nums text-ink-700">{valeur}</p>
    );
  }

  if (entree.action === "stopped") {
    const motif = motifArretLisible(entree.reason, t.formulaire.motifs);
    return motif === null ? null : (
      <p className="m-0 font-ui text-label text-ink-700">
        {t.formulaire.motif} : {motif}
      </p>
    );
  }

  if (entree.action === "renewed") {
    const fin = dateFin(entree.newValues);
    return fin === null ? null : (
      <p className="m-0 font-num text-label tabular-nums text-ink-700">
        {t.carte.jusquau} {dateCivile(fin) ?? fin}
      </p>
    );
  }

  if (entree.action !== "dose_changed" && entree.action !== "schedule_changed") {
    return entree.reason === null ? null : (
      <p className="m-0 font-ui text-label text-ink-500">{entree.reason}</p>
    );
  }

  const avant = entree.action === "dose_changed" ? dose(entree.previousValues) : horaire(entree.previousValues);
  const apres = entree.action === "dose_changed" ? dose(entree.newValues) : horaire(entree.newValues);
  if (avant === null && apres === null && entree.reason === null) return null;
  return (
    <div className="flex flex-col gap-1">
      {avant === null && apres === null ? null : (
        <div className="flex flex-wrap items-center gap-2 font-num text-label tabular-nums text-ink-700">
          <span className="rounded-lg bg-sunken px-2 py-1 text-ink-500">{avant ?? t.chronologie.valeurAbsente}</span>
          <Icone nom="fleche" taille={16} />
          <span className="rounded-lg bg-card px-2 py-1 font-semibold text-ink-900">{apres ?? t.chronologie.valeurAbsente}</span>
        </div>
      )}
      {entree.reason === null ? null : <p className="m-0 font-ui text-label text-ink-500">{entree.reason}</p>}
    </div>
  );
}

export function TiroirHistorique({
  traitementId,
  nom,
  onFermer,
}: {
  readonly traitementId: string;
  readonly nom: string;
  readonly onFermer: () => void;
}): React.JSX.Element {
  const [entries, setEntries] = useState<readonly TreatmentHistoryEntry[]>([]);
  const [curseur, setCurseur] = useState<TreatmentCursor | null>(null);
  const [fini, setFini] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(
    (suite: TreatmentCursor | null) => {
      setChargement(true);
      setErreur(null);
      void getTreatmentHistory(traitementId, suite, 30).then((r) => {
        setChargement(false);
        if (!r.ok) {
          setErreur(r.error.message);
          return;
        }
        setEntries((precedents) => (suite === null ? r.data.entries : [...precedents, ...r.data.entries]));
        setCurseur(r.data.nextCursor);
        setFini(r.data.nextCursor === null);
      });
    },
    [traitementId],
  );

  useEffect(() => {
    charger(null);
  }, [charger]);

  return (
    <Dialogue
      ouvert
      titre={t.actions.historique}
      sousTitre={nom}
      large
      onFermer={onFermer}
    >
      <div className="flex flex-col gap-3">
        {erreur !== null ? (
          <BlocErreur message={erreur} action={<Bouton onClick={() => charger(null)}>{t.commune.reessayer}</Bouton>} />
        ) : chargement && entries.length === 0 ? (
          <Squelette lignes={6} />
        ) : entries.length === 0 ? (
          <EtatVide message={t.chronologie.vide} icone="journalActivite" />
        ) : (
          <ol className="m-0 flex list-none flex-col p-0">
            {entries.map((entree) => (
              <li key={entree.id} className="flex gap-3 py-3">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-tuile-menthe text-emeraude-700">
                    <Icone nom="traitements" taille={16} />
                  </span>
                  <span aria-hidden="true" className="w-0 grow border-l border-rule" />
                </div>
                <div className="flex min-w-0 grow flex-col gap-1 pb-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-ui text-body font-semibold text-ink-900">
                      {t.chronologie.actions[entree.action] ?? entree.action}
                    </span>
                    <span className="font-num text-label tabular-nums text-ink-500">
                      {jourLong(entree.occurredAt) ?? t.commune.nonDisponible}
                      {heure(entree.occurredAt) === null ? "" : ` · ${heure(entree.occurredAt)}`}
                    </span>
                  </div>
                  <Detail entree={entree} />
                  <div className="flex flex-wrap items-center gap-2">
                    {entree.actorName === null ? null : (
                      <span className="font-ui text-label text-ink-500">
                        {t.chronologie.acteur} {entree.actorName}
                      </span>
                    )}
                    {entree.consultationId === null ? null : (
                      <span className="rounded-full border border-info-100 bg-info-50 px-2 py-0.5 font-ui text-eyebrow text-info-600">
                        {t.chronologie.seance}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {erreur !== null || entries.length === 0 || fini ? null : (
          <Bouton rang="secondaire" onClick={() => charger(curseur)} disabled={chargement}>
            {chargement ? t.commune.chargement : t.actions.chargerPlus}
          </Bouton>
        )}
      </div>
    </Dialogue>
  );
}
