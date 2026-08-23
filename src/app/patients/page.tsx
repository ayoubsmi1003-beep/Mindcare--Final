/**
 * Liste Patients — l'annuaire clinique du cabinet.
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
 * ⚠️ AUCUN FILTRE « À REVOIR », « RDV AUJOURD'HUI », « NOUVEAU ». Ils
 * figuraient au cahier des charges de V2 ; la porte ne les supporte pas, et
 * trois d'entre eux n'ont aucune donnée derrière. Un filtre qui ne filtre rien
 * est pire qu'un filtre absent : il fait croire que la liste a été restreinte.
 *
 * AUCUNE DÉCISION D'AUTORISATION ICI. Pas un seul `if (role === …)`. Le rôle ne
 * sert qu'à composer la navigation (I12) ; ce qui est lisible est décidé par la
 * RLS, et chaque lecture est journalisée par la porte `app.search_patients`
 * elle-même (I4, ADR-019).
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { EnTeteAnnuaire, LignePatient } from "@/components/patients/LignePatient";
import { BandeauHorsLigne, BlocErreur, EnTeteEcran, EtatVide, Squelette } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { getSession, signOut } from "@/services/auth";
import { getCurrentUser, type CurrentUser } from "@/services/authz";
import { searchPatients, type PatientListItem } from "@/services/patients";
import type { Page } from "@/services/result";

/**
 * V1.5 — au-delà de ce délai sans réponse, l'écran bascule en ERREUR avec le
 * mot « délai » (05-UX-CONTRACT.md §2). Aucune attente n'est infinie : un
 * squelette qui respire pour toujours est un spinner sans fin déguisé.
 *
 * La requête n'est pas annulée (les services ne l'exposent pas) ; le drapeau
 * `annule` de l'effet fait ignorer une réponse arrivée après coup.
 */
const DELAI_CHARGEMENT_MS = 10_000;

/**
 * ⚠️ LE DÉBOUNCE N'EST PAS QU'UN CONFORT : CHAQUE APPEL ÉCRIT UNE LIGNE
 * D'AUDIT. `app.search_patients` journalise une trace `recherche` par appel.
 * Interroger à chaque frappe noierait `audit.log` sous une ligne par caractère
 * — un journal légal illisible, ce qui revient à ne pas en avoir. 250 ms est
 * sous le seuil de perception d'une pause pour une frappe courante, et
 * regroupe un mot entier en un seul appel.
 */
const DEBOUNCE_MS = 250;

/** Sous deux caractères, la recherche coûte plus qu'elle ne trie. */
const LONGUEUR_MIN = 2;

export default function PagePatients(): React.JSX.Element {
  const router = useRouter();
  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  // V1.5 — le feu vert de LECTURE, distinct du profil : c'est `getSession()`
  // qui tranche la session, et la recherche n'a pas besoin du profil (qui ne
  // sert qu'à composer la navigation, I12). Les deux partent en parallèle au
  // lieu de s'enchaîner. La garantie d'audit ne bouge pas : `search_patients`
  // n'est appelée qu'une fois la session tranchée POSITIVEMENT.
  const [sessionTranchee, setSessionTranchee] = useState<boolean | undefined>(undefined);
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
        setSessionTranchee(false);
        setUtilisateur(null);
        return;
      }
      if (result.data === null) {
        // Tranchée NÉGATIVEMENT : surtout pas `true`. Interroger ici écrirait
        // une ligne d'audit pour une consultation qui n'aura pas lieu.
        setSessionTranchee(false);
        router.replace("/connexion");
        return;
      }
      setSessionTranchee(true);
      void getCurrentUser().then((profil) => {
        if (annule) return;
        setUtilisateur(profil.ok ? profil.data : null);
      });
    });
    return () => {
      annule = true;
    };
  }, [router]);

  // Le débounce — voir la constante. Une saisie plus courte que le seuil
  // remet la liste complète plutôt que de laisser le dernier résultat à
  // l'écran, ce qui ferait croire que la recherche est encore active.
  useEffect(() => {
    const t = saisie.trim();
    const minuteur = setTimeout(() => {
      setRequete(t.length >= LONGUEUR_MIN ? t : "");
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(minuteur);
    };
  }, [saisie]);

  // Attend que la session soit tranchée avant d'interroger : lancer la
  // recherche pour un visiteur qu'on est en train de rediriger émet une requête
  // pour rien, et la porte `search_patients` journalise CHAQUE appel — on
  // écrirait donc une ligne d'audit pour une consultation qui n'a pas eu lieu.
  useEffect(() => {
    if (sessionTranchee !== true) return;
    let annule = false;
    setChargement(true);

    const minuteur = setTimeout(() => {
      if (annule) return;
      setHorsLigne(false);
      setMessageErreur(fr.delaiDepasse);
      setPage(undefined);
      setChargement(false);
    }, DELAI_CHARGEMENT_MS);

    // Propriété OMISE plutôt que passée à `undefined` : sous
    // `exactOptionalPropertyTypes`, les deux ne sont pas la même chose.
    void searchPatients(requete === "" ? {} : { query: requete }).then((result) => {
      clearTimeout(minuteur);
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
      clearTimeout(minuteur);
    };
  }, [requete, sessionTranchee]);

  // Fermeture de session depuis l'interface. `replace` et pas `push` : le
  // bouton Retour ne doit pas ramener sur un écran de dossiers après une
  // déconnexion volontaire, sur un poste que le patient suivant voit.
  function deconnecter(): void {
    void signOut().then(() => {
      router.replace("/connexion");
    });
  }

  // V1.5 — LA SESSION TRANCHÉE NÉGATIVEMENT A SA PROPRE SORTIE.
  //
  // Défaut trouvé et corrigé dans la session qui a introduit `sessionTranchee` :
  // le garde de RENDU testait `utilisateur === undefined`, alors que le garde
  // d'EFFET teste `sessionTranchee !== true`. Hors ligne, `getSession()` échoue
  // → `sessionTranchee = false` ET `utilisateur = null` : le rendu passait le
  // premier garde, la recherche ne partait jamais, et `chargement` restait à
  // `true`. Le squelette respirait alors SANS FIN — l'attente infinie que V1.5
  // supprime (05-UX-CONTRACT.md §2).
  //
  // ⚠️ La condition est `sessionTranchee === false`, PAS `utilisateur === null` :
  // session lue mais PROFIL illisible (`sessionTranchee === true`,
  // `utilisateur === null`) doit continuer à afficher la liste avec la
  // navigation la plus étroite — c'est le « défaut sûr » documenté plus bas.
  if (sessionTranchee === false) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigne ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={horsLigne ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
        />
      </main>
    );
  }

  if (utilisateur === undefined) {
    // V1.5 — squelette, pas un texte (05-UX-CONTRACT.md §2) : l'écran répond
    // sous les 100 ms avec la FORME du contenu réel, pas un message d'attente.
    return (
      <main className="p-8">
        <Squelette lignes={6} />
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
      {/* V3 — EN-TÊTE HÉROS. Admis ici parce que le titre est un nom de LIEU
          (« Patients »), jamais celui d'un dossier : ADR-022 interdit un
          dégradé derrière un nom de patient, et c'est cette frontière qui
          décide lequel des deux en-têtes un écran reçoit. La fiche d'un
          dossier, elle, garde `EnTetePage`, sobre et opaque. */}
      <EnTeteEcran icone="patients" titre={fr.patients.titre} />

      {/* Plus de bouton « Rechercher » : la recherche part au débounce. Le
          formulaire reste un `form` pour que `Entrée` fonctionne au clavier et
          que le champ soit correctement étiqueté. */}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setRequete(saisie.trim());
        }}
        className="my-6"
      >
        <label htmlFor="recherche-patients" className="sr-only">
          {fr.patients.rechercher}
        </label>
        <input
          id="recherche-patients"
          type="search"
          value={saisie}
          placeholder={fr.patients.rechercherIndication}
          onChange={(event) => setSaisie(event.target.value)}
          className="min-h-target-lg w-full rounded-md border border-rule bg-card px-4 font-ui text-body text-ink-900 placeholder:text-ink-500"
        />
      </form>

      {horsLigne ? <BandeauHorsLigne /> : null}

      {messageErreur !== undefined && !horsLigne ? (
        <BlocErreur message={messageErreur} />
      ) : null}

      {/* V1.5 — squelette, jamais un mot d'attente (05-UX-CONTRACT.md §2) : il
          occupe la place des lignes de la liste, de sorte que l'arrivée des
          dossiers ne décale rien. */}
      {chargement ? <Squelette lignes={6} /> : null}

      {!chargement && page !== undefined && page.rows.length === 0 ? (
        /* Deux phrases distinctes selon qu'une recherche est en cours ou non —
           « rien ne correspond » et « rien n'est visible » ne disent pas la
           même chose, et les confondre ferait croire à un dossier manquant. */
        <EtatVide
          message={requete === "" ? fr.patients.listeVide : fr.patients.rechercheSansResultat}
        />
      ) : null}

      {!chargement && page !== undefined && page.rows.length > 0 ? (
        <>
          <p className="font-ui text-label tracking-label tabular-nums text-ink-500">
            {page.total} {fr.patients.comptage} · {fr.patients.listeActifsSeulement}
          </p>

          <div className="mt-4 rounded-lg border border-rule bg-card px-3 py-3">
            <EnTeteAnnuaire />
            <ul className="m-0 list-none p-0">
              {page.rows.map((patient) => (
                <LignePatient key={patient.id} patient={patient} />
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
