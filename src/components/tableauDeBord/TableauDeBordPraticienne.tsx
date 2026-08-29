/**
 * L'ÉCRAN DU MATIN DE LA PRATICIENNE — V4.
 *
 * ⚠️ UN SEUL APPEL SERVEUR AU CHARGEMENT. C'est le contrôle nommé du checkpoint
 * V4 (« un seul appel réseau, vérifié dans l'onglet Réseau ») et le budget de
 * 06-PERF-BUDGET.md : 1 appel · 100 ms · 400 ms. Toute donnée ajoutée à cet
 * écran passe par `app.dashboard_today` (059) — jamais par un second `await`
 * dans ce fichier, si légitime soit-il.
 *
 * LES CINQ ÉTATS (05-UX §1) SONT EXCLUSIFS, et cet écran n'en porte qu'un à la
 * fois : chargement → squelette à la forme du contenu ; erreur → une phrase et
 * un geste, jamais un état vide en dessous ; hors ligne → bandeau permanent ;
 * vide → chaque bloc dit POURQUOI il est vide ; contenu.
 *
 * POURQUOI PAS DE BOUTON « ACTUALISER ». Le tableau se rafraîchit seul toutes
 * les 120 s, onglet visible seulement, et au retour sur l'onglet — même
 * discipline que le cockpit d'accueil. Un bouton Actualiser dit à l'utilisatrice
 * que l'écran ment peut-être ; l'absence de bouton l'engage à ne pas mentir.
 *
 * LE TICK D'HORLOGE N'APPELLE RIEN. Toutes les 30 s, il déplace le curseur
 * « maintenant » et fait avancer le chronomètre de la séance en cours. C'est du
 * calcul local sur une donnée déjà chargée : zéro requête.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  BandeauHorsLigne,
  BlocErreur,
  Bouton,
  EnTeteEcran,
  LienBouton,
  MetaHeros,
  Section,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { getDashboardToday, type CreneauDuJour, type TableauDeBord } from "@/services/dashboard";
import { aujourdHuiCabinet } from "@/services/finance-calendrier";
import { startConsultation } from "@/services/consultations";

import { CarteSalleAttente, CarteSeanceEnCours, CarteSuivant } from "./CartesMaintenant";
import { CarteCaisse, CarteNouveauxPatients, CartePropositions } from "./ColonneContexte";
import { FilDeLaJournee } from "./FilDeLaJournee";
import { dateLongueCabinet } from "./heures";

/** Mêmes cadences que le cockpit d'accueil — une seule discipline dans le produit. */
const INTERVALLE_TABLEAU_MS = 120_000;
const INTERVALLE_TICK_MS = 30_000;

export function TableauDeBordPraticienne({
  horsLigneSession,
}: {
  readonly horsLigneSession: boolean;
}): React.JSX.Element {
  const [tableau, setTableau] = useState<TableauDeBord | null | undefined>(undefined);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [maintenant, setMaintenant] = useState<Date>(() => new Date());
  const [demarrage, setDemarrage] = useState(false);
  const router = useRouter();

  const recharger = useCallback(async (): Promise<void> => {
    // ⚠️ LE JOUR VIENT DU CABINET, PAS DU POSTE. `aujourdHuiCabinet()` projette
    // l'instant sur Africa/Algiers ; un `new Date().toISOString().slice(0,10)`
    // rendrait la veille entre minuit et 1 h du matin, et la caisse serait celle
    // d'hier — le même piège que les bornes de la porte 059.
    const resultat = await getDashboardToday(aujourdHuiCabinet());

    if (!resultat.ok) {
      setErreur(fr.tableauDeBord.erreur.chargement);
      return;
    }
    setErreur(undefined);
    setTableau(resultat.data);
  }, []);

  useEffect(() => {
    void recharger();
    setMaintenant(new Date());
  }, [recharger]);

  // Rafraîchissement borné — suspendu quand l'onglet est caché, repris au retour.
  useEffect(() => {
    const minuterie = setInterval(() => {
      if (document.visibilityState === "visible") void recharger();
    }, INTERVALLE_TABLEAU_MS);

    function auRetour(): void {
      if (document.visibilityState !== "visible") return;
      setMaintenant(new Date());
      void recharger();
    }
    document.addEventListener("visibilitychange", auRetour);

    return () => {
      clearInterval(minuterie);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [recharger]);

  // Le tick fait avancer la VÉRITÉ AFFICHÉE (chrono, curseur). Aucun appel.
  useEffect(() => {
    const tick = setInterval(() => setMaintenant(new Date()), INTERVALLE_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  /**
   * Ouvrir une séance depuis le tableau de bord.
   *
   * ⚠️ ON NE NAVIGUE QUE SI LA BASE A DIT OUI. `startConsultation` rend une
   * erreur quand la RLS refuse sans lever ; pousser l'écran de consultation
   * avant la réponse afficherait une séance qui n'existe pas.
   */
  async function demarrer(creneau: CreneauDuJour): Promise<void> {
    if (creneau.patientId === null || demarrage) return;

    setDemarrage(true);
    const resultat = await startConsultation({
      patientId: creneau.patientId,
      appointmentId: creneau.id,
    });
    setDemarrage(false);

    if (!resultat.ok) {
      setErreur(resultat.error.message);
      return;
    }
    // `router.push`, jamais `window.location` : un rechargement complet
    // repaierait tout le bundle sur l'écran au budget le plus serré. Même geste
    // qu'`/agenda/[id]` après une ouverture de séance.
    router.push(`/consultation/${resultat.data}`);
  }

  /* ── ÉTAT : CHARGEMENT ────────────────────────────────────────────────────
     Le squelette a la FORME de ce qui arrive — trois cartes en rangée, puis les
     deux colonnes. Sans cela, l'arrivée du contenu décale l'écran à l'instant
     précis où l'on clique. */
  if (tableau === undefined && erreur === undefined) {
    return (
      <div className="flex flex-col gap-8">
        <Squelette lignes={2} />
        <div className="grid grid-cols-trois gap-6">
          <Squelette lignes={4} />
          <Squelette lignes={4} />
          <Squelette lignes={4} />
        </div>
        <div className="grid grid-cols-cockpit gap-6">
          <Squelette lignes={8} />
          <Squelette lignes={6} />
        </div>
      </div>
    );
  }

  /* ── ÉTAT : ERREUR ────────────────────────────────────────────────────────
     Trois phrases dans l'ordre (ce qui s'est passé · ce qui a été préservé ·
     quoi faire), UNE action, aucun code technique, et AUCUN état vide en
     dessous : les deux ne coexistent jamais (05-UX §1). */
  if (erreur !== undefined && tableau === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={erreur}
          action={
            <Bouton rang="principal" onClick={() => void recharger()}>
              {fr.tableauDeBord.erreur.reessayer}
            </Bouton>
          }
        />
      </div>
    );
  }

  // `null` = la porte n'a rendu aucune ligne. L'écran reste dans sa composition
  // normale, chaque bloc affichant son propre état vide — c'est plus honnête
  // qu'une page « aucune donnée » qui laisserait croire à une panne.
  const t: TableauDeBord = tableau ?? {
    seanceOuverte: null,
    journee: [],
    suivant: null,
    attenteNombre: 0,
    encaisse: null,
    nouveauxPatientsMois: 0,
    propositions: [],
    genereA: "",
  };

  const terminees = t.journee.filter(
    (c) => c.status === "completed" || c.status === "no_show",
  ).length;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      {horsLigneSession ? <BandeauHorsLigne /> : null}

      <EnTeteEcran
        icone="tableauDeBord"
        surTitre={fr.tableauDeBord.sousTitre}
        titre={fr.tableauDeBord.salutation}
        sousTitre={fr.tableauDeBord.sousTitre}
        meta={
          <>
            <MetaHeros icone="horloge">{dateLongueCabinet(maintenant)}</MetaHeros>
            {t.journee.length === 0 ? null : (
              <MetaHeros icone="agenda">
                {`${fr.tableauDeBord.fil.seances.replace("{nombre}", String(t.journee.length))} · ${fr.tableauDeBord.fil.terminees.replace("{nombre}", String(terminees))}`}
              </MetaHeros>
            )}
          </>
        }
        actions={
          <LienBouton href="/agenda" rang="secondaire">
            {fr.tableauDeBord.ouvrirAgenda}
          </LienBouton>
        }
      />

      {/* Une erreur SURVENUE APRÈS un premier chargement réussi ne remplace pas
          l'écran : la journée déjà chargée reste lisible, et l'incident se dit
          au-dessus. C'est la règle « hors ligne » appliquée à l'incident réseau. */}
      {erreur !== undefined ? (
        <BlocErreur
          message={erreur}
          action={
            <Bouton rang="secondaire" onClick={() => void recharger()}>
              {fr.tableauDeBord.erreur.reessayer}
            </Bouton>
          }
        />
      ) : null}

      <div className="grid grid-cols-un items-stretch gap-4 tablet:grid-cols-trois">
        <CarteSeanceEnCours seance={t.seanceOuverte} maintenant={maintenant} />
        <CarteSuivant
          suivant={t.suivant}
          onDemarrer={(c) => void demarrer(c)}
          demarrageEnCours={demarrage}
        />
        <CarteSalleAttente nombre={t.attenteNombre} />
      </div>

      <div className="grid grid-cols-un gap-6 tablet:grid-cols-cockpit">
        <Section titre={fr.tableauDeBord.fil.titre} icone="agenda">
          <div className="rounded-xl border border-rule/60 bg-card p-5 shadow-lift1 lg:p-6">
            <FilDeLaJournee
              journee={t.journee}
              maintenant={maintenant}
              onDemarrer={(c) => void demarrer(c)}
              demarrageEnCours={demarrage}
            />
          </div>
        </Section>

        <aside className="flex flex-col gap-5">
          <CarteCaisse caisse={t.encaisse} />
          <CarteNouveauxPatients nombre={t.nouveauxPatientsMois} />
          <CartePropositions propositions={t.propositions} onMutation={() => void recharger()} />
        </aside>
      </div>
    </div>
  );
}
