/**
 * Le garde de session, écrit UNE fois.
 *
 * POURQUOI CE FICHIER EXISTE. Les écrans de S3 portent chacun leur copie de ce
 * bloc, avec le même commentaire d'avertissement — parce qu'il s'y est trompé
 * une première fois, et que la correction a dû être appliquée deux fois. Trois
 * écrans de plus en S4 feraient cinq copies d'une logique dont UNE SEULE ligne
 * fausse éjecte une praticienne en pleine consultation. On l'extrait ici.
 *
 * S3 N'EST PAS MODIFIÉ. Les deux écrans Patients gardent leur copie : ils sont
 * gelés et fonctionnent. C'est la forme que prennent les écrans NEUFS.
 *
 * ⚠️ « ÉCHEC DE LECTURE DE LA SESSION » N'EST PAS « AUCUNE SESSION », et c'est
 * tout l'intérêt de ce fichier. `getSession()` déclenche un rafraîchissement de
 * jeton quand il approche de l'expiration ; hors ligne, ce rafraîchissement
 * échoue et rend une erreur. Une version antérieure de l'écran Patients
 * redirigeait sur `!result.ok`, donc éjectait la praticienne vers l'écran de
 * connexion à la première coupure du Wi-Fi du cabinet — session parfaitement
 * valide, consultation en cours. C'est l'inverse d'I20 : l'application doit
 * continuer quand l'API tombe, pas déconnecter.
 *
 * ON NE REDIRIGE DONC QUE SUR UNE RÉPONSE CLAIRE ET NÉGATIVE.
 *
 * AUCUNE DÉCISION D'AUTORISATION ICI. Le rôle rendu ne sert qu'à composer la
 * navigation (I12). Ce qui est lisible est décidé par la RLS Postgres.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getSession, signOut } from "@/services/auth";
import { purgerContexteSession } from "@/services/conversation";
import { getCurrentUser, type CurrentUser } from "@/services/authz";

export interface SessionEcran {
  /**
   * `undefined` tant que la session n'est pas tranchée, `null` si le profil est
   * illisible. Les trois états sont distincts : lancer une requête avant que la
   * session soit tranchée écrirait une ligne d'audit pour une consultation qui
   * n'a pas eu lieu.
   */
  readonly utilisateur: CurrentUser | null | undefined;
  /**
   * V1.5 — LE FEU VERT DE LECTURE, distinct du profil.
   *
   * `undefined` tant que `getSession()` n'a pas répondu ; `true` dès qu'une
   * session existe ; `false` si la réponse est indéterminée (hors ligne,
   * erreur de transport — on reste sur place, cf. l'encadré ci-dessus).
   *
   * POURQUOI IL EXISTE. Les écrans attendaient `utilisateur !== undefined`,
   * c'est-à-dire la FIN de `getCurrentUser()`, avant leur première requête
   * métier : trois allers-retours en séquence avant le premier contenu, sur
   * tous les écrans, alors que la donnée métier ne dépend pas du profil.
   * `getCurrentUser` ne sert qu'à composer la navigation (I12).
   *
   * ⚠️ CE QUI NE CHANGE PAS, ET C'EST LE POINT : la garantie d'I4 tient
   * toujours. Aucune porte journalisante n'est appelée avant que la session
   * soit tranchée — et c'est `getSession()` qui la tranche, pas le profil.
   * Attendre le profil en plus n'ajoutait aucune garantie, seulement un
   * aller-retour.
   */
  readonly sessionTranchee: boolean | undefined;
  readonly horsLigne: boolean;
  readonly deconnecter: () => void;
  /**
   * Rejoue la résolution session → profil, et remet l'écran en CHARGEMENT
   * pendant qu'elle court.
   *
   * POURQUOI ELLE EXISTE. Un écran qui compose PAR RÔLE ne peut pas se
   * contenter d'annoncer « profil illisible » : il doit offrir le geste qui
   * répare. Sans cette fonction, le seul recours était `window.location
   * .reload()` — un rechargement complet qui refait toutes les lectures
   * métier de l'écran pour relire UNE ligne d'annuaire.
   */
  readonly reessayer: () => void;
}

export function useSessionEcran(): SessionEcran {
  const router = useRouter();
  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  const [sessionTranchee, setSessionTranchee] = useState<boolean | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [tentative, setTentative] = useState(0);

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
        // Redirection en cours : la session est tranchée NÉGATIVEMENT. On ne
        // pose surtout pas `true` — un écran qui interrogerait ici écrirait
        // une trace d'audit pour une consultation qui n'aura pas lieu.
        setSessionTranchee(false);
        router.replace("/connexion");
        return;
      }
      // Le feu vert est donné ICI, avant le profil : la lecture métier de
      // l'écran et `getCurrentUser` partent désormais en parallèle.
      setSessionTranchee(true);
      void getCurrentUser().then((profil) => {
        if (annule) return;
        // ⚠️ LA CAUSE REMONTE, PARCE QUE L'ÉCRAN EN A BESOIN POUR CHOISIR SA
        // PHRASE. `getCurrentUser()` rend `null` pour quatre raisons — pas de
        // session, pas de ligne, rôle inconnu, transport en panne — et un écran
        // qui les confond dit « votre profil est illisible » à quelqu'un dont
        // le Wi-Fi vient simplement de tomber. Le bandeau hors ligne est déjà
        // la bonne réponse à ce cas-là : on le pose ici aussi.
        if (!profil.ok && profil.error.code === "hors-ligne") setHorsLigne(true);
        setUtilisateur(profil.ok ? profil.data : null);
      });
    });
    return () => {
      annule = true;
    };
  }, [router, tentative]);

  // `replace` et pas `push` : le bouton Retour ne doit pas ramener sur un écran
  // de dossiers après une déconnexion volontaire, sur un poste que le patient
  // suivant voit.
  function deconnecter(): void {
    // Phase 3 : la cible Jarvis et le contexte d'outil meurent avec la
    // session — une reconnexion ne doit jamais réutiliser le patient d'avant.
    purgerContexteSession();
    void signOut().then(() => {
      router.replace("/connexion");
    });
  }

  /**
   * Remettre les trois états à leur valeur d'ouverture N'EST PAS cosmétique :
   * sans cela, l'écran garde son ERREUR affichée pendant que la nouvelle
   * tentative court, et les deux états coexistent — ce que la règle
   * d'exclusivité d'`UX_CONTRACT.md` interdit.
   */
  function reessayer(): void {
    setUtilisateur(undefined);
    setSessionTranchee(undefined);
    setHorsLigne(false);
    setTentative((n) => n + 1);
  }

  return { utilisateur, sessionTranchee, horsLigne, deconnecter, reessayer };
}
