/**
 * Libellés de la synthèse longitudinale.
 *
 * `fr.ts` est gelé (Phase 6) : les nouveaux libellés de cette surface vivent ici
 * et restent typés. Aucune chaîne clinique n'est inventée par ce fichier.
 */
export const patientSummary = {
  eyebrow: "Synthèse clinique",
  titre: "Résumé du cas",
  actualiser: "Actualiser",
  generation: "Actualisation de la synthèse…",
  videTitre: "Aucune synthèse enregistrée",
  videCorps:
    "La synthèse se compose à partir des consultations, diagnostics, traitements et évaluations déjà enregistrés.",
  generer: "Générer la synthèse",
  indisponibleTitre: "Synthèse momentanément indisponible",
  indisponibleCorps:
    "Les données du dossier restent consultables. Vous pouvez relancer la synthèse.",
  reessayer: "Réessayer",
  modifieDepuis: "Le dossier a changé depuis cette synthèse.",
  aJour: "À jour",
  vigilance: "Points de vigilance",
  sources: "Sources de la synthèse",
  fermerSources: "Masquer les sources",
  sourceCount: (label: string, count: number): string =>
    `${label} (${String(count)})`,
  consulter: "Consulter",
  disclaimer:
    "Aide à la décision — le jugement clinique appartient à la praticienne.",
  ancienneSynthese: "Éléments de la synthèse antérieure",
  seancesPassees: "Séances précédentes",
  aucunPoint: "Aucun point de vigilance consigné.",
  sourceLabels: {
    consultation: "Consultations",
    echelle: "Évaluations",
    diagnostic: "Diagnostics",
    treatment: "Traitements",
    prescription: "Prescriptions",
    rdv: "Rendez-vous",
    document: "Documents",
  },
} as const;
