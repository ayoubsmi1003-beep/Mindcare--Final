/**
 * Finances — l'écran de pilotage financier du cabinet.
 *
 * ⚠️ AUCUNE DÉCISION DE RÔLE DANS CE FICHIER. On ne lira jamais ici
 * `if (role === 'owner')` pour choisir quel montant montrer : la cloison ADR-005
 * est décidée par `app.finance_overview` (036 §3), en SQL, par
 * `app.current_role()`. Le sous-titre de périmètre vient de la BASE (champ
 * `perimetre`), et `parPraticienne` arrive VIDE pour une praticienne parce que
 * la PORTE l'a vidé — pas parce que cet écran l'aurait filtré. Le contrôle C15
 * du checkpoint vérifie mécaniquement l'absence de ce motif ici.
 *
 * L'assistante reçoit `null` des deux portes, et voit donc l'état vide. Ce n'est
 * pas un message d'interdiction : lui dire « accès refusé » lui apprendrait
 * qu'il y a un chiffre à ne pas voir.
 *
 * ═══ « RECETTE DU JOUR » A DISPARU, ET C'EST UNE CORRECTION DE VÉRITÉ ═══════
 *
 * L'écran affichait `day_revenue.total_dzd` — la somme de TOUS les tarifs de la
 * journée, encaissés ou non — sous le titre « Recette du jour », juste au-dessus
 * d'une ligne « Encaissements en attente ». Une recette est de l'argent reçu.
 * Le chiffre était juste, le mot était faux, et un mot faux sur une caisse se
 * recopie dans un carnet. Il y a désormais QUATRE chiffres nommés :
 * Facturé · Encaissé · En attente · Taux d'encaissement.
 *
 * ═══ UN SEUL APPEL AU CHARGEMENT ═══════════════════════════════════════════
 *
 * `06-PERF-BUDGET.md` §2 plafonne cet écran à UN appel réseau. Tout vient de
 * `finance_overview`. Le journal nominatif est un SECOND appel, déclenché par
 * un clic — §3 l'autorise nommément, et il écrit une trace d'audit, donc il ne
 * part jamais tout seul.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { CalendrierFinancier } from "@/components/finance/CalendrierFinancier";
import { CartesPulse } from "@/components/finance/CartesPulse";
import { GraphiqueEvolution } from "@/components/finance/GraphiqueEvolution";
import { GraphiqueRepartition } from "@/components/finance/GraphiqueRepartition";
import { JournalPaiements, TAILLE_PAGE } from "@/components/finance/JournalPaiements";
import { PointsAttention } from "@/components/finance/PointsAttention";
import { SelecteurPeriode } from "@/components/finance/SelecteurPeriode";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BandeauHorsLigne,
  BlocErreur,
  Bouton,
  EnTeteEcran,
  EtatVide,
  LienBouton,
  PanneauInfo,
  Section,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { recordPaymentCollected, type Paiement } from "@/services/finance";
import {
  aujourdHuiCabinet,
  bornesDePeriode,
  getFinanceOverview,
  listPeriodPayments,
  periodeEstValide,
  resumerPeriode,
  type ApercuFinancier,
  type Periode,
} from "@/services/finance-periode";

/** Les états de l'écran (05-UX-CONTRACT.md §1) — EXCLUSIFS, jamais superposés. */
type EtatFinances = "chargement" | "hors-ligne" | "erreur" | "contenu";

/**
 * Au-delà de ce délai sans réponse, on bascule en ERREUR avec le mot « délai »
 * (05-UX-CONTRACT.md §2) — jamais un squelette qui attend indéfiniment.
 */
const DELAI_CHARGEMENT_MS = 10_000;

/**
 * La période affichée à l'ouverture.
 *
 * « Ce mois » plutôt qu'« Aujourd'hui » : cet écran a changé de nature. La
 * question de la journée — « qu'est-ce que j'ai encaissé aujourd'hui » — revient
 * au tableau de bord (V4), qui est l'écran du matin. Celui-ci répond à « comment
 * va le cabinet », et un seul jour ne permet ni tendance, ni composition, ni
 * comparaison. « Aujourd'hui » reste à un clic.
 */
const PERIODE_INITIALE = "mois" as const;

/**
 * La période lue dans l'URL, pour qu'un rechargement et le bouton Précédent
 * retrouvent le même écran.
 *
 * ⚠️ `window.location`, PAS `useSearchParams`. Le hook de Next impose une
 * frontière `<Suspense>` au rendu statique, et l'oublier fait échouer le BUILD
 * avec un message qui parle de préfixation, jamais de finances. On lit l'URL
 * une fois, au montage, côté navigateur — cet écran est déjà `"use client"` et
 * n'a rien à pré-rendre.
 */
function periodeDepuisUrl(): Periode {
  const parDefaut = bornesDePeriode(PERIODE_INITIALE, aujourdHuiCabinet());
  if (typeof window === "undefined") return parDefaut;

  const p = new URLSearchParams(window.location.search);
  const du = p.get("du");
  const au = p.get("au");
  if (du === null || au === null || !periodeEstValide(du, au)) return parDefaut;
  return { nom: "personnalise", du, au };
}

export default function FinancesPage(): React.JSX.Element {
  const {
    utilisateur,
    sessionTranchee,
    horsLigne: horsLigneSession,
    deconnecter,
  } = useSessionEcran();

  const [periode, setPeriode] = useState<Periode>(() => periodeDepuisUrl());
  const [etat, setEtat] = useState<EtatFinances>("chargement");
  const [apercu, setApercu] = useState<ApercuFinancier | null>(null);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  const [envoi, setEnvoi] = useState<string | undefined>(undefined);

  // Le journal — replié par défaut, et son propre état de chargement : un échec
  // de pagination ne doit pas effacer les quatre chiffres du haut.
  const [journalOuvert, setJournalOuvert] = useState(false);
  const [journalChargement, setJournalChargement] = useState(false);
  const [journalLignes, setJournalLignes] = useState<readonly Paiement[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);
  const [journalPage, setJournalPage] = useState(0);

  // Compteur de génération : un rechargement déclenché pendant qu'un précédent
  // est en vol (changement rapide de période, double clic) doit voir le PLUS
  // RÉCENT gagner, jamais une réponse tardive écraser un état plus frais.
  const generation = useRef(0);

  const charger = useCallback(async (p: Periode) => {
    const gen = (generation.current += 1);

    // Contenu déjà affiché : rechargement SILENCIEUX, aucun retour au squelette.
    setEtat((precedent) => (precedent === "contenu" ? precedent : "chargement"));

    const minuteur = setTimeout(() => {
      if (generation.current !== gen) return;
      setEtat("erreur");
      setMessageErreur(fr.delaiDepasse);
    }, DELAI_CHARGEMENT_MS);

    const r = await getFinanceOverview(p.du, p.au);
    clearTimeout(minuteur);
    if (generation.current !== gen) return;

    if (!r.ok) {
      setEtat(r.error.code === "hors-ligne" ? "hors-ligne" : "erreur");
      setMessageErreur(r.error.message);
      return;
    }

    setMessageErreur(undefined);
    setApercu(r.data);
    setEtat("contenu");
  }, []);

  const chargerJournal = useCallback(async (p: Periode, page: number) => {
    setJournalChargement(true);
    const r = await listPeriodPayments(p.du, p.au, TAILLE_PAGE, page * TAILLE_PAGE);
    setJournalChargement(false);
    if (!r.ok) {
      setEtat(r.error.code === "hors-ligne" ? "hors-ligne" : "erreur");
      setMessageErreur(r.error.message);
      return;
    }
    setJournalLignes(r.data.lignes);
    setJournalTotal(r.data.total);
  }, []);

  useEffect(() => {
    // On attend la session avant d'interroger : la porte du journal écrit une
    // trace en base, et journaliser une lecture pour un écran qui va rediriger
    // vers la connexion serait une trace fausse.
    if (sessionTranchee !== true) return;
    void charger(periode);
  }, [sessionTranchee, periode, charger]);

  // L'URL suit la période, sans empiler d'entrées d'historique : changer de
  // période n'est pas une navigation, c'est un réglage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = new URL(window.location.href);
    u.searchParams.set("du", periode.du);
    u.searchParams.set("au", periode.au);
    window.history.replaceState(null, "", u.toString());
  }, [periode]);

  const changerPeriode = useCallback((p: Periode) => {
    if (!periodeEstValide(p.du, p.au)) {
      // Bornes incomplètes pendant une saisie : on garde l'état à l'écran et on
      // n'interroge pas. Le sélecteur affiche déjà la raison.
      setPeriode(p);
      return;
    }
    setPeriode(p);
    setConfirmation(undefined);
    // Le journal repart à sa première page : la page 3 d'une autre période
    // n'existe pas.
    setJournalPage(0);
    setJournalLignes([]);
    setJournalTotal(0);
    if (journalOuvert) void chargerJournal(p, 0);
  }, [journalOuvert, chargerJournal]);

  const basculerJournal = useCallback(() => {
    const ouvre = !journalOuvert;
    setJournalOuvert(ouvre);
    if (ouvre) void chargerJournal(periode, journalPage);
  }, [journalOuvert, periode, journalPage, chargerJournal]);

  const changerPage = useCallback((page: number) => {
    setJournalPage(page);
    void chargerJournal(periode, page);
  }, [periode, chargerJournal]);

  const encaisser = useCallback(
    async (paiement: Paiement) => {
      setMessageErreur(undefined);
      setConfirmation(undefined);
      setEnvoi(paiement.id);

      const result = await recordPaymentCollected(paiement.id);
      setEnvoi(undefined);

      if (!result.ok) {
        setEtat(result.error.code === "hors-ligne" ? "hors-ligne" : "erreur");
        setMessageErreur(result.error.message);
        return;
      }

      if (result.data !== null) setConfirmation(fr.finances.encaissementEnregistre);
      // Les quatre chiffres du haut CHANGENT avec l'encaissement : on relit les
      // deux sources plutôt que de corriger l'état à la main. Une caisse
      // rafistolée côté client finit par diverger de la base.
      void charger(periode);
      if (journalOuvert) void chargerJournal(periode, journalPage);
    },
    [charger, chargerJournal, periode, journalOuvert, journalPage],
  );

  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={4} />
      </main>
    );
  }

  // « Échec de lecture de la session » n'est PAS « aucune session » : hors
  // ligne, on reste sur place et on le dit, on n'éjecte pas vers la connexion.
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

  const horsLigne = horsLigneSession || etat === "hors-ligne";
  const perimetre =
    apercu?.perimetre === "cabinet"
      ? fr.finances.perimetreCabinet
      : fr.finances.perimetrePraticienne;

  // Une période sans aucune séance tarifée : un SEUL état vide pour tout le
  // bloc analytique, jamais quatre cartes à « 0 DZD » suivies de trois
  // graphiques plats. Quatre zéros ressemblent à une donnée ; ils n'en sont pas.
  const vide = apercu !== null && apercu.pulse.seancesTarifees === 0;

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
    >
      <div className="flex flex-col gap-8">
        {horsLigne ? <BandeauHorsLigne /> : null}

        <EnTeteEcran
          icone="finances"
          titre={fr.finances.titre}
          {...(etat === "contenu" && apercu !== null ? { sousTitre: perimetre } : {})}
        />

        <SelecteurPeriode
          periode={periode}
          onChange={changerPeriode}
          desactive={etat === "chargement"}
        />

        {confirmation === undefined ? null : (
          <PanneauInfo ton="positif">{confirmation}</PanneauInfo>
        )}

        {/* 05-UX-CONTRACT.md §1 : un SEUL état à la fois. ERREUR remplace le
            contenu — elle ne s'affiche jamais au-dessus d'un vide ou de
            chiffres obsolètes. */}
        {etat === "chargement" ? (
          <Squelette lignes={6} />
        ) : etat === "erreur" ? (
          <BlocErreur
            message={messageErreur ?? fr.erreurs.inattendu}
            action={<Bouton onClick={() => void charger(periode)}>{fr.actions.reessayer}</Bouton>}
          />
        ) : etat === "hors-ligne" && apercu === null ? (
          // Hors ligne dès le premier chargement : rien n'a encore été lu, il
          // n'y a donc rien à garder affiché — le bandeau suffit.
          null
        ) : apercu === null ? (
          // La porte a rendu `null` : hors périmètre (assistante). Un écran
          // vide, jamais un refus.
          <EtatVide message={fr.finances.videPeriode} />
        ) : vide ? (
          <EtatVide message={fr.finances.videPeriode} />
        ) : (
          <>
            <CartesPulse pulse={apercu.pulse} />

            {/* Le résumé, composé de fragments français à partir des SEULS
                chiffres ci-dessus. Aucun modèle de langage : tout y est
                déterministe, et les preuves sont la page elle-même. */}
            <p className="font-ui text-body text-ink-700">{resumerPeriode(apercu)}</p>

            <PointsAttention
              points={apercu.points}
              onOuvrirJournal={() => {
                if (!journalOuvert) basculerJournal();
              }}
            />

            <Section titre={fr.finances.graphiques.evolution}>
              <GraphiqueEvolution
                serie={apercu.serie}
                grain={apercu.grain}
                aujourdHui={aujourdHuiCabinet()}
              />
            </Section>

            <Section titre={fr.finances.graphiques.repartition}>
              <GraphiqueRepartition
                groupes={apercu.parType}
                total={apercu.pulse.factureDzd}
                titreTableau={fr.finances.graphiques.repartition}
              />
            </Section>

            {/* Vide pour une praticienne — décidé EN BASE (036 §3). Une
                répartition à une seule ligne serait du bruit. */}
            {apercu.parPraticienne.length > 1 ? (
              <Section titre={fr.finances.graphiques.parPraticienne}>
                <GraphiqueRepartition
                  groupes={apercu.parPraticienne}
                  total={apercu.pulse.factureDzd}
                  titreTableau={fr.finances.graphiques.parPraticienne}
                />
              </Section>
            ) : null}

            {/* Le calendrier n'a de sens qu'au grain « jour » : ailleurs, une
                case ne correspond plus à une journée. */}
            {apercu.grain === "jour" ? (
              <Section titre={fr.finances.graphiques.calendrier}>
                <CalendrierFinancier
                  serie={apercu.serie}
                  aujourdHui={aujourdHuiCabinet()}
                />
              </Section>
            ) : null}

            <JournalPaiements
              ouvert={journalOuvert}
              onBasculer={basculerJournal}
              chargement={journalChargement}
              lignes={journalLignes}
              total={journalTotal}
              page={journalPage}
              onPage={changerPage}
              onEncaisser={encaisser}
              envoiEnCours={envoi}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
