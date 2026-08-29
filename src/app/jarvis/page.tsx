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
import { useSessionEcran } from "@/components/useSessionEcran";
import { BandeauHorsLigne, BlocErreur, LienBouton, Squelette } from "@/components/ui";
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
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-3">
        {/* En-tête sobre : l'orbe suffit à identifier qui parle ici. */}
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-flex h-8 w-8 shrink-0 rounded-full bg-grad-orb shadow-glow-ai" />
          <h1 className="m-0 font-ui text-heading font-semibold text-ink-900">{fr.jarvis.titre}</h1>
        </div>

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
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <FilJarvis etat={etat} />
          </div>
        )}

        {/* Amorces — visibles seulement sur conversation vide ; chaque clic
            remplit le champ, où la phrase reste éditable avant envoi. */}
        {etat.tours.length === 0 && !etat.chargementHistorique && (
          <div className="flex flex-wrap gap-2">
            {[fr.jarvis.amorce1, fr.jarvis.amorce2, fr.jarvis.amorce3].map((amorce) => (
              <button
                key={amorce}
                type="button"
                onClick={() => choisirAmorce(amorce)}
                className="cursor-pointer rounded-full border border-rule bg-card px-3 py-1.5 font-ui text-label text-ink-700 shadow-lift0 transition duration-quick ease-soft hover:bg-sunken hover:text-ink-900"
              >
                {amorce}
              </button>
            ))}
          </div>
        )}

        <footer className="border-t border-rule pt-3">
          <SaisieJarvis
            etat={etat}
            onEnvoyer={soumettre}
            onChangerSaisie={changerSaisie}
            onInterrompre={interrompre}
          />
        </footer>
      </div>
    </AppShell>
  );
}
