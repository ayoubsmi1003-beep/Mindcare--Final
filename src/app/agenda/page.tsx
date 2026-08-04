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
import { BandeauHorsLigne, BlocErreur } from "@/components/EtatsEcran";
import { GrilleSemaine, repartition } from "@/components/GrilleSemaine";
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
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

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
  useEffect(() => {
    if (utilisateur === undefined) return;
    let annule = false;
    setChargement(true);

    void listAgenda({ from: debutIso, to: finIso, statuts: STATUTS_AGENDA }).then((result) => {
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
    };
  }, [utilisateur, debutIso, finIso]);

  // La file d'attente d'approbation, sur une fenêtre volontairement plus large
  // que la grille : une demande pour dans trois semaines doit se voir
  // aujourd'hui, sinon elle est approuvée la veille.
  useEffect(() => {
    if (utilisateur === undefined) return;
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
  }, [utilisateur]);

  const decaler = useCallback((jours: number) => {
    setAncre((a) => {
      const d = new Date(a);
      d.setDate(d.getDate() + jours);
      return d;
    });
  }, []);

  if (utilisateur === undefined) {
    return (
      <main style={{ padding: "var(--s-8)", fontFamily: "var(--font-ui)", color: "var(--ink-500)" }}>
        {fr.etats.chargement}
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
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
        <h1
          style={{
            fontSize: "var(--text-display-size)",
            lineHeight: "var(--text-display-leading)",
            letterSpacing: "var(--text-display-tracking)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--ink-900)",
            margin: "var(--size-0)",
          }}
        >
          {fr.agenda.titre}
        </h1>
        <p
          style={{
            margin: "var(--size-0)",
            color: "var(--ink-500)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
          }}
        >
          {jourComplet(new Date().toISOString()) ?? fr.etats.texteAbsent}
        </p>
      </header>

      {/* ── Barre de période, chiffres et action ──────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--s-4)",
          flexWrap: "wrap",
          marginTop: "var(--s-6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-4)", flexWrap: "wrap" }}>
          <h2
            style={{
              margin: "var(--size-0)",
              fontSize: "var(--text-title-size)",
              lineHeight: "var(--text-title-leading)",
              letterSpacing: "var(--text-title-tracking)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--ink-900)",
            }}
          >
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

        <Link
          href="/agenda/nouveau"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: "var(--target-min)",
            padding: "var(--s-2) var(--s-5)",
            borderRadius: "var(--r-md)",
            background: "var(--teal-600)",
            color: "var(--card)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
            fontWeight: "var(--weight-semibold)",
            textDecoration: "none",
          }}
        >
          {fr.agenda.nouveau}
        </Link>
      </div>

      {/* ── Navigation de période ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap", marginTop: "var(--s-4)" }}>
        <BoutonPeriode onClick={() => decaler(-JOURS_SEMAINE)} libelle={fr.agenda.semaine.semainePrecedente} />
        <BoutonPeriode onClick={() => setAncre(lundiDe(new Date()))} libelle={fr.agenda.semaine.cetteSemaine} />
        <BoutonPeriode onClick={() => decaler(JOURS_SEMAINE)} libelle={fr.agenda.semaine.semaineSuivante} />

        <span style={{ display: "inline-flex", gap: "var(--s-1)", marginLeft: "var(--s-4)" }}>
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
        </span>
      </div>

      {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}
      {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

      {chargement ? (
        <p style={{ marginTop: "var(--s-6)", color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.etats.chargement}
        </p>
      ) : null}

      {!chargement && entrees !== undefined ? (
        <div style={{ marginTop: "var(--s-6)" }}>
          {liste.length === 0 ? (
            /* État vide : une phrase --ink-500, aucune illustration (§4 règle 7).
               La phrase dit « rien de VISIBLE par vous », jamais « rien ». */
            <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
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

      {/* ── Demandes en attente d'approbation ─────────────────────────────── */}
      <section style={{ marginTop: "var(--s-10)" }}>
        <h2
          style={{
            margin: "var(--size-0)",
            fontSize: "var(--text-heading-size)",
            lineHeight: "var(--text-heading-leading)",
            letterSpacing: "var(--text-heading-tracking)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--ink-900)",
          }}
        >
          {fr.agenda.semaine.demandesEnAttente}
        </h2>

        {enAttente.length === 0 ? (
          <p style={{ marginTop: "var(--s-3)", color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
            {fr.agenda.semaine.aucuneDemande}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: "var(--s-4) var(--size-0)", padding: "var(--size-0)", display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
            {enAttente.map((entree) => (
              <li key={entree.id}>
                <Link
                  href={`/agenda/${entree.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--s-4)",
                    minHeight: "var(--target-comfort)",
                    padding: "var(--s-3) var(--s-4)",
                    borderRadius: "var(--r-md)",
                    border: "var(--rule-width) solid var(--attention)",
                    background: "var(--attention-bg)",
                    color: "var(--ink-900)",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums", minWidth: "var(--target-comfort)" }}>
                    {heure(entree.startsAt) ?? fr.etats.texteAbsent}
                  </span>
                  <span style={{ flex: "1 1 auto", minWidth: "var(--size-0)", overflowWrap: "anywhere" }}>
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
      </section>
    </AppShell>
  );
}

/**
 * Un chiffre d'en-tête. `tabular-nums` obligatoire : ces valeurs changent à
 * chaque navigation, et sans chasse fixe elles sautillent d'un pixel à l'autre,
 * ce qui attire l'œil sur du bruit.
 */
function Chiffre({
  valeur,
  libelle,
  attention = false,
}: {
  readonly valeur: number;
  readonly libelle: string;
  readonly attention?: boolean;
}): React.JSX.Element {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "var(--s-2)",
        padding: "var(--s-2) var(--s-4)",
        borderRadius: "var(--r-full)",
        border: "var(--rule-width) solid var(--rule)",
        background: attention ? "var(--attention-bg)" : "var(--card)",
      }}
    >
      <strong
        style={{
          fontFamily: "var(--font-num)",
          fontVariantNumeric: "tabular-nums",
          fontSize: "var(--text-body-size)",
          fontWeight: "var(--weight-semibold)",
          color: attention ? "var(--attention)" : "var(--teal-700)",
        }}
      >
        {valeur}
      </strong>
      <span
        style={{
          fontSize: "var(--text-label-size)",
          lineHeight: "var(--text-label-leading)",
          color: "var(--ink-500)",
        }}
      >
        {libelle}
      </span>
    </span>
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
      style={{
        minHeight: "var(--target-min)",
        padding: "var(--s-2) var(--s-4)",
        borderRadius: "var(--r-md)",
        border: "var(--rule-width) solid var(--rule)",
        background: actif ? "var(--teal-600)" : "var(--card)",
        color: actif ? "var(--card)" : "var(--ink-700)",
        fontSize: "var(--text-label-size)",
        lineHeight: "var(--text-label-leading)",
        fontFamily: "var(--font-ui)",
        fontWeight: actif ? "var(--weight-semibold)" : "var(--weight-regular)",
        cursor: "pointer",
      }}
    >
      {libelle}
    </button>
  );
}
