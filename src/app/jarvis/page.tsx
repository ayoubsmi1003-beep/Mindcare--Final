"use client";

/**
 * /jarvis — la conversation en PLEIN ÉCRAN, composition Lune. V-JARVIS-CORE.
 *
 * Le même store que le panneau : arriver ici ne coupe rien, repartir non plus.
 * Présentation 21st.dev (lune émeraude, titre centré, saisie en verre sombre,
 * pastilles) ; gestes et sécurité MindCare inchangés.
 *
 * ═══ CE QUI EST PRÉSERVÉ ═══
 * `conversation.ts` (envoyer / interrompre / carte / historique), dictée
 * presser-pour-parler relue avant envoi, `FilJarvis` tel quel dans une feuille
 * claire opaque (§4.2 : les mentions secondaires gardent leurs contrastes
 * mesurés), `CarteConfirmation`, erreur nommée, hors-ligne, disclaimer
 * permanent, Esc du panneau, BulleAlexa globale.
 *
 * ═══ CE QUI CHANGE, ET POURQUOI ═══
 * - `sansGouttiere` : la scène sombre remplit le <main>. Le rail RESTE monté :
 *   depuis V7/V8 c'est un chrome sombre, plus un cadre clair — l'écran
 *   appartient à la navigation comme les autres, l'entrée « Alexa » s'y
 *   allume. La scène remappe les jetons papier vers la nuit (`tokens.css`) :
 *   le fil partagé `FilJarvis` y rend ses contrastes mesurés, sans variante.
 * - Pleine largeur : la colonne `max-w-lecture` ne porte plus le défilement —
 *   chaque zone la recentre elle-même, donc la barre vit au bord extrême du
 *   <main> et le Retour part du bord gauche de la scène.
 * - Aucune image externe : la lune est recréée en dégradés dans `tokens.css`
 *   (local-first, poste sans réseau). Aucune dépendance ajoutée (pas de
 *   lucide/shadcn : `Icone` + `cn` locaux).
 * - État vide : héros + saisie + 8 pastilles (remplissent le champ, éditables).
 *   Dès le premier tour : le héros s'efface, le fil apparaît au-dessus d'une
 *   saisie collée en bas — la référence ne connaît que l'état vide.
 *
 * Client-only, comme /documents : l'historique est lu par la porte
 * `get_jarvis_history` sur geste, jamais au rendu serveur.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { HeroAlexaLune, PastillesAlexaLune } from "@/components/AlexaLune";
import { CarteConfirmation } from "@/components/CarteConfirmation";
import { FilJarvis } from "@/components/FilJarvis";
import { SaisieAlexaLune } from "@/components/SaisieAlexaLune";
import { Icone } from "@/components/ui/Icones";
import { useSessionEcran } from "@/components/useSessionEcran";
import { BandeauHorsLigne, BlocErreur, LienBouton, Squelette } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  abonnerConversation,
  accepterCarte,
  changerSaisie,
  chargerHistorique,
  envoyer,
  interrompre,
  refuserCarte,
  type EtatConversationPublique,
} from "@/services/conversation";

export default function JarvisPage(): React.JSX.Element {
  const router = useRouter();
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

  const choisirAmorce = useCallback((amorce: string) => {
    changerSaisie(amorce);
  }, []);

  const retourner = useCallback(() => {
    router.push("/tableauDeBord");
  }, [router]);

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

  const vide = etat.tours.length === 0 && !etat.chargementHistorique;

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      sansGouttiere
      sansDefilement
    >
      {/* La scène remplit le <main> borné (`sansDefilement` : <main> en
          `overflow-hidden` + colonne flex) — jamais `min-h-viewport` (100vh),
          qui dépassait le <main> de la hauteur barre+bandeau et forçait le
          défilement externe. Ici seule la zone du fil défile (voir plus bas). */}
      <div className="lune-alexa-scene relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <span aria-hidden="true" className="lune-alexa-fond pointer-events-none absolute inset-0" />
        <span aria-hidden="true" className="lune-alexa-horizon pointer-events-none" />

        {/* Pleine largeur : le contenu se centre lui-même (`max-w-lecture`
            sur chaque zone), donc la barre de défilement vit au bord extrême
            du <main> — pas au bord de la colonne — et le Retour part du bord
            gauche de la scène. */}
        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col">
          <div className="flex shrink-0 justify-start px-4 py-4">
            <button
              type="button"
              onClick={retourner}
              aria-label="Retour au tableau de bord"
              title="Retour au tableau de bord"
              className="inline-flex min-h-target cursor-pointer items-center gap-2 rounded-full border border-night-rule px-4 font-ui text-label text-night-ink-soft transition duration-quick ease-soft hover:bg-chrome-survol hover:text-night-ink"
            >
              <span className="inline-flex" style={{ transform: "rotate(180deg)" }}>
                <Icone nom="chevron" taille={16} />
              </span>
              Retour
            </button>
          </div>

          {horsLigneSession ? <BandeauHorsLigne /> : null}

          {/* L'erreur nommée du dernier tour — au-dessus du fil, jamais bloquante. */}
          {etat.erreur !== null && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-md border border-attention bg-attention-bg px-4 py-2"
            >
              <p className="m-0 min-w-0 flex-1 font-ui text-label text-ink-700">{etat.erreur.message}</p>
            </div>
          )}

          {vide ? (
            /* ÉTAT VIDE : UNE SEULE colonne déroulante (héros + saisie).
               La saisie `shrink-0` affamait le héros quand les 8 pastilles
               dépassaient la hauteur (mobile : boîte de 32 px, héros peint
               SOUS la saisie). Ici `min-h-full` + `m-auto` : le héros se
               centre quand il y a la place, tout défile quand il n'y en a
               pas — rien n'est ni rogné ni recouvert. Sur grand écran le
               rendu est inchangé (héros centré, saisie en bas). */
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex min-h-full w-full max-w-lecture flex-col items-center px-4">
                <div className="m-auto flex flex-col items-center py-4">
                  <HeroAlexaLune etat={etat} />
                </div>
                <div className="lune-alexa-bas w-full shrink-0 pt-2">
                  <SaisieAlexaLune
                    etat={etat}
                    onEnvoyer={soumettre}
                    onChangerSaisie={changerSaisie}
                    onInterrompre={interrompre}
                  />
                  <div className="mt-6">
                    <PastillesAlexaLune onChoisir={choisirAmorce} />
                  </div>
                  <p className="m-0 mt-3 text-center font-ui text-label text-night-ink-soft">
                    {fr.disclaimer}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* SEULE zone déroulante de l'écran : le fil. La saisie et la
                  barre supérieure restent fixes, le <main> ne défile jamais. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-lecture px-4 py-4">
                  {/* Feuille de nuit opaque : `bg-night-card` explicite, `FilJarvis`
                      suit par le remappage de la scène (`tokens.css`) — contrastes
                      mesurés conservés, aucune donnée sur dégradé (§4.2). */}
                  <div className="rounded-2xl border border-night-rule bg-night-card p-4 shadow-carte desktop:p-6">
                    {etat.chargementHistorique ? <Squelette lignes={6} /> : <FilJarvis etat={etat} />}
                  </div>
                </div>
              </div>
              <div className="lune-alexa-colle mx-auto w-full max-w-lecture shrink-0 px-4 pb-6 pt-8">
                <SaisieAlexaLune
                  etat={etat}
                  onEnvoyer={soumettre}
                  onChangerSaisie={changerSaisie}
                  onInterrompre={interrompre}
                />
                <p className="m-0 mt-3 text-center font-ui text-label text-night-ink-soft">
                  {fr.disclaimer}
                </p>
              </div>
            </>
          )}

          {etat.carteEcriture !== null && (
            /* La carte flotte AU-DESSUS de la scène : une décision d'écriture
               n'est pas un message parmi d'autres. */
            <div className="absolute inset-x-4 bottom-4 z-10 mx-auto max-w-lecture">
              <CarteConfirmation
                carte={etat.carteEcriture}
                enCours={false}
                onConfirmer={() => void accepterCarte()}
                onAnnuler={() => void refuserCarte()}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
