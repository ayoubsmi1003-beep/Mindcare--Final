/**
 * LA COLONNE DE DROITE — la caisse, les nouveaux dossiers, et Jarvis.
 *
 * Trois cartes, trois niveaux DIFFÉRENTS, et c'est voulu : `financier` porte un
 * montant, `clinique` porte un compte, `ia` porte une proposition. Trois cartes
 * identiques auraient donné à l'œil trois choses de même nature — alors qu'une
 * seule des trois demande une décision.
 */

import { useState } from "react";

import { Bouton, Carte, EtatVide, LienBouton, PastilleIcone } from "@/components/ui";
import { SiriOrb } from "@/components/ui/siri-orb";
import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import { executerEcritureConfirmee } from "@/services/jarvis-execution";
import { confirmerAction, refuserAction } from "@/services/jarvis-tools";

import type { CaisseDuJour, PropositionJarvis } from "@/services/dashboard";

function Intitule({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="font-ui text-label font-medium tracking-label text-ink-500">
      {children}
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA CAISSE DU JOUR
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ « ENCAISSÉ », PAS « RECETTE ». La porte 059 compte les paiements dont
 * `collected_at` n'est pas nul ; le mot affiché dit exactement cela. Afficher
 * le montant FACTURÉ sous ce libellé serait faux un jour sur deux, et c'est
 * précisément le genre d'écart qu'une praticienne ne peut pas détecter à
 * l'écran.
 *
 * ⚠️ AUCUN OBJECTIF, AUCUN POURCENTAGE, AUCUNE COMPARAISON. Q14 a tranché :
 * l'objectif mensuel est décoratif, donc absent. Un anneau de progression à
 * 68 % sur un écran médical n'est pas un ornement, c'est un chiffre inventé.
 *
 * ⚠️ `caisse === null` N'EST PAS ZÉRO. C'est « hors de votre périmètre »
 * (ADR-005). La carte n'est alors pas rendue du tout — afficher « 0 DZD » à
 * l'assistante lui apprendrait une information fausse sur la journée du
 * cabinet.
 */
export function CarteCaisse({
  caisse,
}: {
  readonly caisse: CaisseDuJour | null;
}): React.JSX.Element | null {
  if (caisse === null) return null;

  const perimetre =
    caisse.perimetre === "cabinet"
      ? fr.tableauDeBord.caisse.perimetreCabinet
      : fr.tableauDeBord.caisse.perimetrePraticienne;

  return (
    <Carte niveau="financier">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Intitule>{fr.tableauDeBord.caisse.titre}</Intitule>
            <p className="font-ui text-label font-medium text-ink-500">{perimetre}</p>
          </div>
          <PastilleIcone nom="finances" ton="action" taille="grande" />
        </div>

        {caisse.seances === 0 ? (
          <p className="font-ui text-body font-regular text-ink-500">{fr.tableauDeBord.caisse.rien}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="font-num text-metric font-semibold tabular-nums text-ink-900">
              {formaterDzd(caisse.montantDzd)}
            </p>
            <p className="font-ui text-label font-medium text-ink-500">
              {fr.tableauDeBord.caisse.seances.replace("{nombre}", String(caisse.seances))}
            </p>
          </div>
        )}

        <LienBouton href="/finances" rang="discret">
          {fr.tableauDeBord.caisse.voirFinances}
        </LienBouton>
      </div>
    </Carte>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LES NOUVEAUX DOSSIERS DU MOIS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un compte, et rien d'autre. Pas de « +2 vs juin » : la porte ne calcule aucune
 * période de référence, et une variation inventée est un chiffre inventé.
 */
export function CarteNouveauxPatients({
  nombre,
}: {
  readonly nombre: number;
}): React.JSX.Element {
  return (
    <Carte niveau="clinique">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <Intitule>{fr.tableauDeBord.nouveaux.titre}</Intitule>
          <PastilleIcone nom="patients" ton="info" taille="grande" />
        </div>

        {nombre === 0 ? (
          <p className="font-ui text-body font-regular text-ink-500">{fr.tableauDeBord.nouveaux.aucun}</p>
        ) : (
          <p className="font-num text-metric font-semibold tabular-nums text-ink-900">
            {nombre}
          </p>
        )}

        <LienBouton href="/patients" rang="discret">
          {fr.tableauDeBord.nouveaux.voirPatients}
        </LienBouton>
      </div>
    </Carte>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CE QUE JARVIS A PROPOSÉ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ AUCUNE PROPOSITION N'EST FABRIQUÉE ICI, NI AILLEURS. Il n'existe aucun
 * agent de fond dans ce produit : ces lignes viennent d'une conversation réelle
 * avec Jarvis, restée sans réponse. La carte vide est le cas NORMAL — et elle
 * le dit, au lieu de faire croire qu'une intelligence a veillé pendant la nuit.
 *
 * ⚠️ L'ORDRE PROPOSER → CONFIRMER → EXÉCUTER → VÉRIFIER → JOURNALISER N'EST PAS
 * NÉGOCIABLE (règle 7). `confirmerAction` pose `confirmed_at` AVANT que le
 * chemin partagé (`executerEcritureConfirmee`, M06) ne touche quoi que ce
 * soit, et la contrainte `jarvis_must_confirm` (012) refuse l'inverse en base.
 * Ce composant ne fait qu'appeler dans l'ordre : ce n'est pas lui qui garantit
 * la règle, c'est la base — et « confirmée » ne s'affiche que sur succès
 * prouvé (exécution + relecture + garde).
 *
 * ⚠️ UN ÉCHEC, UN NON-VÉRIFIÉ, UN INCONNU OU UN DOUBLON N'EST JAMAIS AFFICHÉ
 * COMME UN SUCCÈS. L'issue partagée rend alors son message honnête, jamais
 * « action effectuée ».
 */
function LibelleProposition({
  proposition,
}: {
  readonly proposition: PropositionJarvis;
}): React.JSX.Element {
  // Les outils d'écriture (registre `jarvis-ecritures.ts`, sept admis par 063)
  // ont déjà leur phrase en français dans `fr.jarvis.carte` — celle de la
  // carte de confirmation. On la RÉUTILISE : deux libellés pour la même action
  // se mettraient à diverger.
  const titre =
    proposition.toolName === "create_appointment"
      ? fr.jarvis.carte.creerRendezVous
      : proposition.toolName === "set_consultation_price"
        ? fr.jarvis.carte.fixerTarif
        : proposition.toolName;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="font-ui text-body font-medium text-ink-900">{titre}</p>
      {/* Ce que la praticienne a RÉELLEMENT dit. C'est la seule chose qui
          justifie la proposition — la masquer rendrait la confirmation aveugle. */}
      <p className="line-clamp-2 font-ui text-label text-ink-500">
        « {proposition.userUtterance} »
      </p>
    </div>
  );
}

export function CartePropositions({
  propositions,
  onMutation,
}: {
  readonly propositions: readonly PropositionJarvis[];
  /** Rechargement du tableau après une décision — la vérité revient de la base. */
  readonly onMutation: () => void;
}): React.JSX.Element {
  const [enCours, setEnCours] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);

  async function confirmer(id: string): Promise<void> {
    setEnCours(id);
    setMessage(undefined);

    // ÉTAPE 1 — poser `confirmed_at`. Si elle échoue, on n'exécute rien.
    const confirmation = await confirmerAction(id);
    if (!confirmation.ok) {
      setEnCours(undefined);
      setMessage(confirmation.error.message);
      return;
    }

    // ÉTAPES 2–4 — exécuter, relire, garder : le MÊME chemin partagé que la
    // conversation (`jarvis-execution.ts`). Les arguments canoniques viennent
    // de la porte `dashboard_today` (dérivés serveur de la ligne persistée),
    // jamais d'un état d'écran. « Confirmée » ne s'affiche que sur succès
    // prouvé ; sinon le message honnête de l'issue (échec, non-vérifié,
    // inconnu, doublon) — jamais « action effectuée » sur du non-prouvé.
    const proposition = propositions.find((p) => p.id === id);
    const issue = await executerEcritureConfirmee({
      actionId: id,
      outil: proposition?.toolName ?? "inconnu",
      argsCanoniques: proposition?.toolArgs ?? null,
    });
    setEnCours(undefined);
    setMessage(issue.ok ? fr.tableauDeBord.jarvis.confirmee : issue.message);
    onMutation();
  }

  async function refuser(id: string): Promise<void> {
    setEnCours(id);
    setMessage(undefined);
    const resultat = await refuserAction(id);
    setEnCours(undefined);
    setMessage(resultat.ok ? fr.tableauDeBord.jarvis.refusee : resultat.error.message);
    onMutation();
  }

  /* ══════════════════════════════════════════════════════════════════════
     V8 — L'IDENTITÉ D'ALEXA, ET LA LIGNE QUI LA BORNE
     ══════════════════════════════════════════════════════════════════════

     LE CAS VIDE prend la surface profonde d'assistante : dégradé violet,
     reflet, orbe dessiné, encre blanche pure. C'est le seul endroit du
     tableau de bord où Alexa a un visage, et c'est là qu'il faut qu'elle en
     ait un — une carte lavande pâle avec une phrase grise ne dit rien de ce
     qu'est cet assistant.

     ⚠️ LE CAS PLEIN RESTE OPAQUE, ET CE N'EST PAS UNE INCOHÉRENCE.
     Une proposition porte `userUtterance` — la phrase réellement prononcée
     par la praticienne, qui contient très souvent un nom de patient, une
     date de rendez-vous ou un montant. §4.2 interdit le dégradé derrière une
     donnée nominative. La carte vide ne porte AUCUNE donnée : elle annonce
     un outil. Les deux surfaces diffèrent donc parce que leur CONTENU
     diffère, ce qui est exactement la règle, et non malgré elle. */
  if (propositions.length === 0) {
    return (
      /* ⚠️ RETOUR UTILISATEUR — L'ICÔNE PRÉCÉDENTE (anneaux concentriques,
         `Scene assistanteAuRepos`) SE LISAIT COMME UN LOGO CASSÉ, PAS COMME
         UN ASSISTANT. Corrigée pour une vraie SPHÈRE — un dégradé radial
         `bg-orbe-aurore` avec un halo diffusé derrière elle, exactement le
         matériau que porte l'orbe réel de la voix (`OrbeVoix`, même famille
         de dégradé `--grad-orb`). Les deux se ressemblent maintenant :
         c'est la même identité vue au repos et vue en écoute.
         Hauteur du panneau également réduite (p-6→p-5, gap-4→gap-3) : c'est
         un panneau de contexte parmi d'autres, pas un écran à lui seul. */
      <section className="relative flex h-full min-h-56 flex-col items-center justify-center overflow-hidden rounded-2xl bg-vedette-ia p-5 text-center shadow-vedette">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-reflet" />
        <div className="relative flex flex-col items-center gap-3">
          {/* ⚠️ `opacity-60` ET `blur-lg` N'EXISTENT PAS DANS CE DÉPÔT — l'échelle
              d'opacité est FERMÉE (0 / disabled=.5 / filigrane / 100) et celle
              de flou ne porte que `glass`. Les deux auraient émis zéro règle,
              en silence. Le halo utilise donc `opacity-disabled` (jeton réel)
              et un flou en style inline, seule échappatoire pour une valeur
              sans jeton dédié — un halo décoratif n'a pas de sens design à
              codifier en jeton nommé. */}
          <span aria-hidden="true" className="relative flex h-16 w-16 items-center justify-center">
            <SiriOrb
              size="64px"
              animationDuration={18}
            />
          </span>
          <p className="font-editorial text-heading font-semibold tracking-title text-on-brand">
            {fr.tableauDeBord.jarvis.titre}
          </p>
          <p className="max-w-lecture font-ui text-label font-medium text-on-brand">
            {fr.tableauDeBord.jarvis.vide}
          </p>
        </div>
      </section>
    );
  }

  return (
    <Carte niveau="ia">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <Intitule>{fr.tableauDeBord.jarvis.titre}</Intitule>
          <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <SiriOrb
              size="32px"
              animationDuration={18}
            />
          </span>
        </div>

        <ul className="flex flex-col gap-4">
          {propositions.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 border-t border-ai-100 pt-4 first:border-0 first:pt-0">
              <LibelleProposition proposition={p} />
              <div className="flex flex-wrap gap-3">
                <Bouton
                  rang="principal"
                  onClick={() => void confirmer(p.id)}
                  disabled={enCours !== undefined}
                >
                  {fr.tableauDeBord.jarvis.examiner}
                </Bouton>
                <Bouton
                  rang="discret"
                  onClick={() => void refuser(p.id)}
                  disabled={enCours !== undefined}
                >
                  {fr.tableauDeBord.jarvis.refuser}
                </Bouton>
              </div>
            </li>
          ))}
        </ul>

        {/* `role="status"` : la décision est annoncée au lecteur d'écran, qui
            n'a pas vu la carte disparaître. */}
        {message === undefined ? null : (
          <p role="status" className="font-ui text-label text-ink-700">
            {message}
          </p>
        )}
      </div>
    </Carte>
  );
}
