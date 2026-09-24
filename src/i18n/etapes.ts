/**
 * `etapes.ts` — mentions d'étape Alexa pendant qu'une capacité tourne.
 *
 * ═══ POURQUOI UN MODULE SÉPARÉ, PAS `fr.ts` ═══
 * `fr.ts` est gelé (découpe Phase 6) : même motif que `resolution.ts`.
 * Ces libellés sont des chaînes d'interface (fil Jarvis), jamais des
 * diagnostics : ils disent CE QUI SE PASSE (« Recherche du dossier… »),
 * jamais de donnée (aucun nom, aucun chiffre).
 *
 * Table FERMÉE : une capacité inconnue rend le libellé générique — l'écran
 * ne doit jamais rester muet (§12 mission, 05-UX-CONTRACT), ni inventer.
 */

/** Mention d'étape affichable, sans aucune donnée identifiante. */
export function libelleEtape(capacite: string): string {
  switch (capacite) {
    case "search_patients":
      return "Recherche du dossier…";
    case "get_patient_context":
      return "Lecture du dossier…";
    case "get_patient_timeline":
      return "Lecture de l'historique…";
    case "get_patient_documents":
      return "Lecture des documents…";
    case "get_current_medications":
      return "Lecture du traitement…";
    case "get_consultation_history":
      return "Lecture des consultations…";
    case "get_patient_financial_summary":
      return "Lecture des paiements…";
    case "get_next_patient":
    case "get_today_agenda":
    case "get_agenda_range":
    case "get_appointment":
    case "get_waiting_room":
      return "Lecture de l'agenda…";
    case "get_consultation":
      return "Lecture de la consultation…";
    case "get_day_revenue":
    case "get_period_revenue":
    case "get_outstanding_payments":
      return "Lecture des recettes…";
    case "get_notifications":
      return "Lecture des notifications…";
    case "get_system_status":
      return "Vérification du système…";
    case "brief_prochain_patient":
    case "brief_matinal":
      return "Préparation du brief…";
    case "brief_finance":
      return "Préparation du récapitulatif…";
    case "draft_patient_message":
      return "Rédaction du message…";
    default:
      return "Recherche en cours…";
  }
}
