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
import {
  ChampRecherche,
  EtatVide,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { recherche as textesRecherche } from "@/i18n/recherche";
import { getSession, signOut } from "@/services/auth";
import { purgerContexteSession } from "@/services/conversation";
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
 * — un journal légal illisible, ce qui revient à ne pas en avoir. 140 ms
 * regroupe les frappes rapprochées tout en affichant rapidement les résultats.
 */
const DEBOUNCE_MS = 140;

/** Sous deux caractères, la recherche coûte plus qu'elle ne trie. */
const LONGUEUR_MIN = 2;

/**
 * Taille d'une page de l'annuaire. La porte borne à 100 EN BASE ; 50 tient
 * dans un écran sans noyer la praticienne, et « Suivant » rend les 1 558
 * dossiers atteignables — avant, les 25 premiers seulement existaient.
 */
const TAILLE_PAGE = 50;

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
  const [decalage, setDecalage] = useState(0);
  const [page, setPage] = useState<Page<PatientListItem> | undefined>(undefined);
  const [pageRequete, setPageRequete] = useState<string | undefined>(undefined);
  const [pageDecalage, setPageDecalage] = useState<number | undefined>(undefined);
  const [relance, setRelance] = useState(0);
  const [relanceSession, setRelanceSession] = useState(0);
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
  }, [router, relanceSession]);

  // Le débounce — voir la constante. Une saisie plus courte que le seuil
  // remet la liste complète plutôt que de laisser le dernier résultat à
  // l'écran, ce qui ferait croire que la recherche est encore active.
  useEffect(() => {
    const t = saisie.trim();
    const minuteur = setTimeout(() => {
      setDecalage(0);
      setRequete(t.length >= LONGUEUR_MIN ? t : "");
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(minuteur);
    };
  }, [saisie]);

  // La recherche centrale de la Topbar pilote cette même saisie :
  // - `?recherche=` relu à l'arrivée depuis un autre écran ;
  // - événement `mindcare:topbar-recherche` quand on tape depuis la barre.
  // Debounce + audit inchangés : tout passe par `setSaisie`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("recherche") ?? params.get("q") ?? "";
    if (q !== "") setSaisie(q);
    function surTopbar(evenement: Event): void {
      setSaisie(String((evenement as CustomEvent<string>).detail ?? ""));
    }
    window.addEventListener("mindcare:topbar-recherche", surTopbar);
    return () => {
      window.removeEventListener("mindcare:topbar-recherche", surTopbar);
    };
  }, []);

  // Attend que la session soit tranchée avant d'interroger : lancer la
  // recherche pour un visiteur qu'on est en train de rediriger émet une requête
  // pour rien, et la porte `search_patients` journalise CHAQUE appel — on
  // écrirait donc une ligne d'audit pour une consultation qui n'a pas eu lieu.
  useEffect(() => {
    if (sessionTranchee !== true) return;
    let annule = false;
    setChargement(true);
    setMessageErreur(undefined);
    setHorsLigne(false);

    const minuteur = setTimeout(() => {
      if (annule) return;
      setHorsLigne(false);
      setMessageErreur("La recherche prend plus de temps que prévu.");
      setChargement(false);
    }, DELAI_CHARGEMENT_MS);

    // Propriété OMISE plutôt que passée à `undefined` : sous
    // `exactOptionalPropertyTypes`, les deux ne sont pas la même chose.
    void searchPatients(
      requete === ""
        ? { limit: TAILLE_PAGE, offset: decalage }
        : { query: requete, limit: TAILLE_PAGE, offset: decalage },
    ).then((result) => {
      clearTimeout(minuteur);
      if (annule) return;
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur("La recherche n’a pas pu être actualisée.");
        setChargement(false);
        return;
      }
      setHorsLigne(false);
      setMessageErreur(undefined);
      // Une page devenue vide après un filtre est ramenée à la dernière page
      // réelle : sinon « page 7 » resterait affichée sur un total de 2 pages.
      if (result.data.rows.length === 0 && decalage > 0 && result.data.total > 0) {
        setDecalage(Math.max(0, Math.floor((result.data.total - 1) / TAILLE_PAGE) * TAILLE_PAGE));
        setChargement(false);
        return;
      }
      setPage(result.data);
      setPageRequete(requete);
      setPageDecalage(decalage);
      setChargement(false);
    });
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [requete, decalage, sessionTranchee, relance]);

  // Fermeture de session depuis l'interface. `replace` et pas `push` : le
  // bouton Retour ne doit pas ramener sur un écran de dossiers après une
  // déconnexion volontaire, sur un poste que le patient suivant voit.
  function deconnecter(): void {
    // Phase 3 : aucun contexte patient ne survit à la session.
    purgerContexteSession();
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
        <p role="status" className="text-sm text-ink-500">Connexion au service en cours.</p>
        <button type="button" onClick={() => { setSessionTranchee(undefined); setRelanceSession(value => value + 1); }}>Réessayer</button>
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
      sousTitre={dateDuJour()}
      actions={
        /* SPRINT-V1 §V5 : « Bouton Nouveau patient — visible, en haut a
           droite, jamais cache dans un menu ». Il l'est desormais dans la
           barre superieure, donc au meme endroit sur tous les ecrans. */
        <LienBouton href="/patients/nouveau" rang="principal">
          {fr.patients.creation.titre}
        </LienBouton>
      }
    >
      {/* Plus de bouton « Rechercher » : la recherche part au débounce. Le
          formulaire reste un `form` pour que `Entrée` fonctionne au clavier et
          que le champ soit correctement étiqueté. v9 — la barre prend la
          forme d'une commande : loupe, champ sans bordure propre, le focus
          porté par la barre entière. */}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setDecalage(0);
          setRequete(saisie.trim());
          setRelance(value => value + 1);
        }}
        className="mb-5"
      >
        <ChampRecherche
          libelle={fr.patients.rechercher}
          valeur={saisie}
          onChange={setSaisie}
          placeholder={fr.patients.rechercherIndication}
        />
      </form>

      {messageErreur !== undefined ? (
        <div role="status" className="mb-3 flex items-center gap-3 text-sm text-ink-500">
          <span>{horsLigne ? "Connexion interrompue." : messageErreur} {page !== undefined ? "Les derniers résultats restent affichés." : "Réessayez la recherche."}</span>
          <button type="button" className="font-medium underline underline-offset-4" onClick={() => setRelance(value => value + 1)}>Réessayer</button>
        </div>
      ) : null}

      {/* V1.5 — squelette, jamais un mot d'attente (05-UX-CONTRACT.md §2) : il
          occupe la place des lignes de la liste, de sorte que l'arrivée des
          dossiers ne décale rien. UNIQUEMENT au premier chargement : pendant
          une recherche, l'ancienne liste reste à l'écran (rassis-pendant-
          revalidation) au lieu de clignoter en squelette à chaque frappe. */}
      {chargement && page === undefined ? <Squelette lignes={6} /> : null}

      {!chargement && messageErreur === undefined && pageRequete === requete && pageDecalage === decalage && page !== undefined && page.rows.length === 0 ? (
        /* Deux phrases distinctes selon qu'une recherche est en cours ou non —
           « rien ne correspond » et « rien n'est visible » ne disent pas la
           même chose, et les confondre ferait croire à un dossier manquant.
           v9 — l'icône compose le vide : la loupe dit « on a cherché », le
           monogramme dit « l'annuaire est là, il est vide pour vous ». */
        <EtatVide
          message={requete === "" ? fr.patients.listeVide : fr.patients.rechercheSansResultat}
          icone={requete === "" ? "patients" : "recherche"}
        />
      ) : null}

      {page !== undefined && (page.rows.length > 0 || chargement) ? (
        <>
          <p
            aria-live="polite"
            className="font-ui text-label font-medium tabular-nums text-ink-500"
          >
            {page.total === 0
              ? `0 ${fr.patients.comptage}`
              : `${(pageDecalage ?? decalage) + 1}–${Math.min(
                  (pageDecalage ?? decalage) + TAILLE_PAGE,
                  page.total,
                )} ${textesRecherche.sur} ${page.total} ${fr.patients.comptage}`}{" "}
            · {fr.patients.listeActifsSeulement}
            {pageRequete !== requete || pageDecalage !== decalage
              ? " · Résultats précédents — recherche non actualisée"
              : ""}
            {chargement ? ` · ${fr.etats.chargement}` : ""}
          </p>

          <div aria-busy={chargement || undefined} className="mt-4 overflow-hidden rounded-2xl border border-rule bg-card shadow-carte">
            <EnTeteAnnuaire />
            <ul className="m-0 list-none p-0">
              {page.rows.map((patient) => (
                <LignePatient key={patient.id} patient={patient} />
              ))}
            </ul>
          </div>

          {page.total > TAILLE_PAGE ? (
            <nav
              aria-label={textesRecherche.page}
              className="mt-4 flex flex-wrap items-center justify-between gap-3"
            >
              <button
                type="button"
                disabled={decalage === 0 || chargement}
                onClick={() => {
                  setDecalage((valeur) => Math.max(0, valeur - TAILLE_PAGE));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="inline-flex min-h-target items-center rounded-full border border-rule bg-card px-4 font-ui text-body font-semibold text-ink-900 shadow-douce transition duration-quick hover:border-ink-300 focus-visible:outline focus-visible:outline-action-600 disabled:cursor-not-allowed disabled:opacity-disabled"
              >
                {textesRecherche.precedent}
              </button>
              <span className="font-num text-label tabular-nums text-ink-500">
                {textesRecherche.page} {Math.floor(decalage / TAILLE_PAGE) + 1}{" "}
                {textesRecherche.sur}{" "}
                {Math.max(1, Math.ceil(page.total / TAILLE_PAGE))}
              </span>
              <button
                type="button"
                disabled={decalage + TAILLE_PAGE >= page.total || chargement}
                onClick={() => {
                  setDecalage((valeur) => valeur + TAILLE_PAGE);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="inline-flex min-h-target items-center rounded-full border border-rule bg-card px-4 font-ui text-body font-semibold text-ink-900 shadow-douce transition duration-quick hover:border-ink-300 focus-visible:outline focus-visible:outline-action-600 disabled:cursor-not-allowed disabled:opacity-disabled"
              >
                {textesRecherche.suivant}
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}

/**
 * La date du jour, en toutes lettres — le contexte de l'en-tête de lieu.
 * `fr-DZ` et le format long : « lundi 24 août ». C'est une ÉTIQUETTE de
 * lecture, pas une borne de journée : la référence des bornes reste le
 * serveur en Africa/Algiers, jamais l'horloge du poste.
 */
function dateDuJour(): string {
  return new Intl.DateTimeFormat("fr-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}
