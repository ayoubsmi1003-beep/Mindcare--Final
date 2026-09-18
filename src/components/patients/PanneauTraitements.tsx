/**
 * Traitements V2 — ADR-028.
 * État courant + historique versionné, inline edit, palette invité, drawer, arrêt confirmé.
 * Préserve traitements (prescriptions) legacy en fallback — jamais actif sans donnée.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge, Bouton, Carte, EtatVide } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  getMedicationVariants,
  searchMedications,
  type MedicationCatalogItem,
  type MedicationVariant,
} from "@/services/medications";
import {
  getTreatmentHistory,
  pauseTreatment,
  restartTreatment,
  resumeTreatment,
  startTreatment,
  stopTreatment,
  updateTreatment,
  type TreatmentHistoryEntry,
} from "@/services/patient-treatments";
import type { PatientWorkspace, TraitementV2 } from "@/services/patients";

import { heure, jourLong } from "./format";

function fmtTiming(timing: readonly string[]): string | null {
  if (timing.length === 0) return null;
  return timing.join(" · ");
}
function fmtDepuis(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  return jourLong(dateIso) ?? dateIso;
}
function doseLabel(t: TraitementV2): string {
  const parts = [t.dose, t.doseUnit, t.frequency].filter(Boolean) as string[];
  if (parts.length === 0) return fr.patients.traitements.posologie;
  return parts.join(" ");
}

const SOCLE_INPUT =
  "w-full min-h-target rounded-xl border border-rule bg-card px-4 py-3 font-ui text-body text-ink-900 placeholder:text-ink-300 outline-none focus:border-action-600 focus:ring-2 focus:ring-action-600/20";

/* Palette recherche médicament */
function PaletteRecherche({
  ouvert,
  onFermer,
  onSelection,
}: {
  readonly ouvert: boolean;
  readonly onFermer: () => void;
  readonly onSelection: (med: MedicationCatalogItem) => void;
}): React.JSX.Element | null {
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<readonly MedicationCatalogItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [chargement, setChargement] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ouvert) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setQ("");
      setResultats([]);
      setIdx(0);
    }
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;
    const aq = q.trim();
    if (aq.length < 2) {
      setResultats([]);
      return;
    }
    const t = window.setTimeout(() => {
      setChargement(true);
      // 30, pas 10 : à 10 résultats, la liste tenait déjà entière dans
      // `max-h-96` — rien à défiler, alors que le catalogue (15k lignes) en
      // proposait davantage. Le conteneur défilait très bien ; il n'avait
      // simplement rien au-delà du pli. 30 reste loin du catalogue entier
      // (toujours filtré côté base, jamais chargé en bloc côté client).
      void searchMedications(aq, 30).then((res) => {
        setChargement(false);
        if (!res.ok) return;
        setResultats(res.data);
        setIdx(0);
      });
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, ouvert]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onFermer();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, resultats.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const c = resultats[idx];
        if (c) onSelection(c);
      }
    },
    [idx, onFermer, onSelection, resultats],
  );

  if (!ouvert) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={fr.patients.traitementsV2.ajouterTitre}
      onClick={onFermer}
    >
      <div
        className="mt-12 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-rule bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="border-b border-rule p-3">
          <label htmlFor="recherche-med" className="sr-only">
            {fr.patients.traitementsV2.rechercherPlaceholder}
          </label>
          <input
            ref={inputRef}
            id="recherche-med"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={fr.patients.traitementsV2.rechercherPlaceholder}
            className={SOCLE_INPUT}
          />
          <p className="mt-2 font-ui text-label tracking-label text-ink-500">
            {fr.patients.traitementsV2.rechercherAide}
          </p>
        </div>

        <div className="max-h-96 overflow-auto p-2">
          {chargement ? (
            <p className="px-3 py-6 text-center font-ui text-body text-ink-500">{fr.etats.chargement}</p>
          ) : resultats.length === 0 ? (
            <p className="px-3 py-6 text-center font-ui text-body text-ink-500">
              {q.trim().length < 2 ? fr.patients.traitementsV2.rechercherPlaceholder : fr.patients.traitementsV2.rechercheVide}
            </p>
          ) : (
            <ul role="listbox" className="m-0 flex list-none flex-col gap-1 p-0">
              {resultats.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === idx}>
                  <button
                    type="button"
                    onClick={() => onSelection(m)}
                    className={`flex w-full min-h-9 flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left outline-none transition ${i === idx ? "bg-action-050 ring-1 ring-action-600" : "hover:bg-muted"} focus-visible:ring-2 focus-visible:ring-action-600`}
                  >
                    <span className="font-ui text-body font-medium text-ink-900">{m.rawName}</span>
                    <span className="font-ui text-label tracking-label text-ink-500">
                      {[m.strength, m.form].filter(Boolean).join(" · ") || m.inn}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-rule bg-muted/30 p-3">
          <Bouton rang="discret" onClick={onFermer}>
            {fr.actions.annuler}
          </Bouton>
        </div>
      </div>
    </div>
  );
}

/* Carte traitement + inline edit */
function CarteTraitement({
  t,
  onChanged,
  onHistorique,
}: {
  readonly t: TraitementV2;
  readonly onChanged: () => void;
  readonly onHistorique: (id: string) => void;
}): React.JSX.Element {
  const [edition, setEdition] = useState(false);
  const [dose, setDose] = useState(t.dose ?? "");
  const [doseUnit, setDoseUnit] = useState(t.doseUnit ?? "");
  const [freq, setFreq] = useState(t.frequency ?? "");
  const [timing, setTiming] = useState<readonly string[]>(t.timing);
  const [instr, setInstr] = useState(t.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmArret, setConfirmArret] = useState(false);
  const [motif, setMotif] = useState<string>("autre");
  const [variantes, setVariantes] = useState<readonly MedicationVariant[] | null>(null);
  const [doseLibre, setDoseLibre] = useState(false);

  useEffect(() => {
    setDose(t.dose ?? "");
    setDoseUnit(t.doseUnit ?? "");
    setFreq(t.frequency ?? "");
    setTiming(t.timing);
    setInstr(t.instructions ?? "");
  }, [t]);

  // Dosages existants du même médicament — peuple la liste déroulante à
  // l'ouverture de l'édition, plutôt qu'à chaque rendu de la carte : la
  // praticienne ne consulte cette liste qu'en modifiant.
  useEffect(() => {
    if (!edition) return;
    let vivant = true;
    setVariantes(null);
    void getMedicationVariants(t.medicationId).then((res) => {
      if (!vivant) return;
      setVariantes(res.ok ? res.data : []);
    });
    return () => {
      vivant = false;
    };
  }, [edition, t.medicationId]);

  // Saisie libre par défaut si la dose actuelle ne correspond à aucun
  // dosage catalogue connu — sinon la liste déroulante s'ouvrirait sur une
  // valeur qu'elle ne propose pas.
  useEffect(() => {
    if (variantes === null) return;
    const correspond = variantes.some((v) => v.strength === (t.dose ?? ""));
    setDoseLibre(!correspond);
  }, [variantes, t.dose]);

  const sauvegarder = useCallback(() => {
    setBusy(true);
    setErr(null);
    const changes: Record<string, unknown> = {};
    if (dose !== (t.dose ?? "")) changes["dose"] = dose.trim() === "" ? null : dose.trim();
    if (doseUnit !== (t.doseUnit ?? "")) changes["dose_unit"] = doseUnit.trim() === "" ? null : doseUnit.trim();
    if (freq !== (t.frequency ?? "")) changes["frequency"] = freq.trim() === "" ? null : freq.trim();
    if (JSON.stringify(timing) !== JSON.stringify(t.timing)) changes["timing"] = timing;
    if (instr !== (t.instructions ?? "")) changes["instructions"] = instr.trim() === "" ? null : instr.trim();
    if (Object.keys(changes).length === 0) {
      setEdition(false);
      setBusy(false);
      return;
    }
    void updateTreatment(t.id, t.currentVersion, changes, null).then((res) => {
      setBusy(false);
      if (!res.ok) {
        setErr(res.error.code === "conflit" || res.error.technical === "40001" ? fr.patients.traitementsV2.erreurConflit : res.error.message);
        return;
      }
      setEdition(false);
      onChanged();
    });
  }, [dose, doseUnit, freq, timing, instr, t, onChanged]);

  const pause = () => {
    setBusy(true);
    void pauseTreatment(t.id, t.currentVersion, null).then((r) => {
      setBusy(false);
      if (!r.ok) setErr(r.error.message);
      else onChanged();
    });
  };
  const reprendre = () => {
    setBusy(true);
    void resumeTreatment(t.id, t.currentVersion, null).then((r) => {
      setBusy(false);
      if (!r.ok) setErr(r.error.message);
      else onChanged();
    });
  };
  const arreter = () => {
    setBusy(true);
    void stopTreatment(t.id, t.currentVersion, (motif as never) || "autre", null, null).then((r) => {
      setBusy(false);
      setConfirmArret(false);
      if (!r.ok) setErr(r.error.message);
      else onChanged();
    });
  };

  const badgeTon: "positif" | "attention" | "neutre" =
    t.status === "active" ? "positif" : t.status === "paused" ? "attention" : "neutre";
  const badgeLabel =
    t.status === "active" ? fr.patients.traitementsV2.actif : t.status === "paused" ? fr.patients.traitementsV2.pause : fr.patients.traitementsV2.arrete;

  return (
    <Carte niveau="clinique">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="break-words font-ui text-body font-semibold text-ink-900">{t.medicationRaw ?? t.brandName ?? t.inn ?? "—"}</span>
              <Badge ton={badgeTon}>{badgeLabel}</Badge>
              {t.strength ? <span className="font-ui text-label tracking-label text-ink-500">{t.strength}</span> : null}
              {t.form ? <span className="font-ui text-label tracking-label text-ink-500">{t.form}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-ui text-body text-ink-700">
              <span className="tabular-nums">{doseLabel(t)}</span>
              {fmtTiming(t.timing) ? <span className="text-ink-500">{fmtTiming(t.timing)}</span> : null}
            </div>
            {t.instructions ? <p className="mt-1 break-words font-ui text-notes text-ink-700">{t.instructions}</p> : null}
            <p className="mt-2 font-ui text-label tracking-label text-ink-500">
              {fr.patients.traitementsV2.depuis} {fmtDepuis(t.startDate)} · {fr.patients.traitementsV2.modifieIlYa} {jourLong(t.updatedAt ?? t.createdAt) ?? ""}
            </p>
          </div>
        </div>

        {edition ? (
          <div className="flex flex-col gap-3 rounded-xl border border-action-600/20 bg-action-050 p-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.dose}</span>
                {/* Liste déroulante des dosages CATALOGUE du même médicament
                    (même DCI, même forme) quand il y en a plus d'un — évite la
                    saisie libre pour un cas que le catalogue connaît déjà.
                    `medication_id` du traitement n'est jamais modifié : choisir
                    une option ne change que le TEXTE de la dose. */}
                {variantes !== null && variantes.length > 1 && !doseLibre ? (
                  <select
                    value={dose}
                    onChange={(e) => {
                      if (e.target.value === "__libre__") {
                        setDoseLibre(true);
                        return;
                      }
                      setDose(e.target.value);
                    }}
                    className={SOCLE_INPUT}
                  >
                    {!variantes.some((v) => v.strength === dose) ? (
                      <option value={dose}>{dose || fr.patients.traitementsV2.dose}</option>
                    ) : null}
                    {variantes.map((v) => (
                      <option key={v.id} value={v.strength ?? ""}>
                        {[v.strength, v.form].filter(Boolean).join(" · ") || v.rawName}
                      </option>
                    ))}
                    <option value="__libre__">{fr.patients.traitementsV2.doseAutre}</option>
                  </select>
                ) : (
                  <input
                    value={dose}
                    onChange={(e) => setDose(e.target.value)}
                    placeholder={variantes === null ? fr.patients.traitementsV2.doseChargement : "100 mg"}
                    className={SOCLE_INPUT}
                  />
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.doseUnite}</span>
                <input value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)} placeholder="mg" className={SOCLE_INPUT} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.frequence}</span>
              <input value={freq} onChange={(e) => setFreq(e.target.value)} placeholder={fr.patients.traitementsV2.frequencePlaceholder} className={SOCLE_INPUT} />
            </label>
            <div className="flex flex-col gap-1">
              <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.horaires}</span>
              <div className="flex flex-wrap gap-2">
                {[fr.patients.traitementsV2.horairesMatin, fr.patients.traitementsV2.horairesMidi, fr.patients.traitementsV2.horairesSoir].map((h) => {
                  const active = timing.map((x) => x.toLowerCase()).includes(h.toLowerCase());
                  return (
                    <Bouton
                      key={h}
                      type="button"
                      taille="compact"
                      enfonce={active}
                      onClick={() => setTiming((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]))}
                    >
                      {h}
                    </Bouton>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.instructions}</span>
              <textarea value={instr} onChange={(e) => setInstr(e.target.value)} placeholder={fr.patients.traitementsV2.instructionsPlaceholder} rows={2} className={`${SOCLE_INPUT} resize-y`} />
            </label>
            {err ? <p role="alert" className="font-ui text-body text-critical">{err}</p> : null}
            <div className="flex justify-end gap-2">
              <Bouton rang="discret" onClick={() => setEdition(false)} disabled={busy}>
                {fr.actions.annuler}
              </Bouton>
              <Bouton rang="principal" onClick={sauvegarder} disabled={busy}>
                {busy ? fr.etats.chargement : fr.patients.traitementsV2.enregistrer}
              </Bouton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Bouton rang="secondaire" onClick={() => setEdition(true)} disabled={busy}>
              {fr.patients.traitementsV2.modifier}
            </Bouton>
            <Bouton rang="discret" onClick={() => onHistorique(t.id)}>
              {fr.patients.traitementsV2.historique}
            </Bouton>
            {t.status === "active" ? (
              <Bouton rang="discret" onClick={pause} disabled={busy}>
                {fr.patients.traitementsV2.mettreEnPause}
              </Bouton>
            ) : null}
            {t.status === "paused" ? (
              <Bouton rang="secondaire" onClick={reprendre} disabled={busy}>
                {fr.patients.traitementsV2.reprendre}
              </Bouton>
            ) : null}
            {t.status !== "stopped" ? (
              <Bouton rang="discret" onClick={() => setConfirmArret(true)} disabled={busy}>
                {fr.patients.traitementsV2.arreter}
              </Bouton>
            ) : null}
          </div>
        )}

        {err && !edition ? <p role="alert" className="font-ui text-body text-critical">{err}</p> : null}

        {confirmArret ? (
          <div className="rounded-xl border border-critical/30 bg-critical-bg p-3">
            <p className="font-ui text-body font-medium text-ink-900">{fr.patients.traitementsV2.confirmerArretTitre}</p>
            <p className="mt-1 font-ui text-body text-ink-700">{fr.patients.traitementsV2.confirmerArretCorps}</p>
            <p className="mt-2 font-ui text-label font-medium tracking-label text-ink-900">{t.medicationRaw}</p>
            <p className="font-ui text-label tracking-label text-ink-500">
              {doseLabel(t)} {fmtTiming(t.timing) ? `· ${fmtTiming(t.timing)}` : ""}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <label className="font-ui text-label tracking-label text-ink-500">
                {fr.patients.traitementsV2.motif}
                <select
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none focus:border-action-600 focus:ring-2 focus:ring-action-600/20"
                >
                  <option value="autre">{fr.patients.traitementsV2.motifs.autre}</option>
                  <option value="inefficacite">{fr.patients.traitementsV2.motifs.inefficacite}</option>
                  <option value="effets_indesirables">{fr.patients.traitementsV2.motifs.effets_indesirables}</option>
                  <option value="amelioration">{fr.patients.traitementsV2.motifs.amelioration}</option>
                  <option value="decision_clinique">{fr.patients.traitementsV2.motifs.decision_clinique}</option>
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <Bouton rang="discret" onClick={() => setConfirmArret(false)} disabled={busy}>
                  {fr.actions.annuler}
                </Bouton>
                <Bouton rang="principal" onClick={arreter} disabled={busy}>
                  {fr.patients.traitementsV2.confirmer}
                </Bouton>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Carte>
  );
}

function TiroirHistorique({
  traitementId,
  ouvert,
  onFermer,
}: {
  readonly traitementId: string | null;
  readonly ouvert: boolean;
  readonly onFermer: () => void;
}): React.JSX.Element | null {
  const [entries, setEntries] = useState<readonly TreatmentHistoryEntry[]>([]);
  const [chargement, setChargement] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ouvert || !traitementId) return;
    setChargement(true);
    setErr(null);
    void getTreatmentHistory(traitementId, null, 30).then((res) => {
      setChargement(false);
      if (!res.ok) setErr(res.error.message);
      else setEntries(res.data.entries);
    });
  }, [ouvert, traitementId]);

  if (!ouvert || !traitementId) return null;

  const labelAction = (a: string): string => {
    switch (a) {
      case "started":
        return fr.patients.traitementsV2.histCommence;
      case "dose_changed":
        return fr.patients.traitementsV2.histDoseModifiee;
      case "schedule_changed":
        return fr.patients.traitementsV2.histHoraireModifie;
      case "paused":
        return fr.patients.traitementsV2.histPause;
      case "resumed":
        return fr.patients.traitementsV2.histRepris;
      case "stopped":
        return fr.patients.traitementsV2.histArrete;
      case "renewed":
        return fr.patients.traitementsV2.histRenouvele;
      default:
        return a;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-900/30 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onFermer}>
      <div className="flex h-full w-full max-w-md flex-col bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule p-4">
          <h2 className="font-ui text-heading font-semibold tracking-heading text-ink-900">
            {fr.patients.traitementsV2.historiqueTitre}
          </h2>
          <Bouton rang="discret" onClick={onFermer} aria-label={fr.patients.traitementsV2.fermer}>
            ✕
          </Bouton>
        </div>
        <div className="grow overflow-auto p-4">
          {chargement ? (
            <p className="py-8 text-center font-ui text-body text-ink-500">{fr.etats.chargement}</p>
          ) : err ? (
            <p role="alert" className="font-ui text-body text-critical">{err}</p>
          ) : entries.length === 0 ? (
            <EtatVide message={fr.patients.vide.chronologie} />
          ) : (
            <ol className="m-0 flex list-none flex-col gap-0 p-0">
              {entries.map((e) => {
                const prev = e.previousValues as Record<string, unknown> | null;
                const next = e.newValues as Record<string, unknown> | null;
                const prevDose = prev ? String(prev["dose"] ?? "") : "";
                const nextDose = next ? String(next["dose"] ?? "") : "";
                return (
                  <li key={e.id} className="flex gap-3 border-l border-rule py-3 pl-4">
                    <div className="flex min-w-0 grow flex-col gap-1">
                      <span className="font-ui text-label tracking-label text-ink-500 tabular-nums">
                        {jourLong(e.occurredAt) ?? e.occurredAt} · {heure(e.occurredAt) ?? ""}
                      </span>
                      <span className="font-ui text-body font-medium text-ink-900">{labelAction(e.action)}</span>
                      {e.action === "dose_changed" && prevDose && nextDose ? (
                        <span className="font-ui text-body text-ink-700 tabular-nums">{prevDose} → {nextDose}</span>
                      ) : null}
                      {e.reason ? <span className="font-ui text-body text-ink-700">{fr.patients.traitementsV2.motif} : {e.reason}</span> : null}
                      {e.actorName ? <span className="font-ui text-label tracking-label text-ink-500">{e.actorName}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export function PanneauTraitements({
  traitements,
  traitementsV2,
  patientId,
  onRefresh,
}: {
  readonly traitements: PatientWorkspace["traitements"];
  readonly traitementsV2?: PatientWorkspace["traitementsV2"] | null;
  readonly patientId: string;
  readonly onRefresh?: () => void;
}): React.JSX.Element {
  const v2 = traitementsV2 ?? null;
  const hasV2 = v2 !== null;

  const [paletteOuverte, setPaletteOuverte] = useState(false);
  const [selection, setSelection] = useState<MedicationCatalogItem | null>(null);
  const [dose, setDose] = useState("");
  const [freq, setFreq] = useState("");
  const [timing, setTiming] = useState<readonly string[]>([]);
  const [instr, setInstr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [historiqueId, setHistoriqueId] = useState<string | null>(null);

  const totaux = useMemo(() => {
    if (!hasV2 || !v2) return null;
    return { actifs: v2.actifs.length, pause: v2.enPause.length, arretes: v2.arretesRecents.length, total: v2.total };
  }, [hasV2, v2]);

  const ouvrirPalette = () => {
    setSelection(null);
    setDose("");
    setFreq("");
    setTiming([]);
    setInstr("");
    setErr(null);
    setOkMsg(null);
    setPaletteOuverte(true);
  };

  const choisirMed = (m: MedicationCatalogItem) => {
    setSelection(m);
    setPaletteOuverte(false);
    if (m.strength) setDose(m.strength);
  };

  const creer = () => {
    if (!selection) return;
    setBusy(true);
    setErr(null);
    void startTreatment({
      patientId,
      medicationId: selection.id,
      dose: dose.trim() === "" ? null : dose.trim(),
      frequency: freq.trim() === "" ? null : freq.trim(),
      timing: timing.length === 0 ? null : timing,
      instructions: instr.trim() === "" ? null : instr.trim(),
    }).then((res) => {
      setBusy(false);
      if (!res.ok) {
        setErr(res.error.message);
        return;
      }
      setOkMsg(fr.patients.traitementsV2.traitementCree);
      setSelection(null);
      setDose("");
      setFreq("");
      setTiming([]);
      setInstr("");
      onRefresh?.();
      window.setTimeout(() => setOkMsg(null), 3000);
    });
  };

  if (!hasV2) {
    const derniere = traitements?.dernierePrescription ?? null;
    const autres = (traitements?.nombrePrescriptions ?? 0) - 1;
    if (derniere === null) return <EtatVide message={fr.patients.vide.prescriptions} icone="traitements" />;
    return (
      <div className="flex flex-col gap-6">
        <Carte niveau="clinique">
          <div className="p-4">
            <h2 className="mb-4 font-ui text-heading font-semibold tracking-heading text-ink-900">{fr.patients.sections.dernierePrescription}</h2>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-ui text-body text-ink-700">
                  {jourLong(derniere.prescribedAt) ?? fr.etats.texteAbsent}
                  {derniere.practitionerName ? ` · ${derniere.practitionerName}` : ""}
                </span>
                {derniere.isHandwritten ? <Badge ton="neutre">{fr.patients.traitements.manuscrite}</Badge> : null}
              </div>
              <ul className="m-0 list-none p-0">
                {derniere.lignes.map((l) => (
                  <li key={l.id} className="flex min-w-0 flex-col gap-1 border-b border-rule py-3 last:border-b-0">
                    <span className="break-words font-ui text-body font-medium text-ink-900">{l.designation ?? fr.etats.texteAbsent}</span>
                    <span className="font-ui text-label tracking-label text-ink-500">
                      {[l.dose, l.frequencyPerDay ? `${String(l.frequencyPerDay)} ${fr.patients.traitements.parJour}` : null, l.durationDays ? `${fr.patients.traitements.duree} ${String(l.durationDays)} ${fr.patients.traitements.jours}` : null].filter(Boolean).join(" · ")}
                    </span>
                    {l.instructions ? <span className="break-words font-ui text-notes text-ink-700">{l.instructions}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Carte>
        {autres > 0 ? <p className="font-ui text-body text-ink-500">{fr.patients.traitements.autresPrescriptions(autres)}</p> : null}
      </div>
    );
  }

  const actifs = v2.actifs;
  const enPause = v2.enPause;
  const arretes = v2.arretesRecents;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-ui text-heading font-semibold tracking-heading text-ink-900">{fr.patients.traitementsV2.titre}</h2>
          {totaux ? (
            <span className="font-ui text-body text-ink-500">
              {totaux.actifs} {fr.patients.traitementsV2.actifs}
              {totaux.pause > 0 ? ` · ${String(totaux.pause)} ${fr.patients.traitementsV2.enPause}` : ""}
              {totaux.arretes > 0 ? ` · ${String(totaux.arretes)} ${fr.patients.traitementsV2.arretesRecents}` : ""}
            </span>
          ) : null}
        </div>
        <Bouton rang="principal" onClick={ouvrirPalette}>
          + {fr.patients.traitementsV2.ajouter}
        </Bouton>
      </div>

      {okMsg ? <div className="rounded-xl bg-positive-bg px-3 py-2 font-ui text-body text-positive">{okMsg}</div> : null}
      {err && !selection ? <div className="rounded-xl bg-critical-bg px-3 py-2 font-ui text-body text-critical">{err}</div> : null}

      {selection ? (
        <Carte niveau="clinique">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="break-words font-ui text-body font-semibold text-ink-900">{selection.rawName}</span>
              <Bouton rang="discret" onClick={() => setSelection(null)}>
                {fr.actions.annuler}
              </Bouton>
            </div>
            <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.dose}</span>
                <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder={selection.strength ?? "100 mg"} className={SOCLE_INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.frequence}</span>
                <input value={freq} onChange={(e) => setFreq(e.target.value)} placeholder={fr.patients.traitementsV2.frequencePlaceholder} className={SOCLE_INPUT} />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.horaires}</span>
              <div className="flex flex-wrap gap-2">
                {[fr.patients.traitementsV2.horairesMatin, fr.patients.traitementsV2.horairesMidi, fr.patients.traitementsV2.horairesSoir].map((h) => {
                  const active = timing.includes(h);
                  return (
                    <Bouton
                      key={h}
                      type="button"
                      taille="compact"
                      enfonce={active}
                      onClick={() => setTiming((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]))}
                    >
                      {h}
                    </Bouton>
                  );
                })}
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-ui text-label tracking-label text-ink-500">{fr.patients.traitementsV2.instructions}</span>
              <textarea
                value={instr}
                onChange={(e) => setInstr(e.target.value)}
                placeholder={fr.patients.traitementsV2.instructionsPlaceholder}
                rows={2}
                className={`${SOCLE_INPUT} resize-y`}
              />
            </label>
            {err ? <p role="alert" className="font-ui text-body text-critical">{err}</p> : null}
            <div className="flex justify-end gap-2">
              <Bouton rang="discret" onClick={() => setSelection(null)} disabled={busy}>
                {fr.actions.annuler}
              </Bouton>
              <Bouton rang="principal" onClick={creer} disabled={busy}>
                {busy ? fr.etats.chargement : fr.actions.confirmer}
              </Bouton>
            </div>
          </div>
        </Carte>
      ) : null}

      {actifs.length === 0 && enPause.length === 0 && arretes.length === 0 ? (
        <EtatVide message={fr.patients.traitementsV2.aucun} icone="traitements" />
      ) : null}

      {actifs.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.traitementsV2.actifs} · {String(actifs.length)}
          </h3>
          {actifs.map((t) => (
            <CarteTraitement key={t.id} t={t} onChanged={() => onRefresh?.()} onHistorique={setHistoriqueId} />
          ))}
        </section>
      ) : null}

      {enPause.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.traitementsV2.enPause} · {String(enPause.length)}
          </h3>
          {enPause.map((t) => (
            <CarteTraitement key={t.id} t={t} onChanged={() => onRefresh?.()} onHistorique={setHistoriqueId} />
          ))}
        </section>
      ) : null}

      {arretes.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="font-ui text-label font-medium tracking-label text-ink-500">
            {fr.patients.traitementsV2.arretesRecents} · {String(arretes.length)}
          </h3>
          {arretes.map((t) => (
            <div key={t.id} className="opacity-80">
              <CarteTraitement t={t} onChanged={() => onRefresh?.()} onHistorique={setHistoriqueId} />
              <div className="mt-2 flex justify-end">
                <Bouton
                  rang="secondaire"
                  onClick={() => {
                    void restartTreatment(t.id, {}).then((res) => {
                      if (!res.ok) setErr(res.error.message);
                      else onRefresh?.();
                    });
                  }}
                >
                  {fr.patients.traitementsV2.redemarrer}
                </Bouton>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <PaletteRecherche ouvert={paletteOuverte} onFermer={() => setPaletteOuverte(false)} onSelection={choisirMed} />
      <TiroirHistorique traitementId={historiqueId} ouvert={historiqueId !== null} onFermer={() => setHistoriqueId(null)} />
    </div>
  );
}
