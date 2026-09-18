"use client";

/**
 * /jarvis — la conversation en PLEIN ÉCRAN. V-JARVIS-CORE.
 *
 * Le même store que le panneau : arriver ici ne coupe rien, repartir non plus.
 * Ce que l'écran ajoute au panneau : de la place (bulles larges, historique
 * long lisible) et les amorces cliquables — trois gestes réels, jamais un
 * contenu décoratif.
 *
 * ═══ POURQUOI TOUT EST CLIENT, COMME /documents ════════════════════════════
 * L'historique est lu par la porte `get_jarvis_history` sous JWT, à l'initiative
 * d'un geste (ouvrir l'écran). Un rendu serveur produirait cette lecture au
 * chargement de la ROUTE — une trace « elle a relu sa conversation » écrite
 * parce qu'une URL a été ouverte. Même raison, même décision que /documents.
 *
 * ═══ LE RÔLE ═══
 * La navigation n'expose `/jarvis` qu'aux praticiennes (rail). Ici, on ne fait
 * PAS de second contrôle de rôle : ce composant n'affiche aucune donnée que la
 * porte n'ait déjà filtrée par RLS — et un garde côté client ne serait de toute
 * façon pas une frontière (règle 4).
 */

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { FilJarvis } from "@/components/FilJarvis";
import { SaisieJarvis } from "@/components/SaisieJarvis";
import { SiriOrb } from "@/components/ui/siri-orb";
import { useSessionEcran } from "@/components/useSessionEcran";
import { BandeauHorsLigne, BlocErreur, Bouton, LienBouton, Squelette } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  abonnerConversation,
  changerSaisie,
  chargerHistorique,
  envoyer,
  interrompre,
  type EtatConversationPublique,
} from "@/services/conversation";

export default function JarvisPage(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [etat, setEtat] = useState<EtatConversationPublique | null>(null);
  useEffect(() => abonnerConversation(setEtat), []);

  // Une seule lecture d'historique par montée — le store refuse les doublons.
  useEffect(() => {
    if (utilisateur === undefined || utilisateur === null) return;
    void chargerHistorique();
  }, [utilisateur]);

  const soumettre = useCallback(() => {
    if (etat === null) return;
    void envoyer(etat.saisie);
  }, [etat]);

  const choisirAmorce = useCallback(
    (amorce: string) => {
      changerSaisie(amorce);
    },
    [],
  );

  // ── Garde de session — identique aux autres écrans ──────────────────────────
  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={4} />
      </main>
    );
  }
  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  if (etat === null) {
    return (
      <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter}>
        <Squelette lignes={6} />
      </AppShell>
    );
  }

  return (
    <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter}>
      {/* Fond Alexa — aurora verte, le fil restant opaque (§4.2 : noms,
          dates et montants jamais sur dégradé). */}
      <div className="relative -m-4 min-h-full overflow-hidden p-4">
        <span
          aria-hidden="true"
          className="fond-aurore-alexa pointer-events-none absolute inset-0"
        />
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-lecture flex-col gap-4">
        {/*
          ALEXA RUIXEN-VERT — hero centré menthe : gros orbe émeraude à états,
          titre unique, disclaimer. Pas de 2e launcher ici (bulle globale).
        */}
        <header className="relative flex shrink-0 flex-col items-center gap-3 overflow-hidden rounded-3xl bg-vedette-vert px-5 py-8 text-center shadow-vedette">
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-reflet" />
          <span aria-hidden className="relative inline-flex h-24 w-24 animate-flottement-doux items-center justify-center overflow-hidden rounded-full motion-reduce:animate-none">
            <SiriOrb
              size="96px"
              etat={etat.carteEcriture !== null ? "ecoute" : "idle"}
            />
          </span>
          <h2 className="relative m-0 font-ui text-title font-semibold text-on-brand">
            Alexa
          </h2>
          <p className="relative m-0 max-w-lecture font-ui text-label font-medium text-on-brand">
            {fr.disclaimer}
          </p>
        </header>

        {horsLigneSession ? <BandeauHorsLigne /> : null}

        {/* L'erreur nommée du dernier tour — même traitement que le panneau :
            une ligne au-dessus du fil, jamais bloquante. */}
        {etat !== null && etat.erreur !== null && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-attention bg-attention-bg px-4 py-2">
            <p className="m-0 min-w-0 flex-1 font-ui text-label text-ink-700">{etat.erreur.message}</p>
          </div>
        )}

        {etat.chargementHistorique ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Squelette lignes={6} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-rule bg-card p-4 shadow-carte">
            <FilJarvis etat={etat} />
          </div>
        )}

        {/* Amorces — visibles seulement sur conversation vide ; chaque clic
            remplit le champ, où la phrase reste éditable avant envoi. */}
        {etat.tours.length === 0 && !etat.chargementHistorique && (
          <div className="flex flex-wrap justify-center gap-2">
            {[fr.jarvis.amorce1, fr.jarvis.amorce2, fr.jarvis.amorce3].map((amorce) => (
              <Bouton
                key={amorce}
                type="button"
                rang="secondaire"
                taille="compact"
                onClick={() => choisirAmorce(amorce)}
              >
                <span className="truncate">{amorce}</span>
              </Bouton>
            ))}
          </div>
        )}

        <footer className="rounded-3xl border border-rule bg-glass-panel px-4 pb-4 pt-3 shadow-elevee backdrop-blur-glass">
          <SaisieJarvis
            etat={etat}
            onEnvoyer={soumettre}
            onChangerSaisie={changerSaisie}
            onInterrompre={interrompre}
          />
          <p className="m-0 mt-2 text-center font-ui text-label text-ink-500">{fr.disclaimer}</p>
        </footer>
      </div>
      </div>
    </AppShell>
  );
}
