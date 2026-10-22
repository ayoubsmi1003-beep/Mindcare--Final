/**
 * Bandeau d'alerte « Le médecin vous demande » — poste d'accueil.
 *
 * ═══ CE QUI SE PASSE QUAND L'ALERTE ARRIVE ══════════════════════════════════
 *
 *   1. le carillon local est tenté (Web Audio, aucun fichier) ;
 *   2. le processus principal Electron affiche une notification Windows et
 *      fait clignoter la barre des tâches — utile quand la fenêtre est
 *      réduite ou que Windows « Ne pas déranger » masque les toasts ;
 *   3. le poste accuse REMISE (`mark_assistant_call_delivered`), ce qui met à
 *      jour le bouton du médecin : « Notification affichée à l'accueil ».
 *
 * ⚠️ AUCUNE DE CES TROIS CHOSES NE PROUVE QU'UN SON A ÉTÉ ENTENDU. Le bandeau
 * ne le prétend jamais. Seul le clic « J'arrive » engage une personne et
 * produit l'état `acknowledged` côté médecin.
 *
 * ═══ DÉDUPLICATION ═════════════════════════════════════════════════════════
 *
 * Le flux SSE peut livrer plusieurs fois le même appel (mise à jour
 * `delivered`, puis `acknowledged`) et l'écran peut se remonter. Un registre de
 * module retient les appels déjà sonnés : une alerte ne carillonne jamais deux
 * fois pour le même `callId`.
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { heure } from "@/components/AgendaPieces";
import { Bouton } from "@/components/ui";
import { arreterClignotement, jouerCarillon, notifierAppelDoctor } from "@/components/desktop-bridge";
import { fr } from "@/i18n/fr";
import { marquerAppelRemis, type AppelActif } from "@/services/cabinet-collaboration";

/**
 * Les appels déjà signalés sur CE poste, pour la durée de la session. Un
 * `Set` de module survit aux remontages du composant, ce qui est exactement
 * ce qu'on veut : re-rendre un bandeau ne doit pas re-sonner.
 */
const dejaSignales = new Set<string>();

/** Un appel reste affiché un peu au-delà de son expiration, le temps de lire. */
const GRACE_MS = 4_000;

export interface BandeauAppelMedecinProps {
  readonly appel: AppelActif;
  /** Accusé humain. Le parent rafraîchit ensuite son état. */
  readonly onAcquitter: (callId: string) => Promise<void>;
  /** Appel échu : le parent retire le bandeau. */
  readonly onExpirer: () => void;
}

export function BandeauAppelMedecin({ appel, onAcquitter, onExpirer }: BandeauAppelMedecinProps): React.JSX.Element {
  const [acquitte, setAcquitte] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const signale = useRef(false);

  // Signalement : une seule fois par appel, même si le composant se remonte.
  useEffect(() => {
    if (dejaSignales.has(appel.callId)) {
      signale.current = true;
      return;
    }
    dejaSignales.add(appel.callId);
    signale.current = true;

    jouerCarillon();
    void notifierAppelDoctor({ callId: appel.callId, callerName: appel.callerName });
    // La remise est un accusé d'AFFICHAGE. Si elle échoue (coupure), le bandeau
    // reste : c'est lui qui porte l'information, et le médecin verra l'appel
    // expirer plutôt qu'un faux « remis ».
    void marquerAppelRemis(appel.callId);
  }, [appel.callId, appel.callerName]);

  // Expiration : le bandeau se retire seul, sans exiger de geste.
  useEffect(() => {
    const echeance = Date.parse(appel.expireLe);
    if (Number.isNaN(echeance)) return;
    const delai = Math.max(0, echeance - Date.now() + GRACE_MS);
    const minuteur = setTimeout(() => {
      void arreterClignotement();
      onExpirer();
    }, delai);
    return () => clearTimeout(minuteur);
  }, [appel.expireLe, onExpirer]);

  async function repondre(): Promise<void> {
    if (envoi || acquitte) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await onAcquitter(appel.callId);
      setAcquitte(true);
      void arreterClignotement();
    } catch {
      // On ne prétend PAS avoir répondu : le bandeau reste, le médecin continue
      // d'attendre, et le message dit que la réponse n'est pas partie.
      setErreur(fr.collaboration.alerteRecue.echec);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-attention bg-attention-bg px-4 py-3 shadow-lift2"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card font-ui text-heading font-bold text-attention-ink shadow-douce"
      >
        !
      </span>

      <div className="min-w-0 flex-1">
        <p className="m-0 font-ui text-body font-semibold text-attention-ink">
          {fr.collaboration.alerteRecue.titre}
        </p>
        <p className="m-0 font-ui text-label text-attention-ink">
          {fr.collaboration.alerteRecue.avant} {appel.callerName}
          {heure(appel.creeLe) !== null ? ` · ${heure(appel.creeLe)}` : ""}
        </p>
        {erreur !== null ? (
          <p role="status" className="m-0 font-ui text-label text-attention-ink">
            {erreur}
          </p>
        ) : null}
      </div>

      {acquitte ? (
        <p role="status" className="m-0 font-ui text-body font-medium text-positive">
          {fr.collaboration.alerteRecue.acquittee}
        </p>
      ) : (
        <Bouton rang="principal" taille="compact" onClick={() => void repondre()} chargement={envoi}>
          {fr.collaboration.alerteRecue.jarrive}
        </Bouton>
      )}
    </section>
  );
}
