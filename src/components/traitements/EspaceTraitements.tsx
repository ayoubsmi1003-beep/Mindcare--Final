"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BlocErreur,
  Bouton,
  Carte,
  EtatVide,
  Icone,
  Onglets,
  PanneauOnglet,
  Squelette,
  type Onglet,
} from "@/components/ui";
import { traitements as t } from "@/i18n/traitements";
import {
  listPatientAdherence,
  listPatientAdverseEvents,
  listPatientAllergies,
  listPatientInteractionReviews,
  listPatientMeasurements,
  type AdherenceReport,
  type AdverseEvent,
  type AllergyEvent,
  type InteractionReview,
  type Measurement,
} from "@/services/medication-phase2";
import { getPatientTreatments, type StoppedReason, type Treatment } from "@/services/patient-treatments";
import {
  getPatientSessionMeasures,
  listMedicationTimeline,
  type MedicationTimelineCursor,
  type MedicationTimelineEvent,
  type SessionMeasure,
} from "@/services/medication-workspace";
import type { PatientWorkspace, TraitementV2 } from "@/services/patients";
import { historiqueEchelles, listerEchelles, type AdministrationEchelle, type EchelleDisponible } from "@/services/scales";

import { CarteTraitement } from "./CarteTraitement";
import { ChronologieTraitements } from "./ChronologieTraitements";
import { EvolutionTraitements } from "./EvolutionTraitements";
import { FormulaireTraitement } from "./FormulaireTraitement";
import { allergiesCourantes } from "./modele-phase2";
import { OrdonnancesTraitements } from "./OrdonnancesTraitements";
import { PanneauAttention } from "./PanneauAttention";
import { PlanPrises } from "./PlanPrises";
import { Polypharmacie } from "./Polypharmacie";
import { SecuriteTraitements } from "./SecuriteTraitements";
import { SurveillanceTraitements } from "./SurveillanceTraitements";
import { TiroirHistorique } from "./TiroirHistorique";

type CleOnglet = "vue" | "chronologie" | "evolution" | "ordonnances" | "surveillance" | "securite";

interface DonneesPhase2 {
  readonly allergies: readonly AllergyEvent[];
  readonly effets: readonly AdverseEvent[];
  readonly mesures: readonly Measurement[];
  readonly observance: readonly AdherenceReport[];
  readonly interactions: readonly InteractionReview[];
}

const ONGLETS: readonly Onglet[] = [
  { cle: "vue", libelle: t.tabs.vue, icone: "traitements" },
  { cle: "chronologie", libelle: t.tabs.chronologie, icone: "journalActivite" },
  { cle: "evolution", libelle: t.tabs.evolution, icone: "statistiques" },
  { cle: "ordonnances", libelle: t.tabs.ordonnances, icone: "documents" },
  { cle: "surveillance", libelle: t.tabs.surveillance, icone: "suivi" },
  { cle: "securite", libelle: t.tabs.securite, icone: "alerte" },
];

function depuisV2(v: TraitementV2, patientId: string): Treatment {
  return {
    id: v.id,
    patientId,
    medicationId: v.medicationId,
    medicationRaw: v.medicationRaw ?? "",
    brandName: v.brandName,
    form: v.form,
    strength: v.strength,
    inn: v.inn,
    consultationId: v.consultationId ?? null,
    previousTreatmentId: v.previousTreatmentId ?? null,
    status: v.status,
    dose: v.dose,
    doseUnit: v.doseUnit,
    frequency: v.frequency,
    timing: v.timing,
    instructions: v.instructions,
    startDate: v.startDate,
    endDate: v.endDate,
    stoppedAt: v.stoppedAt,
    stoppedReason: (v.stoppedReason as StoppedReason | null) ?? null,
    currentVersion: v.currentVersion,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt ?? v.createdAt,
    practitionerName: v.practitionerName ?? null,
    atcClass: v.atcClass ?? null,
  };
}

function Hero({
  liste,
  onAjouter,
  compact = false,
}: {
  readonly liste: readonly Treatment[];
  readonly onAjouter: () => void;
  readonly compact?: boolean;
}): React.JSX.Element {
  const actifs = liste.filter((x) => x.status === "active").length;
  const pauses = liste.filter((x) => x.status === "paused").length;
  const arretes = liste.filter((x) => x.status === "stopped").length;
  const compteurs = [
    { valeur: actifs, singulier: t.hero.actif, pluriel: t.hero.actifs },
    { valeur: pauses, singulier: t.hero.enPause, pluriel: t.hero.enPause },
    { valeur: arretes, singulier: t.hero.arreteRecent, pluriel: t.hero.arretes },
  ];

  if (compact) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-tuile-menthe px-4 py-3 shadow-carte">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-emeraude-700 shadow-douce">
            <Icone nom="traitements" taille={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-emeraude-700">
              {t.hero.eyebrow}
            </span>
            <h2 className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">{t.titre}</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {compteurs.map((item) => (
            <span
              key={item.singulier}
              className="inline-flex items-baseline gap-1.5 rounded-full border border-emeraude-200 bg-card px-3 py-1 font-ui text-label text-ink-500 shadow-douce"
            >
              <span className="font-num text-body font-bold tabular-nums text-ink-900">{item.valeur}</span>
              {item.valeur > 1 ? item.pluriel : item.singulier}
            </span>
          ))}
          <Bouton rang="principal" taille="compact" onClick={onAjouter}>
            <Icone nom="plus" taille={16} />
            {t.hero.ajouter}
          </Bouton>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="titre-espace-traitements"
      className="relative overflow-hidden rounded-3xl bg-vedette-vert p-6 shadow-vedette"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-reflet" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="m-0 font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-on-brand">
            {t.hero.eyebrow}
          </p>
          <h2 id="titre-espace-traitements" className="m-0 max-w-lecture font-editorial text-title font-bold tracking-title text-on-brand">
            {t.hero.titre}
          </h2>
          <p className="m-0 max-w-lecture font-ui text-body leading-relaxed text-on-brand">{t.hero.corps}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Bouton rang="secondaire" onClick={onAjouter}>
              <Icone nom="plus" taille={16} />
              {t.hero.ajouter}
            </Bouton>
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-3 gap-2">
          {compteurs.map((item) => (
            <div key={item.singulier} className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-card px-3 py-2 shadow-douce">
              <span className="font-num text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
                {item.valeur}
              </span>
              <span className="font-ui text-eyebrow leading-tight text-ink-500">
                {item.valeur > 1 ? item.pluriel : item.singulier}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function EspaceTraitements({
  patientId,
  initial,
  consultationId,
  onRefresh,
}: {
  readonly patientId: string;
  readonly initial: PatientWorkspace["traitementsV2"] | null;
  readonly consultationId: string | null;
  readonly onRefresh?: () => void;
}): React.JSX.Element {
  const [traitements, setTraitements] = useState<readonly Treatment[]>(() =>
    initial === null
      ? []
      : [...initial.actifs, ...initial.enPause, ...initial.arretesRecents].map((x) => depuisV2(x, patientId)),
  );
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<CleOnglet>("vue");
  const [formulaire, setFormulaire] = useState<{ traitement: Treatment | null } | null>(null);
  const [historique, setHistorique] = useState<Treatment | null>(null);

  const [timeline, setTimeline] = useState<readonly MedicationTimelineEvent[] | null>(null);
  const [timelineCurseur, setTimelineCurseur] = useState<MedicationTimelineCursor | null>(null);
  const [timelineFini, setTimelineFini] = useState(false);
  const [timelineChargement, setTimelineChargement] = useState(false);
  const [timelineErreur, setTimelineErreur] = useState<string | null>(null);
  const [timelineComplete, setTimelineComplete] = useState(false);
  const [timelineTronquee, setTimelineTronquee] = useState(false);
  /** Toute écriture incrémente : une lecture lente ne doit pas écraser l'état neuf. */
  const generationTimeline = useRef(0);

  const [phase2, setPhase2] = useState<DonneesPhase2 | null>(null);
  const [phase2Chargement, setPhase2Chargement] = useState(false);
  const [phase2Erreur, setPhase2Erreur] = useState<string | null>(null);
  const generationPhase2 = useRef(0);

  const [echelles, setEchelles] = useState<readonly AdministrationEchelle[] | null>(null);
  const [definitions, setDefinitions] = useState<readonly EchelleDisponible[] | null>(null);
  const [mesures, setMesures] = useState<readonly SessionMeasure[] | null>(null);
  const [surveillanceErreur, setSurveillanceErreur] = useState<string | null>(null);
  const [surveillanceChargement, setSurveillanceChargement] = useState(false);

  const charger = useCallback(() => {
    let vivant = true;
    setChargement(true);
    setErreur(null);
    void getPatientTreatments(patientId).then((r) => {
      if (!vivant) return;
      setChargement(false);
      if (!r.ok) {
        setErreur(r.error.message);
        return;
      }
      setTraitements([...r.data.actifs, ...r.data.enPause, ...r.data.arretesRecents]);
    });
    return () => {
      vivant = false;
    };
  }, [patientId]);

  useEffect(() => charger(), [charger]);

  const rafraichir = useCallback(() => {
    void getPatientTreatments(patientId).then((r) => {
      if (r.ok) {
        setTraitements([...r.data.actifs, ...r.data.enPause, ...r.data.arretesRecents]);
        setErreur(null);
      }
      // Une écriture de traitement change la chronologie et les posologies :
      // la prochaine ouverture de Chronologie/Évolution doit relire, jamais
      // servir l'état d'avant l'écriture.
      generationTimeline.current += 1;
      setTimeline(null);
      setTimelineCurseur(null);
      setTimelineFini(false);
      setTimelineErreur(null);
      setTimelineComplete(false);
      setTimelineTronquee(false);
      // Une lecture en vol est désormais périmée : son retour ne posera plus
      // l'état, donc elle ne doit pas laisser l'écran en chargement éternel.
      setTimelineChargement(false);
      onRefresh?.();
    });
  }, [patientId, onRefresh]);

  const chargerTimeline = useCallback(
    (suite: MedicationTimelineCursor | null) => {
      // Relire la première page remplace l'historique : on annule toute
      // lecture complète en vol et on repart d'un état non « complet ».
      const generation =
        suite === null ? (generationTimeline.current += 1) : generationTimeline.current;
      if (suite === null) {
        setTimelineComplete(false);
        setTimelineTronquee(false);
      }
      setTimelineChargement(true);
      setTimelineErreur(null);
      void listMedicationTimeline(patientId, suite, 20)
        .then((r) => {
          // Une écriture ou une relecture plus récente a pris la main : ce
          // résultat est périmé, il ne doit pas écraser l'état courant.
          if (generationTimeline.current !== generation) return;
          setTimelineChargement(false);
          if (!r.ok) {
            setTimelineErreur(r.error.message);
            return;
          }
          setTimeline((precedents) => (suite === null ? r.data.events : [...(precedents ?? []), ...r.data.events]));
          setTimelineCurseur(r.data.nextCursor);
          setTimelineFini(r.data.nextCursor === null);
        })
        .catch(() => {
          if (generationTimeline.current !== generation) return;
          setTimelineChargement(false);
          setTimelineErreur(t.commune.erreur);
        });
    },
    [patientId],
  );

  /**
   * L'évolution doit voir TOUT l'historique borné, pas seulement la première
   * page de la chronologie. On parcourt les pages jusqu'à 500 événements ; si
   * la borne est atteinte, l'écran le dit au lieu de laisser croire à une
   * histoire complète.
   */
  const chargerHistoriqueComplet = useCallback(() => {
    const generation = generationTimeline.current;
    setTimelineChargement(true);
    setTimelineErreur(null);
    void (async () => {
      const tous: MedicationTimelineEvent[] = [];
      let curseur: MedicationTimelineCursor | null = null;
      let tronquee = false;
      for (let page = 0; page < 10; page += 1) {
        // Une écriture ou une relecture plus récente a pris la main : arrêter
        // AVANT de demander la page suivante, pour ne pas empiler deux
        // parcours complets après une invalidation.
        if (generationTimeline.current !== generation) return;
        const r = await listMedicationTimeline(patientId, curseur, 50);
        if (generationTimeline.current !== generation) return;
        if (!r.ok) {
          setTimelineChargement(false);
          setTimelineErreur(r.error.message);
          return;
        }
        tous.push(...r.data.events);
        curseur = r.data.nextCursor;
        if (curseur === null) break;
        if (page === 9) tronquee = true;
      }
      if (generationTimeline.current !== generation) return;
      setTimeline(tous);
      setTimelineCurseur(curseur);
      setTimelineFini(curseur === null);
      setTimelineComplete(true);
      setTimelineTronquee(tronquee);
      setTimelineChargement(false);
    })().catch(() => {
      if (generationTimeline.current !== generation) return;
      setTimelineChargement(false);
      setTimelineErreur(t.commune.erreur);
    });
  }, [patientId]);

  const chargerPhase2 = useCallback(() => {
    generationPhase2.current += 1;
    const generation = generationPhase2.current;
    setPhase2Chargement(true);
    setPhase2Erreur(null);
    void Promise.all([
      listPatientAllergies(patientId),
      listPatientAdverseEvents(patientId),
      listPatientMeasurements(patientId),
      listPatientAdherence(patientId),
      listPatientInteractionReviews(patientId),
    ])
      .then(([allergies, effets, mesures, observance, interactions]) => {
        if (generationPhase2.current !== generation) return;
        setPhase2Chargement(false);
        if (!allergies.ok) {
          setPhase2Erreur(allergies.error.message);
          return;
        }
        if (!effets.ok) {
          setPhase2Erreur(effets.error.message);
          return;
        }
        if (!mesures.ok) {
          setPhase2Erreur(mesures.error.message);
          return;
        }
        if (!observance.ok) {
          setPhase2Erreur(observance.error.message);
          return;
        }
        if (!interactions.ok) {
          setPhase2Erreur(interactions.error.message);
          return;
        }
        setPhase2({
          allergies: allergies.data,
          effets: effets.data,
          mesures: mesures.data,
          observance: observance.data,
          interactions: interactions.data,
        });
      })
      .catch(() => {
        if (generationPhase2.current !== generation) return;
        setPhase2Chargement(false);
        setPhase2Erreur(t.phase2.erreur);
      });
  }, [patientId]);

  const chargerSurveillance = useCallback(() => {
    setSurveillanceChargement(true);
    setSurveillanceErreur(null);
    void Promise.all([
      historiqueEchelles(patientId),
      listerEchelles(),
      getPatientSessionMeasures(patientId),
    ])
      .then(([hist, defs, mes]) => {
        setSurveillanceChargement(false);
        if (!hist.ok) {
          setSurveillanceErreur(hist.error.message);
          return;
        }
        if (!defs.ok) {
          setSurveillanceErreur(defs.error.message);
          return;
        }
        if (!mes.ok) {
          setSurveillanceErreur(mes.error.message);
          return;
        }
        setEchelles(hist.data);
        setDefinitions(defs.data);
        setMesures(mes.data);
      })
      .catch(() => {
        setSurveillanceChargement(false);
        setSurveillanceErreur(t.commune.erreur);
      });
  }, [patientId]);

  const reessayerEvolution = useCallback(() => {
    generationTimeline.current += 1;
    setTimeline(null);
    setTimelineCurseur(null);
    setTimelineFini(false);
    setTimelineErreur(null);
    setTimelineComplete(false);
    setTimelineTronquee(false);
    setTimelineChargement(false);
    setEchelles(null);
    setDefinitions(null);
    setMesures(null);
    setSurveillanceErreur(null);
  }, []);

  useEffect(() => {
    if (onglet === "chronologie") {
      if (timeline !== null || timelineChargement || timelineErreur !== null) return;
      chargerTimeline(null);
      return;
    }
    if (onglet !== "evolution") return;
    // L'évolution lit TOUT l'historique borné, pas la première page.
    if (timelineComplete || timelineChargement || timelineErreur !== null) return;
    chargerHistoriqueComplet();
  }, [
    onglet,
    timeline,
    timelineComplete,
    timelineChargement,
    timelineErreur,
    chargerTimeline,
    chargerHistoriqueComplet,
  ]);

  useEffect(() => {
    if (onglet !== "evolution" && onglet !== "surveillance") return;
    if (echelles !== null || surveillanceChargement || surveillanceErreur !== null) return;
    chargerSurveillance();
  }, [onglet, echelles, surveillanceChargement, surveillanceErreur, chargerSurveillance]);

  useEffect(() => {
    if (onglet !== "vue" && onglet !== "securite" && onglet !== "surveillance") return;
    if (phase2 !== null || phase2Chargement || phase2Erreur !== null) return;
    chargerPhase2();
  }, [onglet, phase2, phase2Chargement, phase2Erreur, chargerPhase2]);

  const actifs = traitements.filter((x) => x.status === "active");
  const pauses = traitements.filter((x) => x.status === "paused");
  const arretes = traitements.filter((x) => x.status === "stopped");
  const timelineEvents = timeline ?? [];
  const allergiesActives = allergiesCourantes(phase2?.allergies ?? []);
  const evolutionChargee = timeline !== null && echelles !== null && definitions !== null && mesures !== null;

  if (chargement && traitements.length === 0) return <Squelette lignes={8} />;
  if (erreur !== null && traitements.length === 0) {
    return <BlocErreur message={erreur} action={<Bouton onClick={charger}>{t.commune.reessayer}</Bouton>} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <Hero liste={traitements} onAjouter={() => setFormulaire({ traitement: null })} compact={onglet !== "vue"} />
      {erreur === null ? null : (
        <p role="alert" className="m-0 rounded-xl bg-attention-bg px-3 py-2 font-ui text-body text-attention-ink">
          {erreur}
        </p>
      )}

      <Onglets onglets={ONGLETS} actif={onglet} onChanger={(cle) => setOnglet(cle as CleOnglet)} etiquette={t.titre} />

      <PanneauOnglet cle={onglet}>
        {onglet === "vue" ? (
          <div className="flex flex-col gap-6">
            <PanneauAttention traitements={traitements} onOuvrir={(id) => document.getElementById(`traitement-${id}`)?.scrollIntoView({ block: "center" })} />

            {allergiesActives.length === 0 ? null : (
              <Carte niveau="secondaire">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-attention-bg text-attention-ink">
                      <Icone nom="alerte" taille={16} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="m-0 font-ui text-body font-semibold text-ink-900">
                        {t.phase2.allergies.titre} · {allergiesActives.length}
                      </p>
                      <p className="m-0 break-words font-ui text-label text-ink-700">
                        {allergiesActives.map((a) => a.substance).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <Bouton rang="discret" taille="compact" onClick={() => setOnglet("securite")}>
                    {t.tabs.securite}
                  </Bouton>
                </div>
              </Carte>
            )}

            {traitements.length === 0 ? (
              <Carte niveau="secondaire">
                <EtatVide
                  titre={t.hero.videTitre}
                  message={t.hero.videCorps}
                  icone="traitements"
                  action={
                    <Bouton rang="principal" onClick={() => setFormulaire({ traitement: null })}>
                      {t.hero.premierTraitement}
                    </Bouton>
                  }
                />
              </Carte>
            ) : null}

            {actifs.length === 0 ? null : (
              <section aria-labelledby="titre-actifs" className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 id="titre-actifs" className="m-0 font-ui text-label font-bold tracking-label text-ink-500">
                    {t.statuts.active}
                  </h3>
                  <span className="rounded-full bg-card px-2 py-0.5 font-num text-eyebrow tabular-nums text-ink-500 shadow-douce">
                    {actifs.length}
                  </span>
                </div>
                {actifs.map((traitement) => (
                  <CarteTraitement
                    key={traitement.id}
                    traitement={traitement}
                    consultationId={consultationId}
                    prescripteurEnChargement={chargement}
                    onModifier={(x) => setFormulaire({ traitement: x })}
                    onHistorique={(id) => setHistorique(traitements.find((x) => x.id === id) ?? null)}
                    onChanged={rafraichir}
                  />
                ))}
              </section>
            )}

            {pauses.length === 0 ? null : (
              <section aria-labelledby="titre-pauses" className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 id="titre-pauses" className="m-0 font-ui text-label font-bold tracking-label text-ink-500">
                    {t.statuts.paused}
                  </h3>
                  <span className="rounded-full bg-card px-2 py-0.5 font-num text-eyebrow tabular-nums text-ink-500 shadow-douce">
                    {pauses.length}
                  </span>
                </div>
                {pauses.map((traitement) => (
                  <CarteTraitement
                    key={traitement.id}
                    traitement={traitement}
                    consultationId={consultationId}
                    prescripteurEnChargement={chargement}
                    onModifier={(x) => setFormulaire({ traitement: x })}
                    onHistorique={(id) => setHistorique(traitements.find((x) => x.id === id) ?? null)}
                    onChanged={rafraichir}
                  />
                ))}
              </section>
            )}

            {arretes.length === 0 ? null : (
              <section aria-labelledby="titre-arretes" className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 id="titre-arretes" className="m-0 font-ui text-label font-bold tracking-label text-ink-500">
                    {t.statuts.stopped}
                  </h3>
                  <span className="rounded-full bg-card px-2 py-0.5 font-num text-eyebrow tabular-nums text-ink-500 shadow-douce">
                    {arretes.length}
                  </span>
                </div>
                {arretes.map((traitement) => (
                  <CarteTraitement
                    key={traitement.id}
                    traitement={traitement}
                    consultationId={consultationId}
                    prescripteurEnChargement={chargement}
                    onModifier={(x) => setFormulaire({ traitement: x })}
                    onHistorique={(id) => setHistorique(traitements.find((x) => x.id === id) ?? null)}
                    onChanged={rafraichir}
                  />
                ))}
              </section>
            )}

            <PlanPrises liste={traitements} />
            <Polypharmacie liste={traitements} />
          </div>
        ) : null}

        {onglet === "chronologie" ? (
          <ChronologieTraitements
            events={timelineEvents}
            chargement={timelineChargement}
            erreur={timelineErreur}
            fini={timelineFini}
            onPlus={() => chargerTimeline(timelineCurseur)}
            onReessayer={() => chargerTimeline(null)}
          />
        ) : null}

        {onglet === "evolution" ? (
          <EvolutionTraitements
            liste={traitements}
            evenements={timelineEvents}
            echelles={echelles ?? []}
            definitions={definitions ?? []}
            mesures={mesures ?? []}
            chargement={surveillanceChargement || !evolutionChargee}
            erreur={timelineErreur ?? surveillanceErreur}
            tronquee={timelineTronquee}
            onReessayer={reessayerEvolution}
          />
        ) : null}

        {onglet === "ordonnances" ? <OrdonnancesTraitements patientId={patientId} liste={traitements} /> : null}

        {onglet === "surveillance" ? (
          <SurveillanceTraitements
            patientId={patientId}
            consultationId={consultationId}
            echelles={echelles ?? []}
            definitions={definitions ?? []}
            mesures={mesures ?? []}
            liste={traitements}
            mesuresPhysiques={phase2?.mesures ?? []}
            observance={phase2?.observance ?? []}
            chargement={surveillanceChargement || echelles === null}
            chargementPhase2={phase2Chargement || phase2 === null}
            erreur={surveillanceErreur}
            erreurPhase2={phase2Erreur}
            onReessayer={chargerSurveillance}
            onReessayerPhase2={chargerPhase2}
            onChanged={chargerPhase2}
          />
        ) : null}

        {onglet === "securite" ? (
          <SecuriteTraitements
            patientId={patientId}
            consultationId={consultationId}
            liste={traitements}
            allergies={phase2?.allergies ?? []}
            effets={phase2?.effets ?? []}
            interactions={phase2?.interactions ?? []}
            chargement={phase2Chargement || phase2 === null}
            erreur={phase2Erreur}
            onChanged={chargerPhase2}
            onReessayer={chargerPhase2}
          />
        ) : null}
      </PanneauOnglet>

      <FormulaireTraitement
        ouvert={formulaire !== null}
        traitement={formulaire?.traitement ?? null}
        patientId={patientId}
        consultationId={consultationId}
        onFermer={() => setFormulaire(null)}
        onSaved={rafraichir}
      />

      {historique === null ? null : (
        <TiroirHistorique
          traitementId={historique.id}
          nom={historique.medicationRaw || historique.brandName || historique.inn || t.commune.aucun}
          onFermer={() => setHistorique(null)}
        />
      )}
    </div>
  );
}
