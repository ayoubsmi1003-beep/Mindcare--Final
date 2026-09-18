/**
 * `m09.ts` — libellés M09 d'observabilité (lecture d'historiques + écran).
 *
 * ═══ POURQUOI UN MODULE SÉPARÉ, PAS `fr.ts` ═══
 * `fr.ts` est gelé (découpe Phase 6) : on n'y ajoute rien, on n'en retire
 * rien (précédent M02 `resolution.ts`). Ces chaînes sont pourtant de
 * l'interface (erreurs affichables, écran d'inspection) — donc `src/i18n/`,
 * jamais en dur, jamais côté passerelle. Module minuscule et fermé.
 *
 * ═══ RÈGLES DE RÉDACTION (sécurité) ═══
 * · Le message d'indisponibilité est CONSTANT (assistant, hors périmètre,
 *   run inconnu, porte en panne) : il ne distingue jamais les cas, sinon
 *   on fabrique un oracle d'existence (ADR-003).
 * · Aucun libellé ne reprend un identifiant, un hash ou un verdict brut :
 *   les empreintes s'affichent tronquées par l'écran, jamais depuis ici.
 */
export const m09 = {
  observabilite: {
    indisponible:
      "Historique indisponible. Vos données sont préservées. Réessayez ou rouvrez l'écran.",
  },
  ecran: {
    titre: "Observabilité",
    sousTitre: "Historiques des runs IA — hashes et métriques, jamais de donnée patient",
    nonAutorise:
      "Écran réservé aux praticiennes. Vos données sont préservées. Retournez au tableau de bord.",
    retourTableau: "Retour au tableau de bord",
    lienParametres: "Observabilité des runs IA",
    sectionStats: "Activité et durées",
    sectionLive: "Runs live récents",
    sectionReplay: "Runs replay récents",
    videStats: "Aucun run enregistré pour l'instant. Les runs captés apparaîtront ici.",
    videLive: "Aucun run live ingéré pour l'instant.",
    videReplay: "Aucun run replay ingéré pour l'instant.",
    voirDetail: "Voir le détail",
    masquerDetail: "Masquer le détail",
    colonneDate: "Date",
    colonneChemin: "Chemin",
    colonneDuree: "Durée",
    colonneAppels: "Appels",
    colonnePreuves: "Preuves",
    colonneIssue: "Constat",
    colonneVerdict: "Verdict",
    colonnePass: "Réussis",
    colonneFail: "Échecs",
    runsLive: "Runs live",
    runsReplay: "Runs replay",
    p50: "Médiane",
    p95: "p95",
    approbation: "Approbation",
    sansApprobation: "Sans approbation (tour simple)",
  },
} as const;
