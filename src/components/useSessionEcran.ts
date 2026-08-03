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
import { getCurrentUser, type CurrentUser } from "@/services/authz";

export interface SessionEcran {
  /**
   * `undefined` tant que la session n'est pas tranchée, `null` si le profil est
   * illisible. Les trois états sont distincts : lancer une requête avant que la
   * session soit tranchée écrirait une ligne d'audit pour une consultation qui
   * n'a pas eu lieu.
   */
  readonly utilisateur: CurrentUser | null | undefined;
  readonly horsLigne: boolean;
  readonly deconnecter: () => void;
}

export function useSessionEcran(): SessionEcran {
  const router = useRouter();
  const [utilisateur, setUtilisateur] = useState<CurrentUser | null | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);

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

  // `replace` et pas `push` : le bouton Retour ne doit pas ramener sur un écran
  // de dossiers après une déconnexion volontaire, sur un poste que le patient
  // suivant voit.
  function deconnecter(): void {
    void signOut().then(() => {
      router.replace("/connexion");
    });
  }

  return { utilisateur, horsLigne, deconnecter };
}
