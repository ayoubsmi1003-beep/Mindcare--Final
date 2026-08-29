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
import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import { confirmerAction, executerAction, refuserAction } from "@/services/jarvis-tools";

import type { CaisseDuJour, PropositionJarvis } from "@/services/dashboard";

function Intitule({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="font-ui text-eyebrow font-bold uppercase tracking-eyebrow text-ink-500">
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
          <p className="font-ui text-body font-regular leading-relaxed text-ink-500">{fr.tableauDeBord.caisse.rien}</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="font-display text-display font-bold tabular-nums tracking-tight text-ink-900">
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
          <p className="font-ui text-body font-regular leading-relaxed text-ink-500">{fr.tableauDeBord.nouveaux.aucun}</p>
        ) : (
          <p className="font-display text-display font-bold tabular-nums tracking-tight text-ink-900">
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
 * ⚠️ L'ORDRE PROPOSER → CONFIRMER → EXÉCUTER → JOURNALISER N'EST PAS NÉGOCIABLE
 * (règle 7). `confirmerAction` pose `confirmed_at` AVANT que `executerAction`
 * ne touche quoi que ce soit, et la contrainte `jarvis_must_confirm` (012)
 * refuse l'inverse en base. Ce composant ne fait qu'appeler les deux dans
 * l'ordre : ce n'est pas lui qui garantit la règle, c'est la base.
 *
 * ⚠️ UN ÉCHEC N'EST JAMAIS AFFICHÉ COMME UN SUCCÈS. `executerAction` rend une
 * erreur quand la porte a basculé la ligne en `failed` ; on affiche alors le
 * message de la couche service, jamais « action effectuée ».
 */
function LibelleProposition({
  proposition,
}: {
  readonly proposition: PropositionJarvis;
}): React.JSX.Element {
  // Les deux seuls outils qui écrivent (`OUTILS_ECRITURE`) ont déjà leur phrase
  // en français dans `fr.jarvis.carte` — celle de la carte de confirmation. On
  // la RÉUTILISE : deux libellés pour la même action se mettraient à diverger.
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

    // ÉTAPE 2 — exécuter, et seulement maintenant.
    const execution = await executerAction(id);
    setEnCours(undefined);
    setMessage(execution.ok ? fr.tableauDeBord.jarvis.confirmee : execution.error.message);
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

  if (propositions.length === 0) {
    return (
      <EtatVide
        icone="jarvis"
        titre={fr.tableauDeBord.jarvis.titre}
        message={fr.tableauDeBord.jarvis.vide}
      />
    );
  }

  return (
    <Carte niveau="ia">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <Intitule>{fr.tableauDeBord.jarvis.titre}</Intitule>
          <PastilleIcone nom="jarvis" ton="ia" />
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
