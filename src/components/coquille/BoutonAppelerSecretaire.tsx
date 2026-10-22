/**
 * « Appeler la secrétaire » — l'alerte du médecin vers le poste d'accueil.
 *
 * ═══ CE QUE LE BOUTON DIT, ET CE QU'IL NE DIT PAS ══════════════════════════
 *
 * Trois états sont VÉRIFIABLES, et un seul est affiché à la fois :
 *   · « Appel envoyé »      — la transaction a commité sur le PC médecin ;
 *   · « Notification affichée »  — le poste d'accueil a accusé réception de
 *     l'événement (`delivered_at`). Cela prouve un affichage, JAMAIS une
 *     écoute : un haut-parleur coupé reste possible ;
 *   · « Elle arrive »       — quelqu'un a cliqué « J'arrive ». C'est le seul
 *     état qui engage une personne.
 *
 * L'expiration est un état normal, pas une erreur : au-delà de 60 s sans
 * accusé, la porte marque l'appel `expired` et l'écran cesse d'attendre.
 *
 * ═══ POURQUOI UNE INTERROGATION COURTE PLUTÔT QU'UN SECOND FLUX SSE ═════════
 *
 * Le tableau de bord possède déjà UN abonnement au flux du cabinet. En ouvrir
 * un second depuis ce bouton multiplierait les connexions pour un état qui ne
 * dure qu'une minute. On interroge `app.get_assistant_call_status` à cadence
 * courte, uniquement pendant l'attente, puis on s'arrête.
 *
 * ═══ AUCUNE DÉCISION D'AUTORISATION ICI ═════════════════════════════════════
 *
 * `app.call_assistant` refuse tout rôle autre que `owner`/`practitioner` et
 * applique la limite de débit. Masquer le bouton à l'accueil est une
 * composition d'interface (I12), pas une protection.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Bouton } from "@/components/ui/Bouton";
import { fr } from "@/i18n/fr";
import { appelerSecretaire, statutAppel, type EtatAppel } from "@/services/cabinet-collaboration";

type Phase = "repos" | "envoi" | "envoye" | "remis" | "acquitte" | "expire" | "indisponible";

const INTERVALLE_MS = 1_200;
const DUREE_ATTENTE_MS = 75_000;

function libelle(phase: Phase): string {
  const c = fr.collaboration.appel;
  switch (phase) {
    case "envoi":
      return c.enCours;
    case "envoye":
      return c.envoye;
    case "remis":
      return c.remis;
    case "acquitte":
      return c.acquitte;
    case "expire":
      return c.expire;
    case "indisponible":
      return c.indisponible;
    case "repos":
      return c.action;
  }
}

function ton(phase: Phase): "positif" | "attention" | "neutre" {
  if (phase === "acquitte") return "positif";
  if (phase === "expire" || phase === "indisponible") return "attention";
  return "neutre";
}

export interface BoutonAppelerSecretaireProps {
  /** Densité compacte pour la barre de séance. */
  readonly compact?: boolean;
}

export function BoutonAppelerSecretaire({ compact = false }: BoutonAppelerSecretaireProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>("repos");
  const [erreur, setErreur] = useState<string | null>(null);
  const [attente, setAttente] = useState(false);

  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null);
  const echeance = useRef<number>(0);
  const monte = useRef(true);

  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
      if (minuteur.current !== null) clearInterval(minuteur.current);
    };
  }, []);

  const arreter = useCallback((): void => {
    if (minuteur.current !== null) {
      clearInterval(minuteur.current);
      minuteur.current = null;
    }
    setAttente(false);
  }, []);

  const appliquerEtat = useCallback(
    (etat: EtatAppel): void => {
      if (!monte.current) return;
      if (etat === "acknowledged") {
        setPhase("acquitte");
        arreter();
        return;
      }
      if (etat === "expired") {
        setPhase("expire");
        arreter();
        return;
      }
      if (etat === "delivered") {
        setPhase("remis");
        return;
      }
      setPhase("envoye");
    },
    [arreter],
  );

  const suivre = useCallback(
    (id: string): void => {
      arreter();
      echeance.current = Date.now() + DUREE_ATTENTE_MS;
      setAttente(true);
      minuteur.current = setInterval(() => {
        if (Date.now() > echeance.current) {
          arreter();
          return;
        }
        void statutAppel(id).then((resultat) => {
          if (!monte.current) return;
          if (!resultat.ok) {
            // Une coupure pendant l'attente n'efface pas l'appel déjà envoyé :
            // on garde l'état courant et on laisse la fenêtre expirer.
            return;
          }
          if (resultat.data === null) return;
          appliquerEtat(resultat.data.etat);
        });
      }, INTERVALLE_MS);
    },
    [appliquerEtat, arreter],
  );

  async function appeler(): Promise<void> {
    if (phase === "envoi") return;
    setErreur(null);
    setPhase("envoi");

    // L'identifiant est généré AVANT l'appel : un rejeu réseau ou un double
    // clic porte le même et ne produit pas un second appel.
    const identifiant = crypto.randomUUID();
    const resultat = await appelerSecretaire(identifiant);

    if (!monte.current) return;

    if (!resultat.ok) {
      setPhase("indisponible");
      setErreur(resultat.error.message);
      return;
    }
    if (resultat.data === null) {
      setPhase("indisponible");
      return;
    }

    appliquerEtat(resultat.data.etat);
    suivre(resultat.data.callId);
  }

  function fermer(): void {
    arreter();
    setPhase("repos");
    setErreur(null);
  }

  const actif = phase !== "repos";
  const t = ton(phase);

  /**
   * DEUX VARIANTES, ET UNE SEULE RÈGLE : le libellé doit toujours dire l'état.
   *
   * · `compact` (barre supérieure, barre de séance — 60 px de haut) : une seule
   *   ligne, donc c'est le BOUTON qui porte l'état ;
   * · sinon (panneau, tableau de bord) : l'action reste stable, une ligne de
   *   statut dit où en est l'appel.
   *
   * Dans les deux cas, aucun libellé ne prétend qu'un son a été entendu.
   */
  return (
    <div className={compact ? "flex items-center gap-2" : "flex min-w-0 flex-col items-stretch gap-1"}>
      <div className="flex min-w-0 items-center gap-2">
        <Bouton
          rang="principal"
          taille={compact ? "compact" : "defaut"}
          onClick={() => void appeler()}
          chargement={phase === "envoi"}
          disabled={phase === "envoi"}
        >
          {compact ? libelle(phase) : fr.collaboration.appel.action}
        </Bouton>
        {!compact && actif && (phase === "expire" || phase === "indisponible" || phase === "acquitte") ? (
          <Bouton rang="discret" taille="compact" onClick={fermer}>
            {fr.actions.annuler}
          </Bouton>
        ) : null}
      </div>

      {compact ? (
        <span role="status" aria-live="polite" className="sr-only">
          {libelle(phase)}
          {attente && (phase === "envoye" || phase === "remis") ? " …" : ""}
        </span>
      ) : (
        <p
          role="status"
          aria-live="polite"
          className={[
            "m-0 min-w-0 truncate font-ui text-label",
            t === "positif" ? "text-positive" : t === "attention" ? "text-attention-ink" : "text-ink-500",
          ].join(" ")}
        >
          {libelle(phase)}
          {attente && (phase === "envoye" || phase === "remis") ? " …" : ""}
        </p>
      )}

      {erreur !== null ? (
        <p role="status" className="m-0 font-ui text-label text-attention-ink">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
