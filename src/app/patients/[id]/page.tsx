/**
 * Fiche patient.
 *
 * ⚠️ INTROUVABLE ET HORS PÉRIMÈTRE SONT INDISCERNABLES, ET C'EST LE POINT LE
 * PLUS IMPORTANT DE CET ÉCRAN.
 *
 * `app.get_patient` rend zéro ligne dans les deux cas, et `getPatient` rend
 * `ok(null)` sans distinguer lequel (`patients.ts`). L'interface ne doit pas
 * distinguer non plus : afficher « ce dossier ne vous est pas accessible »
 * confirmerait à une praticienne l'EXISTENCE d'un dossier chez sa consœur —
 * une fuite d'information par le message d'erreur, sans qu'aucune donnée n'ait
 * été lue. Un seul message, `fr.patients.ficheIntrouvable`, pour les deux
 * situations. Ne jamais « améliorer » ce comportement.
 *
 * I4 — LA LECTURE EST JOURNALISÉE PAR LA BASE. `app.get_patient` écrit dans
 * `audit.log` AVANT de retourner, dans la même transaction, y compris quand la
 * RLS ne rend rien : la TENTATIVE d'ouverture est tracée. Cet écran n'a rien à
 * journaliser lui-même, et ne doit surtout pas essayer — le journal applicatif
 * n'est pas l'audit légal.
 *
 * Aucune donnée clinique ici : le dossier médical n'est pas encore construit.
 * Ce qui s'affiche est l'identité et l'administratif, et rien ne bouge (§4
 * règle 5) ni ne porte de verre (§4 règle 2).
 */

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { fr } from "@/i18n/fr";
import { getSession, signOut } from "@/services/auth";
import { getCurrentUser, type CurrentUser } from "@/services/authz";
import { getPatient, type Patient } from "@/services/patients";

function Champ({ libelle, valeur }: { libelle: string; valeur: string | null }): React.JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
      <span
        style={{
          fontSize: "var(--text-label-size)",
          lineHeight: "var(--text-label-leading)",
          letterSpacing: "var(--text-label-tracking)",
          fontWeight: "var(--weight-medium)",
          color: "var(--ink-500)",
        }}
      >
        {libelle}
      </span>
      {/* Champ non renseigné : une PHRASE, jamais un tiret nu — un tiret se
          confond avec une valeur, et sur un numéro de téléphone la confusion
          se paie au moment où on cherche à joindre quelqu'un. */}
      <span
        style={{
          fontSize: "var(--text-body-size)",
          lineHeight: "var(--text-body-leading)",
          color: valeur === null || valeur === "" ? "var(--ink-300)" : "var(--ink-900)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {valeur === null || valeur === "" ? fr.etats.texteAbsent : valeur}
      </span>
    </div>
  );
}

export default function PageFichePatient(): React.JSX.Element {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  const [patient, setPatient] = useState<Patient | null | undefined>(undefined);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);

  // ⚠️ « ÉCHEC DE LECTURE DE LA SESSION » N'EST PAS « AUCUNE SESSION » — voir
  // le commentaire détaillé dans `src/app/patients/page.tsx`. Hors ligne, le
  // rafraîchissement de jeton échoue ; rediriger là-dessus éjecterait la
  // praticienne de la fiche qu'elle est en train de lire (I20).
  useEffect(() => {
    let annule = false;
    void getSession().then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setUtilisateur(null);
        return;
      }
      if (result.data === null) {
        router.replace("/connexion");
        return;
      }
      void getCurrentUser().then((profil) => {
        if (annule) return;
        setUtilisateur(profil.ok ? profil.data : null);
      });
    });
    return () => {
      annule = true;
    };
  }, [router]);

  useEffect(() => {
    let annule = false;
    void getPatient(id).then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        setPatient(null);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      setPatient(result.data);
    });
    return () => {
      annule = true;
    };
  }, [id]);


  // Fermeture de session depuis l'interface. `replace` et pas `push` : le
  // bouton Retour ne doit pas ramener sur un écran de dossiers après une
  // déconnexion volontaire, sur un poste que le patient suivant voit.
  function deconnecter(): void {
    void signOut().then(() => {
      router.replace("/connexion");
    });
  }

  if (utilisateur === undefined) {
    return (
      <main style={{ padding: "var(--s-8)", fontFamily: "var(--font-ui)", color: "var(--ink-500)" }}>
        {fr.etats.chargement}
      </main>
    );
  }

  const retour = (
    <Link
      href="/patients"
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: "var(--target-min)",
        color: "var(--teal-600)",
        fontSize: "var(--text-body-size)",
        lineHeight: "var(--text-body-leading)",
      }}
    >
      {fr.patients.retourALaListe}
    </Link>
  );

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
    >
      {retour}

      {horsLigne ? (
        <p role="status" style={{ margin: "var(--s-4) var(--size-0)", padding: "var(--s-3) var(--s-4)", borderRadius: "var(--r-md)", background: "var(--sunken)", color: "var(--ink-700)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.etats.horsLigne}
        </p>
      ) : null}

      {messageErreur !== undefined && !horsLigne ? (
        <div role="alert" style={{ margin: "var(--s-4) var(--size-0)", padding: "var(--s-3) var(--s-4)", borderRadius: "var(--r-md)", background: "var(--attention-bg)", color: "var(--ink-700)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          <strong style={{ display: "block", color: "var(--attention)", fontSize: "var(--text-label-size)", lineHeight: "var(--text-label-leading)", letterSpacing: "var(--text-label-tracking)" }}>
            {fr.erreur.titre}
          </strong>
          {messageErreur}
        </div>
      ) : null}

      {patient === undefined && messageErreur === undefined ? (
        <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.etats.chargement}
        </p>
      ) : null}

      {patient === null && messageErreur === undefined ? (
        /* Dossier inexistant OU hors périmètre — un seul message, voir l'en-tête. */
        <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.patients.ficheIntrouvable}
        </p>
      ) : null}

      {patient !== null && patient !== undefined ? (
        <article style={{ marginTop: "var(--s-6)", display: "flex", flexDirection: "column", gap: "var(--s-6)" }}>
          <header style={{ display: "flex", alignItems: "center", gap: "var(--s-4)" }}>
            <span
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: "var(--target-comfort)",
                minHeight: "var(--target-comfort)",
                borderRadius: "var(--r-full)",
                background: "var(--teal-100)",
                color: "var(--teal-900)",
                fontSize: "var(--text-body-size)",
                fontWeight: "var(--weight-semibold)",
              }}
            >
              {`${patient.firstName.charAt(0)}${patient.lastName.charAt(0)}`.toUpperCase()}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
              <h1
                style={{
                  margin: "var(--size-0)",
                  fontSize: "var(--text-display-size)",
                  lineHeight: "var(--text-display-leading)",
                  letterSpacing: "var(--text-display-tracking)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--ink-900)",
                }}
              >
                {patient.lastName} {patient.firstName}
              </h1>
              {/* Statut porté par un TEXTE, jamais par la couleur seule (§4.4).
                  `--attention` et pas `--critical` : un dossier inactif n'est
                  ni une perte de données ni un disque saturé (§4.1). */}
              {!patient.isActive ? (
                <span
                  style={{
                    alignSelf: "flex-start",
                    padding: "var(--s-1) var(--s-3)",
                    borderRadius: "var(--r-full)",
                    background: "var(--attention-bg)",
                    color: "var(--attention)",
                    fontSize: "var(--text-label-size)",
                    lineHeight: "var(--text-label-leading)",
                    fontWeight: "var(--weight-medium)",
                  }}
                >
                  {fr.patients.dossierInactif}
                </span>
              ) : null}
            </div>
          </header>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(var(--card-column-min), 1fr))",
              gap: "var(--s-6)",
              padding: "var(--s-6)",
              borderRadius: "var(--r-lg)",
              border: "var(--rule-width) solid var(--rule)",
              background: "var(--card)",
            }}
          >
            <Champ libelle={fr.patients.numeroDossier} valeur={patient.recordNumber} />
            <Champ libelle={fr.patients.dateNaissance} valeur={patient.birthDate} />
            <Champ libelle={fr.patients.telephone} valeur={patient.phone} />
            <Champ libelle={fr.patients.telephoneSecondaire} valeur={patient.phoneAlt} />
            <Champ libelle={fr.patients.adresse} valeur={patient.address} />
            <Champ libelle={fr.patients.notesAdministratives} valeur={patient.notesAdmin} />
          </div>
        </article>
      ) : null}
    </AppShell>
  );
}
