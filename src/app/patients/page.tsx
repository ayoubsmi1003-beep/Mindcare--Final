/**
 * Liste Patients — recherche et accès aux fiches.
 *
 * ⚠️ TROIS PIÈGES DE PÉRIMÈTRE, TOUS PORTÉS PAR LA BASE, TOUS À RESPECTER ICI.
 *
 * 1. ZÉRO LIGNE N'EST PAS ZÉRO PATIENT. `app.search_patients` applique la RLS
 *    avant de compter : une liste vide signifie « rien de VISIBLE par vous ».
 *    L'écran ne dit donc jamais « aucun patient » — il dit « aucun dossier
 *    visible dans votre périmètre ». La nuance n'est pas de la prudence
 *    rhétorique : affirmer que le cabinet est vide alors que la file d'une
 *    autre praticienne existe serait faux, et le croire conduirait à recréer
 *    un dossier déjà présent.
 *
 * 2. `total` EST LE TOTAL DU PÉRIMÈTRE DE L'APPELANT, pas celui de la table.
 *    C'est délibéré (`result.ts`) : un total global divulguerait la taille de
 *    la file de l'autre praticienne sans en montrer une seule ligne.
 *
 * 3. LA PAGINATION EST UN PARAMÈTRE, PAS UN FILTRE. `p_limit` est borné à 100
 *    EN BASE. Une pagination que l'appelant choisit sans limite n'est pas une
 *    pagination, c'est un export.
 *
 * `search_patients` ne rend que les dossiers `is_active`. L'écran le DIT
 * (`listeActifsSeulement`) au lieu de laisser croire qu'il montre tout.
 *
 * AUCUNE DÉCISION D'AUTORISATION ICI. Pas un seul `if (role === …)`. Le rôle ne
 * sert qu'à composer la navigation (I12) ; ce qui est lisible est décidé par la
 * RLS, et chaque lecture est journalisée par la porte `app.search_patients`
 * elle-même (I4, ADR-019).
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { fr } from "@/i18n/fr";
import { getSession, signOut } from "@/services/auth";
import { getCurrentUser, type CurrentUser } from "@/services/authz";
import { searchPatients, type PatientListItem } from "@/services/patients";
import type { Page } from "@/services/result";

/** Monogramme — jamais de photo (§4 règle 6). */
function monogramme(prenom: string, nom: string): string {
  const initiales = `${prenom.trim().charAt(0)}${nom.trim().charAt(0)}`.toUpperCase();
  return initiales.trim() === "" ? "?" : initiales;
}

export default function PagePatients(): React.JSX.Element {
  const router = useRouter();
  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  const [saisie, setSaisie] = useState("");
  const [requete, setRequete] = useState("");
  const [page, setPage] = useState<Page<PatientListItem> | undefined>(undefined);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [chargement, setChargement] = useState(true);

  // Sans session, `auth.uid()` est NULL et la RLS ne rend rien : la liste
  // serait vide SANS AUCUN MESSAGE, ce qui se diagnostique très mal. On
  // renvoie donc explicitement vers la connexion.
  //
  // ⚠️ « ÉCHEC DE LECTURE DE LA SESSION » N'EST PAS « AUCUNE SESSION ».
  // `getSession()` déclenche un rafraîchissement de jeton quand il approche de
  // l'expiration ; hors ligne, ce rafraîchissement échoue et rend une erreur.
  // Une version antérieure redirigeait sur `!result.ok`, donc ÉJECTAIT la
  // praticienne vers l'écran de connexion à la première coupure du Wi-Fi du
  // cabinet — session parfaitement valide, consultation en cours. C'est
  // l'inverse d'I20 : l'application doit continuer quand l'API tombe, pas
  // déconnecter. On ne redirige donc QUE sur une réponse claire et négative.
  useEffect(() => {
    let annule = false;
    void getSession().then((result) => {
      if (annule) return;
      if (!result.ok) {
        // Réponse indéterminée : on reste sur place et on le dit.
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

  // Attend que la session soit tranchée avant d'interroger : lancer la
  // recherche pour un visiteur qu'on est en train de rediriger émet une requête
  // pour rien, et la porte `search_patients` journalise CHAQUE appel — on
  // écrirait donc une ligne d'audit pour une consultation qui n'a pas eu lieu.
  useEffect(() => {
    if (utilisateur === undefined) return;
    let annule = false;
    setChargement(true);
    // Propriété OMISE plutôt que passée à `undefined` : sous
    // `exactOptionalPropertyTypes`, les deux ne sont pas la même chose.
    void searchPatients(requete === "" ? {} : { query: requete }).then((result) => {
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        setPage(undefined);
        setChargement(false);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      setPage(result.data);
      setChargement(false);
    });
    return () => {
      annule = true;
    };
  }, [requete, utilisateur]);


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

  return (
    /* DÉFAUT SÛR sur la composition : profil illisible → navigation la plus
       étroite (`assistant`). Ce n'est pas une protection — la RLS décide seule
       de ce qui est lisible — mais entre deux compositions, afficher la plus
       restreinte quand on ne sait pas qui est connecté est le sens qui coûte le
       moins cher : au pire une entrée de menu manque et se signale. */
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
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
        {fr.patients.titre}
      </h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setRequete(saisie.trim());
        }}
        style={{ display: "flex", gap: "var(--s-3)", margin: "var(--s-6) var(--size-0)" }}
      >
        <label htmlFor="recherche-patients" style={{ position: "absolute", overflow: "hidden", width: "var(--size-0)", height: "var(--size-0)" }}>
          {fr.patients.rechercher}
        </label>
        <input
          id="recherche-patients"
          type="search"
          value={saisie}
          placeholder={fr.patients.rechercherIndication}
          onChange={(event) => setSaisie(event.target.value)}
          style={{
            flex: "1 1 auto",
            minHeight: "var(--target-min)",
            padding: "var(--s-2) var(--s-4)",
            borderRadius: "var(--r-md)",
            border: "var(--rule-width) solid var(--rule)",
            background: "var(--card)",
            color: "var(--ink-900)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
            fontFamily: "var(--font-ui)",
          }}
        />
        <button
          type="submit"
          style={{
            minHeight: "var(--target-min)",
            padding: "var(--s-2) var(--s-5)",
            borderRadius: "var(--r-md)",
            border: "none",
            background: "var(--teal-600)",
            color: "var(--card)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
            fontWeight: "var(--weight-semibold)",
            fontFamily: "var(--font-ui)",
            cursor: "pointer",
          }}
        >
          {fr.patients.rechercher}
        </button>
      </form>

      {horsLigne ? (
        <p role="status" style={{ padding: "var(--s-3) var(--s-4)", borderRadius: "var(--r-md)", background: "var(--sunken)", color: "var(--ink-700)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.etats.horsLigne}
        </p>
      ) : null}

      {messageErreur !== undefined && !horsLigne ? (
        <div role="alert" style={{ padding: "var(--s-3) var(--s-4)", borderRadius: "var(--r-md)", background: "var(--attention-bg)", color: "var(--ink-700)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          <strong style={{ display: "block", color: "var(--attention)", fontSize: "var(--text-label-size)", lineHeight: "var(--text-label-leading)", letterSpacing: "var(--text-label-tracking)" }}>
            {fr.erreur.titre}
          </strong>
          {messageErreur}
        </div>
      ) : null}

      {chargement ? (
        <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {fr.etats.chargement}
        </p>
      ) : null}

      {!chargement && page !== undefined && page.rows.length === 0 ? (
        /* État vide : une phrase --ink-500, aucune illustration (§4 règle 7).
           Deux phrases distinctes selon qu'une recherche est en cours ou non —
           « rien ne correspond » et « rien n'est visible » ne disent pas la
           même chose, et les confondre ferait croire à un dossier manquant. */
        <p style={{ color: "var(--ink-500)", fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)" }}>
          {requete === "" ? fr.patients.listeVide : fr.patients.rechercheSansResultat}
        </p>
      ) : null}

      {!chargement && page !== undefined && page.rows.length > 0 ? (
        <>
          <p style={{ color: "var(--ink-500)", fontSize: "var(--text-label-size)", lineHeight: "var(--text-label-leading)", fontVariantNumeric: "tabular-nums" }}>
            {page.total} {fr.patients.comptage} · {fr.patients.listeActifsSeulement}
          </p>
          <ul style={{ listStyle: "none", margin: "var(--s-4) var(--size-0)", padding: "var(--size-0)", display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
            {page.rows.map((patient) => (
              <li key={patient.id}>
                <Link
                  href={`/patients/${patient.id}`}
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
                  <span
                    aria-hidden="true"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: "var(--target-min)",
                      minHeight: "var(--target-min)",
                      borderRadius: "var(--r-full)",
                      background: "var(--teal-100)",
                      color: "var(--teal-900)",
                      fontSize: "var(--text-label-size)",
                      fontWeight: "var(--weight-semibold)",
                    }}
                  >
                    {monogramme(patient.firstName, patient.lastName)}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
                    <span style={{ fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-leading)", fontWeight: "var(--weight-medium)" }}>
                      {patient.lastName} {patient.firstName}
                    </span>
                    <span style={{ color: "var(--ink-500)", fontSize: "var(--text-label-size)", lineHeight: "var(--text-label-leading)", fontVariantNumeric: "tabular-nums" }}>
                      {patient.recordNumber} · {patient.phone === "" ? fr.etats.texteAbsent : patient.phone}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </AppShell>
  );
}
