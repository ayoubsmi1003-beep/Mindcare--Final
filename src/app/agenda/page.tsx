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
import { GrilleSemaine, repartition } from "@/components/GrilleSemaine";
import {
  BandeauHorsLigne,
  BlocErreur,
  Chiffre,
  EtatVide,
  LienBouton,
  Section,
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

  const debut = vue === "semaine" ? ancre : minuit(0);
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
  const finSemaine = new Date(debut);
  finSemaine.setDate(finSemaine.getDate() + nbJours - 1);

  // Les compteurs sortent de la MÊME fonction que la grille.
  //
  // Ils étaient calculés à part : « séances » comptait la liste brute et les
  // créneaux se basaient sur une plage horaire figée. L'écran annonçait donc
  // six séances au-dessus d'une grille qui en montrait quatre, et un commentaire
  // affirmait juste au-dessus que ce chiffre était « ce que la grille montre
  // réellement ». Une garantie fausse en commentaire est ce qui empêche le
  // relecteur suivant de regarder — la garantie tient maintenant parce qu'une
  // seule fonction produit les deux.
  const { lignesHeures, parCase, placees } = repartition(
    liste,
    debut,
    nbJours,
    HEURE_DEBUT,
    HEURE_FIN,
  );
  const creneauxTotal = lignesHeures.length * nbJours;
  const creneauxOccupes = parCase.size;

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
      sousTitre={jourComplet(new Date().toISOString()) ?? fr.etats.texteAbsent}
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
      <div className="flex flex-col gap-8">
        {/* ── Période, chiffres, navigation ──────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <h2 className="font-ui text-title font-semibold text-ink-900">
              {vue === "semaine"
                ? `${fr.agenda.semaine.titre} ${jour(debut.toISOString()) ?? ""} ${fr.agenda.semaine.au} ${jour(finSemaine.toISOString()) ?? ""}`
                : fr.agenda.aujourdhui}
            </h2>

            <Chiffre valeur={placees.length} libelle={fr.agenda.semaine.seancesCetteSemaine} />
            <Chiffre
              valeur={Math.max(0, creneauxTotal - creneauxOccupes)}
              libelle={fr.agenda.semaine.creneauxLibres}
            />
            <Chiffre
              valeur={enAttente.length}
              libelle={fr.agenda.semaine.demandesEnAttente}
              attention={enAttente.length > 0}
            />
          </div>

          {/* Naviguer dans le temps et changer d'échelle sont deux gestes
              différents : ils sont donc dans deux groupes séparés, et non dans
              une file de cinq boutons identiques où l'on vise au jugé. */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <BoutonPeriode onClick={() => decaler(-JOURS_SEMAINE)} libelle={fr.agenda.semaine.semainePrecedente} />
              <BoutonPeriode onClick={() => setAncre(lundiDe(new Date()))} libelle={fr.agenda.semaine.cetteSemaine} />
              <BoutonPeriode onClick={() => decaler(JOURS_SEMAINE)} libelle={fr.agenda.semaine.semaineSuivante} />
            </div>

            <div className="inline-flex gap-1 rounded-md border border-rule bg-sunken p-1">
              <BoutonPeriode
                onClick={() => setVue("semaine")}
                libelle={fr.agenda.semaine.vueSemaine}
                actif={vue === "semaine"}
              />
              <BoutonPeriode
                onClick={() => setVue("jour")}
                libelle={fr.agenda.semaine.vueJour}
                actif={vue === "jour"}
              />
            </div>
          </div>
        </div>

        {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}
        {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

        {/* Le squelette occupe la place de la grille : le contenu, en arrivant,
            ne décale rien — et c'est exactement l'instant où l'on clique. */}
        {chargement ? <Squelette lignes={8} /> : null}

        {!chargement && entrees !== undefined ? (
          <div>
            {liste.length === 0 ? (
              /* État vide : une phrase --ink-500, aucune illustration (§4 règle 7).
                 La phrase dit « rien de VISIBLE par vous », jamais « rien ». */
              <EtatVide
                message={vue === "semaine" ? fr.agenda.semaine.semaineVide : fr.agenda.journeeVide}
                icone="agenda"
                action={
                  <LienBouton href="/agenda/nouveau" rang="principal">
                    {fr.agenda.nouveau}
                  </LienBouton>
                }
              />
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

        {/* ── Demandes en attente d'approbation ───────────────────────────── */}
        <Section titre={fr.agenda.semaine.demandesEnAttente}>
          {enAttente.length === 0 ? (
            <EtatVide message={fr.agenda.semaine.aucuneDemande} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {enAttente.map((entree) => (
                <li key={entree.id}>
                  <Link
                    href={`/agenda/${entree.id}`}
                    className={[
                      "flex min-h-target-lg items-center gap-4 rounded-md border px-4 py-3",
                      // Ton `attention` : ces lignes attendent un geste. Jamais
                      // `critical` — rien n'est perdu (§4 règle 1).
                      "border-attention bg-attention-bg text-ink-900 no-underline",
                      "transition duration-quick ease-soft hover:shadow-lift2",
                      "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                    ].join(" ")}
                  >
                    <span className="min-w-target font-num text-num font-medium tabular-nums text-ink-700">
                      {heure(entree.startsAt) ?? fr.etats.texteAbsent}
                    </span>
                    <span className="min-w-0 flex-auto font-ui text-body break-words">
                      {nomPatient(entree.lastName, entree.firstName) ?? fr.agenda.patientNonRattache}
                      {" · "}
                      {jour(entree.startsAt) ?? fr.etats.texteAbsent}
                    </span>
                    <Statut statut={entree.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
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
  return (
    <button
      type="button"
      onClick={onClick}
      /* L'état sélectionné est porté par `aria-pressed` ET par le contraste,
         jamais par la seule couleur (§4 règle 4). */
      aria-pressed={actif}
      className={[
        "min-h-target cursor-pointer rounded-md border px-4 py-2",
        "font-ui text-label",
        "transition duration-quick ease-soft",
        "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
        actif
          ? // Sélectionné : fond plein et graisse. Deux signaux, pas un.
            "border-brand-600 bg-brand-600 font-semibold text-paper shadow-lift1"
          : "border-rule bg-card font-regular text-ink-700 hover:border-ink-300 hover:bg-sunken",
      ].join(" ")}
    >
      {libelle}
    </button>
  );
}
