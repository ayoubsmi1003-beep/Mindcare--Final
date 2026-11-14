"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Bouton, ChampTexte, ChampZoneTexte, Dialogue, Icone } from "@/components/ui";
import { ListeSuggestions, surligner } from "@/components/recherche/ListeSuggestions";
import { useRechercheInstantane } from "@/components/recherche/use-recherche-instantanee";
import { prescriptionSimple as simple } from "@/i18n/prescription-simple";
import { explicitDailyFrequency } from "@/shared/documents/autofill";
import { traitements } from "@/i18n/traitements";
import {
  searchMedicationsPage,
  type MedicationCatalogItem,
} from "@/services/medications";
import {
  startTreatment,
  updateTreatment,
  type Treatment,
} from "@/services/patient-treatments";

function aujourdHuiAlger(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function conflit(technical: string | undefined): boolean {
  return technical === "40001" || technical === "conflit";
}

export function FormulaireTraitement({
  ouvert,
  onFermer,
  patientId,
  consultationId,
  traitement,
  onSaved,
}: {
  readonly ouvert: boolean;
  readonly onFermer: () => void;
  readonly patientId: string;
  readonly consultationId: string | null;
  readonly traitement: Treatment | null;
  readonly onSaved: () => void;
}): React.JSX.Element | null {
  const edition = traitement !== null;
  const [recherche, setRecherche] = useState("");
  const [indexActif, setIndexActif] = useState(0);
  const [selection, setSelection] = useState<MedicationCatalogItem | null>(null);
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState("");
  const [frequence, setFrequence] = useState("");
  const [prises,setPrises]=useState("");
  const generation=useRef(0);
  const [timing, setTiming] = useState<readonly string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [startDate, setStartDate] = useState(aujourdHuiAlger());
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const idListe = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const { etat, chargerPlus } = useRechercheInstantane<MedicationCatalogItem>({
    requete: recherche,
    chercher: (q, limit, offset) => searchMedicationsPage(q, limit, offset),
    minimum: 2,
    taille: 50,
    cle: (m) => m.id,
    actif: ouvert && !edition && selection === null,
  });

  const medicationId = traitement?.medicationId ?? selection?.id ?? null;

  useEffect(() => {
    if (!ouvert) return;
    setRecherche("");
    setIndexActif(0);
    setSelection(null);
    setDose(traitement?.dose ?? "");
    setDoseUnit(traitement?.doseUnit ?? "");
    generation.current++;
    setFrequence(traitement?.frequency ?? "");
    setPrises(traitement ? String(explicitDailyFrequency(traitement,null)??"") : "");
    setTiming(traitement?.timing ?? []);
    setInstructions(traitement?.instructions ?? "");
    setStartDate(traitement?.startDate ?? aujourdHuiAlger());
    setEndDate(traitement?.endDate ?? "");
    setErreur(null);
    setBusy(false);
    if (!edition) {
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [ouvert, traitement, edition,patientId]);

  const choisir = useCallback((item: MedicationCatalogItem) => {
    setSelection(item);
    setRecherche("");
    setIndexActif(0);
    setDose("");
    setDoseUnit("");
  }, []);

  function surTouche(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      setRecherche("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndexActif((i) => Math.min(i + 1, Math.max(etat.resultats.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndexActif((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      const item = etat.resultats[indexActif];
      if (item !== undefined) {
        e.preventDefault();
        choisir(item);
      }
    }
  }

  function enregistrer(): void {
    setErreur(null);
    if (medicationId === null) {
      setErreur(traitements.formulaire.selectionObligatoire);
      return;
    }
    if (startDate !== "" && endDate !== "" && endDate < startDate) {
      setErreur(traitements.formulaire.dateInvalide);
      return;
    }
    if (dose.length > 120 || instructions.length > 2000) {
      setErreur(traitements.formulaire.doseInvalide);
      return;
    }

    const numeric=/^[1-9][0-9]*$/.test(prises) && Number.isSafeInteger(Number(prises));
    if ((prises!=="" && !numeric) || (!numeric && !frequence.trim())) { setErreur(simple.countRequired);return; }
    const initialCount=traitement ? String(explicitDailyFrequency(traitement,null)??"") : "";
    const countChanged=prises!==initialCount;
    const savedFrequency=numeric && (!traitement || countChanged) ? `${prises} fois par jour` : frequence;
    const savedTiming=countChanged ? [] : timing;
    const requestGeneration=generation.current;
    setBusy(true);
    if (traitement !== null) {
      const changes: Record<string, unknown> = {};
      if (dose !== (traitement.dose ?? "")) changes["dose"] = dose.trim() === "" ? null : dose.trim();
      if (doseUnit !== (traitement.doseUnit ?? "")) changes["dose_unit"] = doseUnit.trim() === "" ? null : doseUnit.trim();
      if (savedFrequency !== (traitement.frequency ?? "")) changes["frequency"] = savedFrequency.trim() === "" ? null : savedFrequency.trim();
      if (JSON.stringify(savedTiming) !== JSON.stringify(traitement.timing)) changes["timing"] = savedTiming;
      if (instructions !== (traitement.instructions ?? "")) changes["instructions"] = instructions.trim() === "" ? null : instructions.trim();
      if (startDate !== traitement.startDate) changes["start_date"] = startDate === "" ? null : startDate;
      if (endDate !== (traitement.endDate ?? "")) changes["end_date"] = endDate === "" ? null : endDate;

      if (Object.keys(changes).length === 0) {
        setBusy(false);
        onFermer();
        return;
      }

      void updateTreatment(traitement.id, traitement.currentVersion, changes, consultationId).then((r) => {
        if(requestGeneration!==generation.current)return;
        setBusy(false);
        if (!r.ok) {
          setErreur(conflit(r.error.technical) ? traitements.formulaire.conflit : r.error.message);
          return;
        }
        onSaved();
        onFermer();
      });
      return;
    }

    void startTreatment({
      patientId,
      medicationId,
      dose: dose.trim() === "" ? null : dose.trim(),
      doseUnit: doseUnit.trim() === "" ? null : doseUnit.trim(),
      frequency: savedFrequency.trim() === "" ? null : savedFrequency.trim(),
      timing: savedTiming.length === 0 ? null : savedTiming,
      instructions: instructions.trim() === "" ? null : instructions.trim(),
      startDate: startDate === "" ? null : startDate,
      endDate: endDate === "" ? null : endDate,
      consultationId,
    }).then((r) => {
      if(requestGeneration!==generation.current)return;
      setBusy(false);
      if (!r.ok) {
        setErreur(conflit(r.error.technical) ? traitements.formulaire.conflit : r.error.message);
        return;
      }
      onSaved();
      onFermer();
    });
  }

  if (!ouvert) return null;

  const nom = traitement?.medicationRaw ?? selection?.rawName ?? null;
  const sousTitre = edition ? traitements.formulaire.modifierTitre : traitements.formulaire.ajouterTitre;

  return (
    <Dialogue
      ouvert={ouvert}
      titre={sousTitre}
      sousTitre={nom ?? traitements.formulaire.choisir}
      large
      busy={busy}
      onFermer={onFermer}
      pied={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-form font-ui text-label text-ink-500">
            {traitements.formulaire.versionne}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Bouton rang="discret" onClick={onFermer} disabled={busy}>
              {traitements.actions.annuler}
            </Bouton>
            <Bouton rang="principal" onClick={enregistrer} disabled={busy || medicationId === null}>
              {busy
                ? traitements.formulaire.enregistrement
                : edition
                  ? traitements.actions.enregistrer
                  : traitements.formulaire.ajouterTitre}
            </Bouton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {edition ? (
          <div className="flex items-center gap-3 rounded-2xl bg-sunken px-4 py-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-tuile-menthe text-emeraude-700">
              <Icone nom="traitements" taille={20} />
            </span>
            <div className="min-w-0">
              <p className="m-0 break-words font-ui text-body font-semibold text-ink-900">{nom}</p>
              <p className="m-0 font-ui text-label text-ink-500">{traitements.formulaire.modifierTitre}</p>
            </div>
          </div>
        ) : selection === null ? (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300">
                <Icone nom="recherche" taille={20} />
              </span>
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-expanded={etat.resultats.length > 0}
                aria-controls={etat.resultats.length > 0 ? idListe : undefined}
                aria-activedescendant={etat.resultats.length > 0 ? `${idListe}-option-${indexActif}` : undefined}
                aria-autocomplete="list"
                aria-label={traitements.formulaire.rechercher}
                value={recherche}
                onChange={(e) => {
                  setRecherche(e.target.value);
                  setIndexActif(0);
                }}
                onKeyDown={surTouche}
                placeholder={traitements.formulaire.rechercher}
                className="min-h-target-lg w-full rounded-2xl border border-rule bg-card py-3 pl-12 pr-4 font-ui text-body text-ink-900 shadow-lift1 outline-none transition focus:border-action-600 focus:ring-2 focus:ring-action-600/20"
              />
            </div>
            <p className="m-0 font-ui text-label text-ink-500">{traitements.formulaire.rechercherAide}</p>
            {recherche.trim().length < 2 ? (
              <p className="m-0 px-1 py-3 font-ui text-body text-ink-500">{traitements.formulaire.commencer}</p>
            ) : (
              <ListeSuggestions
                idListe={idListe}
                items={etat.resultats}
                actif={indexActif}
                onChoisir={choisir}
                rendre={(m) => (
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="break-words font-ui text-body font-medium text-ink-900">
                      {surligner(m.rawName, recherche)}
                    </span>
                    <span className="font-ui text-label text-ink-500">
                      {[m.strength, m.form, m.inn].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                )}
                requete={recherche}
                total={etat.total}
                chargement={etat.chargement}
                chargementPlus={etat.chargementPlus}
                erreur={etat.erreur}
                vide={traitements.formulaire.rechercheVide}
                onPlus={chargerPlus}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emeraude-200 bg-tuile-menthe px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-emeraude-700 shadow-douce">
                <Icone nom="traitements" taille={20} />
              </span>
              <div className="min-w-0">
                <p className="m-0 break-words font-ui text-body font-semibold text-ink-900">{selection.rawName}</p>
                <p className="m-0 font-ui text-label text-ink-500">
                  {[selection.strength, selection.form, selection.inn].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <Bouton rang="discret" taille="compact" onClick={() => setSelection(null)}>
              {traitements.formulaire.choisir}
            </Bouton>
          </div>
        )}

        {medicationId === null ? null : (
          <>
            <ChampTexte libelle={simple.dailyCount} type="number" valeur={prises} onChange={setPrises}/>
            <details open={Boolean(dose||doseUnit||instructions||endDate||(!prises&&frequence))}>
              <summary>{simple.details}</summary>
              {!prises ? <p role="alert">{simple.review}</p> : null}
              {timing.length ? <p>{simple.previousTiming} : {timing.join(" + ")}</p> : null}
              <ChampTexte libelle={traitements.formulaire.dose} valeur={dose} onChange={setDose}/>
              <ChampTexte libelle={traitements.formulaire.doseUnite} valeur={doseUnit} onChange={setDoseUnit}/>
              {!prises ? <ChampTexte libelle={traitements.formulaire.frequence} valeur={frequence} onChange={setFrequence}/> : null}
              <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
              <ChampTexte
                libelle={traitements.formulaire.dateDebut}
                type="date"
                valeur={startDate}
                onChange={setStartDate}
              />
              <ChampTexte
                libelle={traitements.formulaire.dateFin}
                type="date"
                valeur={endDate}
                onChange={setEndDate}
                indication={traitements.formulaire.dateFinAide}
              />
            </div>

            <ChampZoneTexte
              libelle={traitements.formulaire.instructions}
              valeur={instructions}
              onChange={setInstructions}
              placeholder={traitements.formulaire.instructionsPlaceholder}
              lignes={3}
            />
            </details>
          </>
        )}

        {erreur === null ? null : (
          <p role="alert" className="m-0 rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
            {erreur}
          </p>
        )}
      </div>
    </Dialogue>
  );
}
