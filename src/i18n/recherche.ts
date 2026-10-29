/**
 * Libellés partagés de la recherche instantanée (médicaments, patients).
 *
 * ⚠️ Ces textes ne vivent PAS dans `fr.ts` : le god-file est gelé (AGENTS.md
 * §7) et la recherche est une surface transversale. Un fichier dédié garde les
 * deux écrans alignés sans rouvrir la découpe de Phase 6.
 */
export const recherche = {
  minimum: "Tapez au moins 2 caractères.",
  chargement: "Recherche…",
  miseAJour: "Mise à jour…",
  aucunMedicament: "Aucun médicament ne correspond à cette recherche.",
  aucunPatient: "Aucun dossier ne correspond à cette recherche.",
  approximatif: "Aucun résultat exact — résultats approximatifs.",
  afficherPlus: "Afficher plus",
  toutAffiche: "Tous les résultats sont affichés.",
  resultats: "résultats",
  resultat: "résultat",
  fermer: "Fermer la liste",
  ouvrirFiche: "Ouvrir la fiche",
  precedent: "Précédent",
  suivant: "Suivant",
  page: "Page",
  sur: "sur",
} as const;

export function compteResultats(total: number): string {
  return `${total} ${total > 1 ? recherche.resultats : recherche.resultat}`;
}
