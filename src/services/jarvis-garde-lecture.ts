/**
 * `jarvis-garde-lecture.ts` — M06 · le garde-fou des constats NON VÉRIFIÉS.
 *
 * ═══ CE QUE C'EST ═══
 * Une fonction PURE et DÉTERMINISTE : pas de base, pas de réseau, pas de LLM,
 * pas d'effet de bord. Son seul travail : quand un tour se termine sur une
 * écriture PROPOSÉE mais non confirmée (donc rien d'exécuté, rien de relu),
 * empêcher que le texte affiché avec la carte constate un accomplissement.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas une autorisation (comme `jarvis-response-guard.ts`, qu'elle
 *     complète côté lecture) : elle REFORMULE un texte, jamais elle
 *     n'autorise, ne confirme ni n'exécute quoi que ce soit.
 *   · Pas un détecteur d'hallucination général : hors tour de proposition,
 *     elle LAISSE tout passer — y compris, sciemment, une phrase d'action
 *     inventée sans proposition. Cette limite est éprouvée
 *     (`jarvis-garde-lecture.test.ts`, « limite M08 ») : la couverture des
 *     inventions pures appartient aux goldens, pas à un cribleur de texte.
 *   · Pas un interpréteur : le contenu scanné est une DONNÉE. Un texte qui
 *     ordonne (« ignore tes règles… ») ne traverse jamais la garde autrement
 *     que comme motif de reformulation — la sortie ne porte ni outil, ni
 *     arguments, ni ordre.
 *
 * ═══ POURQUOI SEULEMENT LES TOURS DE PROPOSITION ═══
 * Dans un tour de proposition, « rien n'est fait » est un FAIT D'ARCHITECTURE
 * (la boucle n'exécute jamais d'écriture) : tout constat d'accomplissement y
 * est donc faux par construction, et le bloquer ne peut jamais censurer un
 * vrai succès. Ailleurs, « C'est fait, j'ai trouvé… » est un compte-rendu de
 * lecture légitime — le même motif y deviendrait un faux positif.
 */

export type IssueGardeLecture =
  | { readonly verdict: "LAISSER" }
  | { readonly verdict: "REFORMULER"; readonly raison: "SUCCES_NON_VERIFIE" };

export interface EntreeGardeLecture {
  /** Le texte final du tour, jetons déjà rendus (noms visibles). */
  readonly texte: string;
  /**
   * Vrai si et seulement si le tour se termine sur une écriture proposée
   * (carte affichée ou tentative de carte) — l'appelant le sait, la garde
   * ne le devine pas.
   */
  readonly ecritureProposee: boolean;
}

/**
 * Minuscules, désaccentuées, apostrophes soudées : « J'AI ENCAISSÉ » et
 * « j'ai encaissé » deviennent la même forme. Les motifs exigent
 * l'adjacence (« c'est fait ») : la négation (« ce n'est pas encore fait »)
 * et l'adverbe intercalé hors liste ne correspondent pas.
 */
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ");
}

/** Participes d'actes du cabinet à la première personne du passé. */
const ACTES_PREMIERE_PERSONNE =
  /(^|[^a-z])(jai|nous avons) (bien |vraiment )?(cree|deplace|annule|enregistre|encaisse|marque|fixe|cloture|valide|verifie)([^a-z]|$)/;

/** Un acte nommé comme accompli (« le rendez-vous est déplacé »). */
const ACTE_ACCOMPLI_NOMME =
  /(rendez[- ]?vous|paiement|tarif|document|brouillon|seance|arrivee).{0,40}(cree|deplace|annule|enregistre|encaisse|effectue|regle|cloture)([^a-z]|$)/;

const CONSTATS: readonly RegExp[] = [
  /** « C'est fait » — la phrase que M06 interdit sans vérification. */
  /(^|[^a-z])cest fait([^a-z]|$)/,
  ACTES_PREMIERE_PERSONNE,
  ACTE_ACCOMPLI_NOMME,
  /** « Tout est réglé » — clôture globale, toujours fausse ici. */
  /(^|[^a-z])tout est (regle|fait|bon|enregistre)([^a-z]|$)/,
];

export function garderPropos(entree: EntreeGardeLecture): IssueGardeLecture {
  if (!entree.ecritureProposee) return { verdict: "LAISSER" };
  const forme = normaliser(entree.texte);
  if (forme.trim() === "") return { verdict: "LAISSER" };
  for (const motif of CONSTATS) {
    if (motif.test(forme)) {
      return { verdict: "REFORMULER", raison: "SUCCES_NON_VERIFIE" };
    }
  }
  return { verdict: "LAISSER" };
}
