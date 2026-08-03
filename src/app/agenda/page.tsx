/**
 * Agenda — la journée, puis ce qui vient.
 *
 * ⚠️ TROIS PIÈGES DE PÉRIMÈTRE, TOUS PORTÉS PAR LA BASE, TOUS À RESPECTER ICI.
 *
 * 1. ZÉRO LIGNE N'EST PAS ZÉRO RENDEZ-VOUS. `app.list_agenda` applique la RLS
 *    de 006 : une journée vide signifie « rien de VISIBLE par vous ». L'écran ne
 *    dit donc jamais « le cabinet n'a aucun rendez-vous » — l'agenda de l'autre
 *    praticienne existe peut-être, et c'est la cloison ADR-003 qui le masque.
 *
 * 2. UN RENDEZ-VOUS PEUT N'AVOIR AUCUN NOM, ET IL FAUT QUAND MÊME L'AFFICHER.
 *    La porte joint `app.patients` en LEFT JOIN : dossier hors périmètre ou
 *    demande web non validée rendent une ligne sans identité. La masquer
 *    cacherait une HEURE OCCUPÉE, donc produirait un double booking.
 *
 * 3. LA PLAGE EST BORNÉE EN BASE — 62 jours. Ce n'est pas une pagination
 *    d'affichage : une plage que l'écran choisirait sans limite serait un export
 *    de la base patients par la porte de service.
 *
 * I4 — LA LECTURE EST JOURNALISÉE PAR LA BASE, UNE FOIS PAR AFFICHAGE, en
 * contexte `liste`. Cet écran n'a rien à journaliser lui-même et ne doit pas
 * essayer : le journal applicatif n'est pas l'audit légal.
 *
 * AUCUNE DÉCISION D'AUTORISATION ICI. Pas un seul `if (role === …)`. Le rôle ne
 * sert qu'à composer la navigation (I12).
 *
 * LE MOTIF DE CONSULTATION N'APPARAÎT NULLE PART, et n'apparaîtra pas : il vit
 * dans `app.appointment_reasons`, sans policy assistante (ADR-017).
 */

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { heure, jour, nomPatient, Statut } from "@/components/AgendaPieces";
import { BandeauHorsLigne, BlocErreur } from "@/components/EtatsEcran";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import { listAgenda, type AgendaEntry } from "@/services/appointments";

/** Minuit local du jour donné. La base compare des instants absolus (I8). */
function minuit(decalageJours: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + decalageJours);
  return d;
}

export default function PageAgenda(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [entrees, setEntrees] = useState<readonly AgendaEntry[] | undefined>(undefined);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [chargement, setChargement] = useState(true);

  // Attend que la session soit tranchée avant d'interroger : la porte
  // journalise CHAQUE appel, et lancer la requête pour un visiteur qu'on est en
  // train de rediriger écrirait une ligne d'audit pour une consultation qui n'a
  // pas eu lieu.
  useEffect(() => {
    if (utilisateur === undefined) return;
    let annule = false;
    setChargement(true);

    // 30 jours : bien en deçà de la borne de 62 imposée en base. Un agenda
    // regarde la semaine qui vient, pas le trimestre.
    void listAgenda({
      from: minuit(0).toISOString(),
      to: minuit(30).toISOString(),
    }).then((result) => {
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
  }, [utilisateur]);

  if (utilisateur === undefined) {
    return (
      <main style={{ padding: "var(--s-8)", fontFamily: "var(--font-ui)", color: "var(--ink-500)" }}>
        {fr.etats.chargement}
      </main>
    );
  }

  const finDuJour = minuit(1).getTime();
  const aujourdhui = (entrees ?? []).filter((e) => Date.parse(e.startsAt) < finDuJour);
  const aVenir = (entrees ?? []).filter((e) => Date.parse(e.startsAt) >= finDuJour);

  return (
    /* DÉFAUT SÛR sur la composition : profil illisible → navigation la plus
       étroite (`assistant`). Ce n'est pas une protection — la RLS décide seule
       de ce qui est lisible — mais entre deux compositions, afficher la plus
       restreinte quand on ne sait pas qui est connecté coûte le moins cher. */
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--s-4)",
          flexWrap: "wrap",
        }}
      >
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

      {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}
      {messageErreur !== undefined && !horsLigne ? <BlocErreur message={messageErreur} /> : null}

      {chargement ? (
        <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.etats.chargement}
        </p>
      ) : null}

      {!chargement && entrees !== undefined ? (
        <>
          <Section
            titre={fr.agenda.aujourdhui}
            entrees={aujourdhui}
            /* Deux phrases distinctes, et il ne faut pas les fusionner :
               « rien aujourd'hui » et « rien de visible » ne disent pas la même
               chose. Si l'agenda ENTIER est vide, on ne peut pas affirmer que la
               journée l'est — la RLS a pu tout filtrer. */
            vide={entrees.length === 0 ? fr.agenda.aucunVisible : fr.agenda.journeeVide}
          />
          <Section titre={fr.agenda.aVenir} entrees={aVenir} vide={fr.agenda.aucunAVenir} />
        </>
      ) : null}
    </AppShell>
  );
}

function Section({
  titre,
  entrees,
  vide,
}: {
  readonly titre: string;
  readonly entrees: readonly AgendaEntry[];
  readonly vide: string;
}): React.JSX.Element {
  return (
    <section style={{ marginTop: "var(--s-8)" }}>
      <h2
        style={{
          fontSize: "var(--text-title-size)",
          lineHeight: "var(--text-title-leading)",
          letterSpacing: "var(--text-title-tracking)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--ink-900)",
          margin: "var(--size-0)",
        }}
      >
        {titre}
      </h2>

      {entrees.length === 0 ? (
        /* État vide : une phrase --ink-500, aucune illustration (§4 règle 7). */
        <p
          style={{
            marginTop: "var(--s-3)",
            color: "var(--ink-500)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
          }}
        >
          {vide}
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: "var(--s-4) var(--size-0)",
            padding: "var(--size-0)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-2)",
          }}
        >
          {entrees.map((entree) => (
            <li key={entree.id}>
              <LigneRendezVous entree={entree} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LigneRendezVous({ entree }: { readonly entree: AgendaEntry }): React.JSX.Element {
  const debut = heure(entree.startsAt);
  const date = jour(entree.startsAt);
  const nom = nomPatient(entree.lastName, entree.firstName);

  return (
    <Link
      href={`/agenda/${entree.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s-4)",
        minHeight: "var(--target-comfort)",
        padding: "var(--s-3) var(--s-4)",
        borderRadius: "var(--r-md)",
        border: "var(--rule-width) solid var(--rule)",
        background: "var(--card)",
        color: "var(--ink-900)",
        textDecoration: "none",
      }}
    >
      {/* L'HEURE NE BOUGE PAS et se lit en un coup d'œil (§4 règle 5, et la
          deuxième question du TEST de CLAUDE.md). `tabular-nums` est obligatoire
          sur un chiffre : sans lui, les colonnes d'heures ne s'alignent pas. */}
      <span
        style={{
          minWidth: "var(--target-comfort)",
          fontSize: "var(--text-num-size)",
          lineHeight: "var(--text-num-leading)",
          fontWeight: "var(--weight-medium)",
          fontFamily: "var(--font-num)",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink-900)",
        }}
      >
        {debut ?? fr.etats.texteAbsent}
      </span>

      <span style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)", flex: "1 1 auto", minWidth: "var(--size-0)" }}>
        <span
          style={{
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
            fontWeight: "var(--weight-medium)",
            color: nom === null ? "var(--ink-300)" : "var(--ink-900)",
            overflowWrap: "anywhere",
          }}
        >
          {/* Aucun dossier rattaché : on le DIT. Laisser la ligne sans nom ferait
              croire à un défaut d'affichage, et la praticienne chercherait un
              patient qui n'existe pas dans son périmètre. */}
          {nom ?? fr.agenda.patientNonRattache}
        </span>
        <span
          style={{
            color: "var(--ink-500)",
            fontSize: "var(--text-label-size)",
            lineHeight: "var(--text-label-leading)",
            fontVariantNumeric: "tabular-nums",
            overflowWrap: "anywhere",
          }}
        >
          {date ?? fr.etats.texteAbsent} · {entree.durationMinutes} {fr.agenda.dureeUnite}
          {entree.practitionerName === null ? "" : ` · ${entree.practitionerName}`}
        </span>
      </span>

      <Statut statut={entree.status} />
    </Link>
  );
}
