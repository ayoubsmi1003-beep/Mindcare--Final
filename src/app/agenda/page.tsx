/**
 * Agenda — vue semaine par défaut, vue jour au besoin.
 *
 * ⚠️ QUATRE PIÈGES DE PÉRIMÈTRE, TOUS PORTÉS PAR LA BASE, TOUS À RESPECTER ICI.
 *
 * 1. ZÉRO LIGNE N'EST PAS ZÉRO RENDEZ-VOUS. `app.list_agenda` applique la RLS
 *    de 006 : une grille vide signifie « rien de VISIBLE par vous ». L'écran ne
 *    dit donc jamais « le cabinet n'a aucun rendez-vous » — l'agenda de l'autre
 *    praticienne existe peut-être, et c'est la cloison ADR-003 qui le masque.
 *
 * 2. UN RENDEZ-VOUS PEUT N'AVOIR AUCUN NOM, ET IL FAUT QUAND MÊME L'AFFICHER.
 *    La porte joint `app.patients` en LEFT JOIN : dossier hors périmètre ou
 *    demande web non validée rendent une ligne sans identité. La masquer
 *    cacherait une HEURE OCCUPÉE, donc produirait un double booking.
 *
 * 3. LA PLAGE EST BORNÉE EN BASE — 62 jours. Une plage que l'écran choisirait
 *    sans limite serait un export de la base patients par la porte de service.
 *
 * 4. LE FILTRE D'ÉTAT N'EST PAS UNE PROTECTION. `STATUTS_AGENDA` choisit ce
 *    qu'on REGARDE, pas ce qu'on a le DROIT de lire — c'est la RLS qui décide
 *    ça, et une demande en attente reste parfaitement lisible. Ne jamais
 *    présenter ce filtre comme une cloison.
 *
 * I4 — LA LECTURE EST JOURNALISÉE PAR LA BASE, UNE FOIS PAR APPEL, en contexte
 * `liste`. Deux appels sont faits ici (la grille, puis la file d'attente) : deux
 * lignes d'audit, ce qui est exact — ce sont deux consultations distinctes.
 *
 * AUCUNE DÉCISION D'AUTORISATION ICI. Pas un seul `if (role === …)`.
 *
 * LE MOTIF DE CONSULTATION N'APPARAÎT NULLE PART : il vit dans
 * `app.appointment_reasons`, sans policy assistante (ADR-017). `kind` — le TYPE
 * de consultation — est une autre donnée, administrative, et lui est affiché.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { heure, jour, jourComplet, nomPatient, Statut } from "@/components/AgendaPieces";
import { GrilleSemaine } from "@/components/GrilleSemaine";
import {
  BandeauHorsLigne,
  BlocErreur,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import {
  listAgenda,
  STATUTS_AGENDA,
  STATUTS_EN_ATTENTE,
  type AgendaEntry,
} from "@/services/appointments";

/** Amplitude affichée. Bornes de la grille, pas des heures d'ouverture : le
    cabinet n'a pas déclaré les siennes, et les inventer afficherait une
    information fausse sur son fonctionnement. */
const HEURE_DEBUT = 8;
const HEURE_FIN = 19;
const JOURS_SEMAINE = 7;

type Vue = "semaine" | "jour";

/**
 * V1.5 — au-delà de ce délai sans réponse, l'écran bascule en ERREUR avec le
 * mot « délai » (05-UX-CONTRACT.md §2) : aucune attente n'est infinie, et un
 * squelette qui respire pour toujours est un spinner sans fin déguisé.
 *
 * La requête sous-jacente n'est pas annulée — les services ne l'exposent pas —
 * mais le drapeau `annule` de l'effet fait ignorer sa réponse tardive.
 */
const DELAI_CHARGEMENT_MS = 10_000;

/** Minuit local, décalé de `n` jours. */
function minuit(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

/** Le lundi de la semaine contenant `d`. La semaine française commence lundi. */
function lundiDe(d: Date): Date {
  const l = new Date(d);
  l.setHours(0, 0, 0, 0);
  // `getDay()` rend 0 pour dimanche : on le ramène à 7 pour que lundi soit 1.
  const jourSemaine = l.getDay() === 0 ? 7 : l.getDay();
  l.setDate(l.getDate() - (jourSemaine - 1));
  return l;
}

export default function PageAgenda(): React.JSX.Element {
  const {
    utilisateur,
    sessionTranchee,
    horsLigne: horsLigneSession,
    deconnecter,
  } = useSessionEcran();

  const [vue, setVue] = useState<Vue>("semaine");
  const [ancre, setAncre] = useState<Date>(() => lundiDe(new Date()));

  const [entrees, setEntrees] = useState<readonly AgendaEntry[] | undefined>(undefined);
  const [enAttente, setEnAttente] = useState<readonly AgendaEntry[]>([]);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [chargement, setChargement] = useState(true);

  /**
   * ⚠️ LA VUE « JOUR » SUIT L'ANCRE, ELLE N'EST PLUS FIGÉE SUR AUJOURD'HUI.
   *
   * La version précédente calculait `debut = minuit(0)` en vue jour : les
   * boutons « précédent / suivant » changeaient `ancre`, mais la grille restait
   * sur aujourd'hui. Un bouton qui ne fait rien est pire qu'un bouton absent.
   * L'ancre est désormais la seule source de la journée affichée ; le passage
   * semaine ↔ jour la normalise (lundi pour la semaine, jour courant pour le
   * jour) dans les deux commandes ci-dessous.
   */
  const debut = ancre;
  const nbJours = vue === "semaine" ? JOURS_SEMAINE : 1;
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + nbJours);

  const debutIso = debut.toISOString();
  const finIso = fin.toISOString();

  // Attend que la session soit tranchée avant d'interroger : la porte
  // journalise CHAQUE appel, et lancer la requête pour un visiteur qu'on est en
  // train de rediriger écrirait une ligne d'audit pour une consultation qui n'a
  // pas eu lieu.
  //
  // V1.5 — le garde est `sessionTranchee`, PAS `utilisateur` : c'est
  // `getSession()` qui tranche la session ; le profil (I12, navigation seule)
  // part maintenant en parallèle de cette lecture au lieu de la précéder.
  useEffect(() => {
    if (sessionTranchee !== true) return;
    let annule = false;
    setChargement(true);

    const minuteur = setTimeout(() => {
      if (annule) return;
      // Bascule en ERREUR « délai » : le squelette ne respire pas sans fin.
      setHorsLigne(false);
      setMessageErreur(fr.delaiDepasse);
      setEntrees(undefined);
      setChargement(false);
    }, DELAI_CHARGEMENT_MS);

    void listAgenda({ from: debutIso, to: finIso, statuts: STATUTS_AGENDA }).then((result) => {
      clearTimeout(minuteur);
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        setEntrees(undefined);
        setChargement(false);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      setEntrees(result.data);
      setChargement(false);
    });

    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [sessionTranchee, debutIso, finIso]);

  // La file d'attente d'approbation, sur une fenêtre volontairement plus large
  // que la grille : une demande pour dans trois semaines doit se voir
  // aujourd'hui, sinon elle est approuvée la veille.
  useEffect(() => {
    if (sessionTranchee !== true) return;
    let annule = false;
    void listAgenda({
      from: minuit(0).toISOString(),
      to: minuit(60).toISOString(),
      statuts: STATUTS_EN_ATTENTE,
    }).then((result) => {
      if (annule) return;
      // Un échec ici n'efface pas la grille et ne bloque rien : la file
      // d'attente est un complément, pas la raison d'être de l'écran (I20).
      if (result.ok) setEnAttente(result.data);
    });
    return () => {
      annule = true;
    };
  }, [sessionTranchee]);

  const decaler = useCallback((jours: number) => {
    setAncre((a) => {
      const d = new Date(a);
      d.setDate(d.getDate() + jours);
      return d;
    });
  }, []);

  // V1.5 — LA SESSION TRANCHÉE NÉGATIVEMENT A SA PROPRE SORTIE.
  //
  // Défaut trouvé et corrigé dans la session qui a introduit `sessionTranchee` :
  // le garde de RENDU ci-dessous teste `utilisateur === undefined`, alors que le
  // garde d'EFFET teste `sessionTranchee !== true`. Hors ligne, `getSession()`
  // échoue → `sessionTranchee = false` ET `utilisateur = null` : le rendu passait
  // le premier garde, l'effet ne partait jamais, et `chargement` restait à `true`.
  // Le squelette respirait alors SANS FIN — l'attente infinie que V1.5 supprime
  // (05-UX-CONTRACT.md §2). Motif repris de /finances et /consultation, qui
  // portaient déjà leur branche et n'ont donc jamais eu le défaut.
  //
  // ⚠️ La condition est `sessionTranchee === false`, PAS `utilisateur === null` :
  // les deux ne disent pas la même chose. Session lue mais PROFIL illisible
  // (`sessionTranchee === true`, `utilisateur === null`) doit continuer à
  // afficher l'agenda avec la navigation la plus étroite — c'est le « défaut
  // sûr » documenté plus bas, et le bloquer ici cacherait un écran qui marche.
  if (sessionTranchee === false) {
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

  if (utilisateur === undefined) {
    // V1.5 — squelette, pas un texte (05-UX-CONTRACT.md §2) : l'écran répond
    // avec la FORME de ce qui arrive (l'en-tête, puis la grille), pas avec un
    // mot d'attente qui sera remplacé par une mise en page entièrement
    // différente — c'est ce décalage-là qu'on paie au moment du clic.
    return (
      <main className="flex flex-col gap-8 p-8">
        <Squelette lignes={2} />
        <Squelette lignes={8} />
      </main>
    );
  }

  const liste = entrees ?? [];
  const pas = vue === "semaine" ? JOURS_SEMAINE : 1;
  const finSemaine = new Date(debut);
  finSemaine.setDate(finSemaine.getDate() + nbJours - 1);

  /**
   * ⚠️ LES TROIS TUILES DE LA SEMAINE ONT ÉTÉ RETIRÉES, ET CE N'EST PAS UN
   * APPAUVRISSEMENT.
   *
   * « Séances cette semaine » répétait la grille, « Demandes en attente »
   * répétait le titre de la file juste en dessous, et « Créneaux libres »
   * affichait 11 h × 7 j — la taille du cadre, pas une disponibilité du
   * cabinet. Aucune des trois ne portait une information que la grille ou la
   * file ne disait déjà. Le compteur de demandes vit maintenant dans le titre
   * de la file, à l'endroit où il déclenche l'action.
   */

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
      actions={
        <LienBouton href="/agenda/nouveau" rang="principal">
          {fr.agenda.nouveau}
        </LienBouton>
      }
    >
      {/* L'écran respire par blocs de `--s-8` : titre, barre de période, grille,
          file d'attente. C'est l'espace, pas des traits, qui sépare des sujets
          différents — un filet de plus sur un agenda déjà quadrillé ajoute une
          ligne à lire pour rien. */}
      <div className="flex min-w-0 flex-col gap-8">
        {/* ── Période, chiffres, navigation ──────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-ui text-heading font-bold tracking-heading text-ink-900">
              {vue === "semaine"
                ? `${fr.agenda.semaine.titre} ${jour(debut.toISOString()) ?? ""} ${fr.agenda.semaine.au} ${jour(finSemaine.toISOString()) ?? ""}`
                : jourComplet(debut.toISOString()) ?? fr.agenda.aujourdhui}
            </h2>

            {/* Naviguer dans le temps et changer d'échelle sont deux gestes
                différents : deux groupes, pas une file de cinq boutons où
                l'on vise au jugé. */}
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-full bg-sunken p-1">
                <BoutonPeriode
                  onClick={() => decaler(-pas)}
                  libelle={vue === "semaine" ? fr.agenda.semaine.semainePrecedente : fr.agenda.jourPrecedent}
                />
                <BoutonPeriode
                  onClick={() => setAncre(vue === "semaine" ? lundiDe(new Date()) : minuit(0))}
                  libelle={vue === "semaine" ? fr.agenda.semaine.cetteSemaine : fr.agenda.aujourdhui}
                />
                <BoutonPeriode
                  onClick={() => decaler(pas)}
                  libelle={vue === "semaine" ? fr.agenda.semaine.semaineSuivante : fr.agenda.jourSuivant}
                />
              </div>

              <div className="inline-flex items-center gap-1 rounded-full border border-rule bg-card p-1">
                <BoutonPeriode
                  onClick={() => {
                    setVue("semaine");
                    setAncre(lundiDe(ancre));
                  }}
                  libelle={fr.agenda.semaine.vueSemaine}
                  actif={vue === "semaine"}
                />
                <BoutonPeriode
                  onClick={() => {
                    setVue("jour");
                    setAncre(minuit(0));
                  }}
                  libelle={fr.agenda.semaine.vueJour}
                  actif={vue === "jour"}
                />
              </div>
            </div>
          </div>
        </div>

        {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}
        {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

        {/* Le squelette occupe la place de la grille : le contenu, en arrivant,
            ne décale rien — et c'est exactement l'instant où l'on clique. */}
        {chargement ? <Squelette lignes={8} /> : null}

        {!chargement && entrees !== undefined ? (
          <div className="flex min-w-0 flex-col gap-3">
            {/* La file d'attente est AU-DESSUS de la grille. C'était le défaut
                de composition le plus coûteux : une demande web attendait en
                bas d'un écran qui défile, sous 11 heures de grille vide. */}
            {enAttente.length > 0 ? (
              <section
                aria-label={fr.agenda.semaine.demandesEnAttente}
                className="rounded-xl border border-attention bg-attention-bg p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-ui text-body font-semibold text-ink-900">
                    {fr.agenda.semaine.demandesEnAttente}
                  </h3>
                  <span className="rounded-full bg-card px-2 py-0.5 font-num text-label font-semibold tabular-nums text-attention-ink">
                    {enAttente.length}
                  </span>
                  <p className="m-0 ms-auto font-ui text-label text-attention-ink">
                    {fr.agenda.semaine.demandesAide}
                  </p>
                </div>
                <ul className="m-0 mt-2 grid list-none gap-1.5 p-0 tablet:grid-cols-2">
                  {enAttente.map((entree) => (
                    <li key={entree.id}>
                      <Link
                        href={`/agenda/${entree.id}`}
                        className={[
                          "flex min-h-target-lg items-center gap-3 rounded-lg border border-rule bg-card px-3 py-2",
                          "text-ink-900 no-underline transition duration-quick ease-soft",
                          "hover:border-attention hover:shadow-lift1",
                          "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                        ].join(" ")}
                      >
                        <span className="min-w-target font-num text-num font-medium tabular-nums text-ink-700">
                          {heure(entree.startsAt) ?? fr.etats.texteAbsent}
                        </span>
                        <span className="min-w-0 flex-auto">
                          <span className="block truncate font-ui text-body font-medium text-ink-900">
                            {nomPatient(entree.lastName, entree.firstName) ?? fr.agenda.patientNonRattache}
                          </span>
                          <span className="block truncate font-ui text-label text-ink-500">
                            {jour(entree.startsAt) ?? fr.etats.texteAbsent}
                            {entree.phone !== null ? ` · ${entree.phone}` : null}
                          </span>
                        </span>
                        <Statut statut={entree.status} />
                        <span className="shrink-0 font-ui text-label font-semibold text-action-700">
                          {fr.agenda.semaine.traiter}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Une phrase, pas un bloc de 300 px : la grille reste le sujet. */}
            {liste.length === 0 ? (
              <p className="m-0 rounded-lg bg-sunken px-3 py-2 font-ui text-body text-ink-500">
                {vue === "semaine" ? fr.agenda.semaine.semaineVide : fr.agenda.journeeVide}
              </p>
            ) : null}

            <GrilleSemaine
              debutSemaine={debut}
              jours={nbJours}
              heureDebut={HEURE_DEBUT}
              heureFin={HEURE_FIN}
              entrees={liste}
            />
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function BoutonPeriode({
  onClick,
  libelle,
  actif = false,
}: {
  readonly onClick: () => void;
  readonly libelle: string;
  readonly actif?: boolean;
}): React.JSX.Element {
  /**
   * ⚠️ PAS DE `Bouton` ICI, ET CE N'EST PAS UN DÉTAIL.
   *
   * `Bouton` est la primitive d'ACTION : elle ancre une flèche qui entre au
   * survol, parce qu'un geste qui modifie quelque chose mérite sa
   * chorégraphie. Sept commandes de période et de vue rendaient donc sept
   * flèches collées aux libellés — « Semaine précédente→ » — et l'œil lisait
   * une file de liens au lieu d'un sélecteur. Ce sont des choix de vue, pas
   * des actions : le contrôle segmenté les porte mieux, sans flèche.
   */
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={[
        "inline-flex min-h-target items-center justify-center rounded-full px-3 py-1.5 font-ui text-label font-medium",
        "transition duration-quick ease-out outline-none",
        "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
        actif
          ? "bg-action-600 text-on-brand shadow-douce"
          : "bg-transparent text-ink-700 hover:bg-card hover:text-ink-900",
      ].join(" ")}
    >
      {libelle}
    </button>
  );
}
