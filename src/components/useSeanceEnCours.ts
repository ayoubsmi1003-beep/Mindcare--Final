/**
 * Séance ouverte de l'appelante — pour le bandeau de rappel de la coquille.
 *
 * POURQUOI CE FICHIER EXISTE. `app.get_open_consultation` (026) a été écrit
 * pour exactement cette affordance — son commentaire en base l'annonce déjà,
 * « le port d'entrée de l'écran « une séance est en cours » que la coquille
 * pourra afficher partout » — mais n'avait jusqu'ici AUCUN appelant. Une
 * praticienne qui quittait `/consultation/<id>` n'avait plus aucun chemin de
 * retour que de retrouver le rendez-vous dans l'agenda.
 *
 * ⚠️ AUCUNE DÉCISION D'AUTORISATION ICI. La porte est `SECURITY INVOKER` : la
 * RLS rendrait de toute façon `NULL` pour un rôle qui n'a pas de séance. Le
 * garde sur `role === "assistant"` ci-dessous n'ajoute rien à la sécurité —
 * il évite un appel réseau inutile et, surtout, tient la cloison à DEUX
 * endroits plutôt qu'un seul (I12 : composition, jamais protection).
 *
 * ⚠️ NE JOURNALISE RIEN ICI. `getOpenConsultation()` journalise déjà ses
 * échecs (`consultation.encours`) ; un second `log.error` produirait une
 * double ligne pour un même événement.
 *
 * ⚠️ PAS DE `BroadcastChannel`. L'unicité d'une séance ouverte est garantie en
 * base par l'index `one_open_consult` — c'est déjà la source de vérité
 * partagée entre onglets. Dupliquer cet état côté client créerait une seconde
 * vérité, susceptible de diverger de la première : la leçon de `repartition()`
 * en S4, où deux calculs d'une même donnée ont fini par se contredire à
 * l'écran. On se contente de RELIRE la base quand l'onglet redevient visible.
 */

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getOpenConsultation } from "@/services/consultations";
import type { UserRole } from "@/services/authz";

/**
 * Seul point de décision de ce fichier, volontairement pur et exporté : aucune
 * dépendance au DOM ni au réseau, pour rester testable le jour où un runner de
 * tests arrive dans ce dépôt.
 */
export function doitAfficherBandeau(
  role: UserRole,
  pathname: string,
  seanceId: string | null,
): boolean {
  if (role === "assistant") return false;
  if (pathname.startsWith("/consultation")) return false;
  return seanceId !== null;
}

export interface SeanceEnCours {
  /** `null` : aucune séance ouverte, ou pas de raison de vérifier (assistant, déjà sur l'écran séance). */
  readonly seanceId: string | null;
  readonly afficher: boolean;
}

export function useSeanceEnCours(role: UserRole): SeanceEnCours {
  const pathname = usePathname();
  const [seanceId, setSeanceId] = useState<string | null>(null);

  // Ni l'assistante ni l'écran de séance lui-même n'ont besoin de cette
  // lecture — inutile de la déclencher pour la refuser ensuite à l'affichage.
  const doitVerifier = role !== "assistant" && !pathname.startsWith("/consultation");

  useEffect(() => {
    if (!doitVerifier) {
      setSeanceId(null);
      return;
    }

    let annule = false;

    function lire(): void {
      void getOpenConsultation().then((result) => {
        if (annule) return;
        // Une erreur ou une coupure réseau (I9) n'affiche rien — jamais un
        // message d'erreur pour un simple rappel de confort. L'absence de
        // bandeau n'a jamais empêché de travailler.
        setSeanceId(result.ok ? result.data : null);
      });
    }

    lire();

    // Stratégie multi-onglets : la base reste seule source de vérité. On la
    // relit au retour sur l'onglet plutôt que de propager un état côté client.
    function surRetourVisible(): void {
      if (document.visibilityState === "visible") lire();
    }

    document.addEventListener("visibilitychange", surRetourVisible);
    return () => {
      annule = true;
      document.removeEventListener("visibilitychange", surRetourVisible);
    };
  }, [doitVerifier]);

  return {
    seanceId,
    afficher: doitAfficherBandeau(role, pathname, seanceId),
  };
}
