/**
 * `useEvenementsCabinet` — l'abonnement temps réel du poste au cabinet.
 *
 * ═══ POURQUOI UNE RECONNEXION MAISON, ALORS QU'EventSource EN A UNE ═════════
 *
 * `EventSource` se reconnecte SEUL, mais à l'URL D'ORIGINE — donc avec le
 * curseur qu'elle portait à l'ouverture. Après une longue session, une
 * reconnexion rejouerait les 200 premiers événements depuis ce vieux curseur,
 * et les événements plus récents — ceux qui comptent — resteraient hors de la
 * fenêtre rendue par la porte. L'écran se croirait à jour sans l'être.
 *
 * On ferme donc nous-mêmes et on rouvre avec `?depuisSeq=<curseur courant>`.
 * Le serveur ne renvoie que ce qui manque, et le client ignore par sécurité
 * tout `seq` déjà vu.
 *
 * ═══ CE QUE CE HOOK NE FAIT PAS ═════════════════════════════════════════════
 *
 * Il ne modifie aucune donnée et ne décide d'aucun droit : il dit « quelque
 * chose a changé », et l'écran redemande par sa porte habituelle. Le flux ne
 * transporte ni nom, ni montant, ni contenu clinique (voir la route serveur).
 */

"use client";

import { useEffect, useRef, useState } from "react";

import type { EvenementCabinet, TypeEvenement } from "@/services/cabinet-collaboration";

export type EtatFlux = "connexion" | "connecte" | "reconnexion" | "hors_ligne";

interface ChargeCabinet {
  readonly seq?: unknown;
  readonly kind?: unknown;
  readonly target_role?: unknown;
  readonly entity_id?: unknown;
  readonly occurred_at?: unknown;
}

function estType(valeur: unknown): valeur is TypeEvenement {
  return (
    valeur === "agenda_updated" ||
    valeur === "payment_updated" ||
    valeur === "notification_created" ||
    valeur === "message_updated" ||
    valeur === "assistant_call"
  );
}

function versEvenement(brut: ChargeCabinet): EvenementCabinet | null {
  const seq = typeof brut.seq === "number" ? brut.seq : Number.parseInt(String(brut.seq ?? ""), 10);
  if (!Number.isFinite(seq) || seq <= 0) return null;
  const kind = estType(brut.kind) ? brut.kind : null;
  if (kind === null) return null;
  return {
    seq,
    kind,
    targetRole:
      brut.target_role === "owner" || brut.target_role === "practitioner" || brut.target_role === "assistant"
        ? brut.target_role
        : null,
    entityId: typeof brut.entity_id === "string" ? brut.entity_id : null,
    occurredAt: typeof brut.occurred_at === "string" ? brut.occurred_at : new Date().toISOString(),
  };
}

const DELAI_MIN_MS = 1_000;
const DELAI_MAX_MS = 10_000;

export interface OptionsEvenements {
  /** Suspend l'abonnement (écran non monté, session non tranchée). */
  readonly actif: boolean;
  /** Curseur initial : reprise exacte après un remontage du composant. */
  readonly depuisSeq?: number;
  /** Appelé pour chaque événement nouveau, dans l'ordre des `seq`. */
  readonly onEvenement?: (evenement: EvenementCabinet) => void;
  /** Appelé quand le serveur signale une troncature : relire l'état complet. */
  readonly onResynchronisation?: () => void;
  /** Notifié à chaque changement d'état, pour le bandeau de connexion. */
  readonly onEtat?: (etat: EtatFlux) => void;
}

export interface RetourEvenements {
  readonly etat: EtatFlux;
  readonly dernierSeq: number;
}

export function useEvenementsCabinet(options: OptionsEvenements): RetourEvenements {
  const { actif, depuisSeq, onEvenement, onResynchronisation, onEtat } = options;

  const [etat, setEtat] = useState<EtatFlux>("connexion");
  const [dernierSeq, setDernierSeq] = useState<number>(depuisSeq ?? 0);

  // Les rappels changent à chaque rendu ; on les lit par référence pour ne pas
  // reconstruire la connexion à chaque frappe dans un champ voisin.
  const rappels = useRef({ onEvenement, onResynchronisation, onEtat });
  rappels.current = { onEvenement, onResynchronisation, onEtat };

  const curseur = useRef<number>(depuisSeq ?? 0);
  const vu = useRef<number>(depuisSeq ?? 0);

  useEffect(() => {
    if (!actif) {
      setEtat("connexion");
      return;
    }

    let arrete = false;
    let source: EventSource | null = null;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let tentative = 0;

    const annoncer = (suivant: EtatFlux): void => {
      setEtat(suivant);
      rappels.current.onEtat?.(suivant);
    };

    const programmer = (): void => {
      if (arrete) return;
      const delai = Math.min(DELAI_MAX_MS, DELAI_MIN_MS * 2 ** Math.min(tentative, 4));
      tentative += 1;
      minuteur = setTimeout(connecter, delai);
    };

    const connecter = (): void => {
      if (arrete) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        annoncer("hors_ligne");
        programmer();
        return;
      }

      annoncer(tentative === 0 ? "connexion" : "reconnexion");

      const url = `/api/cabinet/evenements?depuisSeq=${encodeURIComponent(String(curseur.current))}`;
      source = new EventSource(url);

      source.addEventListener("open", () => {
        tentative = 0;
        annoncer("connecte");
      });

      source.addEventListener("cabinet", (message) => {
        if (!(message instanceof MessageEvent)) return;
        let charge: unknown;
        try {
          charge = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (typeof charge !== "object" || charge === null) return;
        const evenement = versEvenement(charge);
        if (evenement === null) return;
        // Déduplication : un rejeu après reconnexion ne doit ni faire clignoter
        // l'écran ni rejouer une alerte déjà affichée.
        if (evenement.seq <= vu.current) return;
        vu.current = evenement.seq;
        curseur.current = evenement.seq;
        setDernierSeq(evenement.seq);
        rappels.current.onEvenement?.(evenement);
      });

      source.addEventListener("resync", (message) => {
        if (!(message instanceof MessageEvent)) return;
        let max = 0;
        try {
          const charge = JSON.parse(String(message.data)) as { max_seq?: unknown };
          max = typeof charge.max_seq === "number" ? charge.max_seq : Number.parseInt(String(charge.max_seq ?? ""), 10);
        } catch {
          max = 0;
        }
        if (Number.isFinite(max) && max > curseur.current) {
          curseur.current = max;
          vu.current = Math.max(vu.current, max);
          setDernierSeq(max);
        }
        rappels.current.onResynchronisation?.();
      });

      source.addEventListener("error", () => {
        // On ferme NOUS-MÊMES : la reconnexion automatique d'EventSource
        // rouvrirait l'ancienne URL, avec l'ancien curseur (voir l'en-tête).
        source?.close();
        source = null;
        if (arrete) return;
        annoncer(typeof navigator !== "undefined" && navigator.onLine === false ? "hors_ligne" : "reconnexion");
        programmer();
      });
    };

    connecter();

    const enLigne = (): void => {
      if (arrete) return;
      source?.close();
      source = null;
      clearTimeout(minuteur);
      tentative = 0;
      connecter();
    };
    const horsLigne = (): void => annoncer("hors_ligne");

    window.addEventListener("online", enLigne);
    window.addEventListener("offline", horsLigne);

    return () => {
      arrete = true;
      clearTimeout(minuteur);
      source?.close();
      window.removeEventListener("online", enLigne);
      window.removeEventListener("offline", horsLigne);
    };
    // On ne dépend QUE de `actif` : les rappels passent par `rappels`, et
    // `depuisSeq` n'est lu qu'à la première ouverture, par `curseur`. Rouvrir
    // la connexion à chaque rendu ferait clignoter le flux à chaque frappe.
  }, [actif]);

  return { etat, dernierSeq };
}
