"use client";

/**
 * /statistiques — L'ÉCRAN D'ANALYSE DE LA PRATIQUE.
 *
 * ═══ CE QUE CET ÉCRAN DOIT RÉPONDRE, SANS OUVRIR UN DOSSIER ════════════════
 *
 * Combien de séances, et à quel rythme ? Qui revient, qui arrive ? Quels
 * rendez-vous ne se tiennent pas ? Où en sont les échelles ? Quels libellés
 * diagnostiques sont réellement écrits ? Qu'est-ce qui attend un geste ?
 *
 * ═══ UN SEUL APPEL POUR TOUT L'ÉCRAN ═══════════════════════════════════════
 *
 * `app.get_analysis_overview` rend TOUT en une fois (06-PERF-BUDGET §3). Le
 * second appel — le détail nominatif — ne part que sur un clic, parce qu'il
 * écrit une trace de lecture et qu'un agrégat ne doit pas en produire une.
 *
 * ═══ AUCUNE ARITHMÉTIQUE MÉTIER ICI ════════════════════════════════════════
 *
 * Pas de `.reduce`, pas de division, pas de pourcentage. Les seuls calculs de
 * ce fichier sont GÉOMÉTRIQUES (largeur d'une barre, position d'une bulle) et
 * vivent dans les composants de graphique.
 *
 * ═══ LES ÉTATS SONT EXCLUSIFS ══════════════════════════════════════════════
 *
 * `EtatAnalyse` est une union discriminée : un écran est dans UN état, jamais
 * dans deux. L'écran précédent pouvait afficher « erreur » ET « vide ».
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import { BandeauHorsLigne, BlocErreur, LienBouton, Squelette } from "@/components/ui";
import { Icone } from "@/components/ui/Icones";
import { DrawerAnalyse, type DemandeDetail } from "@/components/analyse/DrawerAnalyse";
import { Methode } from "@/components/analyse/Methode";
import {
  ActiviteDansLeTemps,
  DelaisSuivi,
  MomentsJournee,
  NouveauxEtRetours,
  RythmeSemaine,
  StatutsRendezVous,
} from "@/components/analyse/PanneauxActivite";
import {
  DiagnosticsDocumentes,
  EchellesCliniques,
  QualiteDossier,
  Traitements,
} from "@/components/analyse/PanneauxCliniques";
import {
  SelecteurPeriodeAnalyse,
  periodeInitiale,
  type PeriodeAnalyse,
} from "@/components/analyse/SelecteurPeriodeAnalyse";
import { Synthese } from "@/components/analyse/Synthese";
import { analyse } from "@/i18n/analyse";
import { estAvantOuEgal, nombreDeJours } from "@/services/finance-calendrier";
import { formaterDzd } from "@/services/finance-cash";
import { getAnalyseOverview, type ApercuAnalyse } from "@/services/analyse";
import { fr } from "@/i18n/fr";

type EtatAnalyse =
  | { readonly statut: "chargement" }
  | { readonly statut: "charge"; readonly donnees: ApercuAnalyse }
  | { readonly statut: "vide" }
  | { readonly statut: "erreur"; readonly message: string };

const DELAI_MAX_MS = 20_000;

/**
 * La période lue dans l'URL, pour qu'un rechargement retrouve le même écran.
 * `window.location` et non `useSearchParams` : ce dernier impose une frontière
 * `<Suspense>` au rendu statique, et l'oublier fait échouer le BUILD avec un
 * message qui ne parle pas de cet écran.
 */
function periodeDepuisUrl(defaut: PeriodeAnalyse): PeriodeAnalyse {
  if (typeof window === "undefined") return defaut;
  const p = new URLSearchParams(window.location.search);
  const du = p.get("du");
  const au = p.get("au");
  if (du === null || au === null) return defaut;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au)) return defaut;
  if (!estAvantOuEgal(du, au)) return defaut;
  if (nombreDeJours(du, au) > 366) return defaut;
  return { nom: "personnalise", du, au };
}

export default function PageStatistiques(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [periode, setPeriode] = useState<PeriodeAnalyse>(() => periodeDepuisUrl(periodeInitiale()));
  const [etat, setEtat] = useState<EtatAnalyse>({ statut: "chargement" });
  const [demande, setDemande] = useState<DemandeDetail | null>(null);
  const generation = useRef(0);

  const charger = useCallback(async (p: PeriodeAnalyse) => {
    if (!estAvantOuEgal(p.du, p.au)) return;
    if (nombreDeJours(p.du, p.au) > 366) return;
    const gen = (generation.current += 1);
    // On garde l'écran précédent visible pendant un changement de période :
    // le remplacer par un squelette ferait clignoter toute la page.
    setEtat((prec) => (prec.statut === "charge" ? prec : { statut: "chargement" }));

    const minuteur = setTimeout(() => {
      if (generation.current !== gen) return;
      setEtat({ statut: "erreur", message: fr.delaiDepasse });
    }, DELAI_MAX_MS);

    const r = await getAnalyseOverview(p.du, p.au);
    clearTimeout(minuteur);
    if (generation.current !== gen) return;

    if (!r.ok) {
      setEtat({ statut: "erreur", message: r.error.message });
      return;
    }
    if (r.data === null) {
      setEtat({ statut: "vide" });
      return;
    }
    setEtat({ statut: "charge", donnees: r.data });
  }, []);

  useEffect(() => {
    void charger(periode);
  }, [charger, periode]);

  const changerPeriode = useCallback((p: PeriodeAnalyse) => {
    setPeriode(p);
    const url = new URL(window.location.href);
    url.searchParams.set("du", p.du);
    url.searchParams.set("au", p.au);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const ouvrir = useCallback((d: DemandeDetail) => setDemande(d), []);
  const fermer = useCallback(() => setDemande(null), []);

  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={4} />
      </main>
    );
  }

  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      sousTitre={analyse.sousTitre}
      sansGouttiere
      sansDefilement
    >
      <div className="analyse-scene relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="analyse-halo" aria-hidden="true" />

        <div className="analyse-barre flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <SelecteurPeriodeAnalyse
            periode={periode}
            onChange={changerPeriode}
            desactive={etat.statut === "chargement"}
          />
          {etat.statut === "charge" ? <LigneEncaisse encaisse={etat.donnees.encaisse} /> : null}
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-6 py-4">
          {horsLigneSession ? <BandeauHorsLigne /> : null}

          {etat.statut === "chargement" ? <Chargement /> : null}

          {etat.statut === "vide" ? (
            <BlocVide
              titre={analyse.etats.nonAutorise}
              aide={analyse.etats.nonAutoriseAide}
            />
          ) : null}

          {etat.statut === "erreur" ? (
            <div className="verre-panneau verre-liseret flex flex-col items-center gap-3 p-10 text-center">
              <p className="font-ui text-title font-semibold text-ink-900">{analyse.etats.erreur}</p>
              <p className="font-ui text-body text-ink-500">{etat.message || analyse.etats.erreurAide}</p>
              <button
                type="button"
                onClick={() => void charger(periode)}
                className="min-h-9 rounded-full bg-action-600 px-4 font-ui text-label font-semibold text-on-brand transition hover:bg-action-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600"
              >
                {analyse.etats.reessayer}
              </button>
            </div>
          ) : null}

          {etat.statut === "charge" ? (
            <Contenu apercu={etat.donnees} ouvrir={ouvrir} />
          ) : null}
        </div>
      </div>

      <DrawerAnalyse
        demande={demande}
        du={periode.du}
        au={periode.au}
        onFermer={fermer}
      />
    </AppShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE CONTENU — six rangées, une lecture de haut en bas
 * ═══════════════════════════════════════════════════════════════════════════ */

function Contenu({
  apercu,
  ouvrir,
}: {
  readonly apercu: ApercuAnalyse;
  readonly ouvrir: (d: DemandeDetail) => void;
}): React.JSX.Element {
  const p = apercu.pulse;
  const c = apercu.comparaison;
  const grain = apercu.periode.granularite;

  return (
    <div className="flex flex-col gap-3">
      <Synthese
        pulse={p}
        comparaison={c}
        serie={apercu.serie}
        onOuvrir={(kind) => ouvrir({ kind, cle: null, titre: libelleKpi(kind) })}
      />

      <div className="grid grid-cols-1 gap-3 desktop:grid-cols-12">
        <div className="min-w-0 desktop:col-span-8">
          <ActiviteDansLeTemps
            serie={apercu.serie}
            granularite={grain}
            total={p.seances}
            precedent={c.seances}
            onPoint={(cle) =>
              ouvrir({ kind: "serie", cle, titre: analyse.panneaux.activite.titre, grain })
            }
          />
        </div>
        <div className="min-w-0 desktop:col-span-4">
          <StatutsRendezVous
            statuts={apercu.statuts}
            onStatut={(cle) =>
              ouvrir({
                kind: "statuts",
                cle,
                titre: analyse.statuts[cle] ?? cle,
              })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 desktop:grid-cols-12">
        <div className="min-w-0 desktop:col-span-6">
          <NouveauxEtRetours
            nouveaux={p.nouveaux}
            retours={p.retours}
            onNouveaux={() => ouvrir({ kind: "nouveaux", cle: null, titre: analyse.pulse.nouveaux })}
            onRetours={() => ouvrir({ kind: "retours", cle: null, titre: analyse.pulse.retours })}
          />
        </div>
        <div className="min-w-0 desktop:col-span-3">
          <RythmeSemaine
            jours={apercu.joursSemaine}
            onJour={(cle) =>
              ouvrir({ kind: "jours_semaine", cle, titre: analyse.jours[cle] ?? cle })
            }
          />
        </div>
        <div className="min-w-0 desktop:col-span-3">
          <MomentsJournee
            heures={apercu.heures}
            onHeure={(cle) =>
              ouvrir({ kind: "heures", cle, titre: `${cle.padStart(2, "0")}:00` })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 desktop:grid-cols-12">
        <div className="min-w-0 desktop:col-span-7">
          <EchellesCliniques
            echelles={apercu.echelles}
            onMesure={(code, bande) =>
              ouvrir({
                kind: "echelles",
                cle: `${code}|${bande}`,
                titre: code,
              })
            }
          />
        </div>
        <div className="min-w-0 desktop:col-span-5">
          <DiagnosticsDocumentes
            diagnostics={apercu.diagnostics}
            onDiagnostic={(label) =>
              ouvrir({ kind: "diagnostics", cle: label, titre: label })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 desktop:grid-cols-12">
        <div className="min-w-0 desktop:col-span-7">
          <QualiteDossier
            notesManquantes={p.notes_manquantes}
            rdvNonClotures={p.rdv_non_clotures}
            onNotes={() =>
              ouvrir({
                kind: "notes_manquantes",
                cle: null,
                titre: analyse.panneaux.qualite.notesManquantes,
              })
            }
            onRdv={() =>
              ouvrir({
                kind: "rdv_non_clotures",
                cle: null,
                titre: analyse.panneaux.qualite.rdvNonClotures,
              })
            }
          />
        </div>
        <div className="min-w-0 desktop:col-span-5">
          <DelaisSuivi
            delais={apercu.delais}
            onDelai={(cle) =>
              ouvrir({ kind: "delais", cle, titre: analyse.delais[cle] ?? cle })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 desktop:grid-cols-12">
        <div className="min-w-0 desktop:col-span-5">
          <Traitements
            actifs={p.traitements_actifs}
            changements={p.changements_traitement}
            onActifs={() =>
              ouvrir({
                kind: "traitements_actifs",
                cle: null,
                titre: analyse.pulse.traitementsActifs,
              })
            }
            onChangements={() =>
              ouvrir({
                kind: "changements_traitement",
                cle: null,
                titre: analyse.pulse.changements,
              })
            }
          />
        </div>
        <div className="min-w-0 desktop:col-span-7">
          <SyntheseSecondaire pulse={p} />
        </div>
      </div>

      <Methode apercu={apercu} />
    </div>
  );
}

/** Les stocks : ce qui ne dépend pas de la fenêtre, et qui doit être dit. */
function SyntheseSecondaire({
  pulse,
}: {
  readonly pulse: ApercuAnalyse["pulse"];
}): React.JSX.Element {
  const lignes = [
    { etiquette: analyse.pulse.rdvAVenir, valeur: pulse.rdv_a_venir, aide: analyse.pulse.rdvAVenirAide },
    { etiquette: analyse.pulse.rdvNonClotures, valeur: pulse.rdv_non_clotures, aide: analyse.pulse.rdvNonCloturesAide },
    { etiquette: analyse.pulse.notesManquantes, valeur: pulse.notes_manquantes, aide: analyse.pulse.notesManquantesAide },
    { etiquette: analyse.pulse.patientesSuivies, valeur: pulse.patients_suivis, aide: analyse.pulse.patientesSuiviesAide },
    { etiquette: analyse.pulse.patientsTotal, valeur: pulse.patients_total, aide: analyse.pulse.patientsTotalAide },
  ];

  return (
    <section
      className="verre-panneau verre-liseret analyse-monte flex h-full flex-col gap-3 p-5"
      style={{ ["--delai" as string]: "440ms" }}
    >
      <div className="flex items-center gap-3">
        <span className="icone-lueur" data-teinte="aqua" aria-hidden="true">
          <Icone nom="patients" taille={20} />
        </span>
        <h2 className="font-ui text-heading font-bold tracking-heading text-ink-900">
          {analyse.pulse.patientsTotal}
        </h2>
      </div>
      <dl className="flex flex-col divide-y divide-white/70">
        {lignes.map((l) => (
          <div key={l.etiquette} className="flex items-baseline justify-between gap-4 py-2" title={l.aide}>
            <dt className="min-w-0 truncate font-ui text-label text-ink-500">{l.etiquette}</dt>
            <dd className="shrink-0 font-num text-body font-semibold tabular-nums text-ink-900">
              {l.valeur}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LigneEncaisse({
  encaisse,
}: {
  readonly encaisse: ApercuAnalyse["encaisse"];
}): React.JSX.Element {
  if (encaisse === null) {
    return (
      <p className="font-ui text-label text-ink-500" title={analyse.finance.absent}>
        {analyse.finance.absent}
      </p>
    );
  }
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-ui text-label text-ink-500">{analyse.finance.etiquette}</span>
      <span className="font-num text-body font-semibold tabular-nums text-ink-900">
        {formaterDzd(encaisse.montant)}
      </span>
      <span className="font-ui text-eyebrow text-ink-500">
        {encaisse.perimetre === "cabinet"
          ? analyse.finance.perimetreCabinet
          : analyse.finance.perimetrePraticienne}
      </span>
    </div>
  );
}

function Chargement(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="verre-panneau verre-liseret animate-pulse p-6">
        <Squelette lignes={3} />
      </div>
      <div className="grid grid-cols-1 gap-3 desktop:grid-cols-2">
        <div className="verre-panneau verre-liseret animate-pulse p-6">
          <Squelette lignes={5} />
        </div>
        <div className="verre-panneau verre-liseret animate-pulse p-6">
          <Squelette lignes={5} />
        </div>
      </div>
      <p className="text-center font-ui text-label text-ink-500">{analyse.etats.chargement}</p>
    </div>
  );
}

function BlocVide({ titre, aide }: { readonly titre: string; readonly aide: string }): React.JSX.Element {
  return (
    <div className="verre-panneau verre-liseret flex flex-col items-center gap-2 p-12 text-center">
      <span className="icone-lueur" data-teinte="ambre" aria-hidden="true">
        <span className="font-ui text-body font-bold">!</span>
      </span>
      <p className="font-ui text-title font-semibold text-ink-900">{titre}</p>
      <p className="max-w-prose font-ui text-body text-ink-500">{aide}</p>
    </div>
  );
}

function libelleKpi(kind: string): string {
  const table: Record<string, string> = {
    seances: analyse.pulse.seances,
    patientes_vues: analyse.pulse.patientesVues,
    nouveaux: analyse.pulse.nouveaux,
    retours: analyse.pulse.retours,
    absences: analyse.pulse.absences,
  };
  return table[kind] ?? kind;
}

