/**
 * `communication.ts` — chaînes du domaine Communication.
 *
 * POURQUOI UN MODULE SÉPARÉ, PAS `fr.ts` : `fr.ts` est gelé (découpe Phase 6,
 * cf. `resolution.ts`) — on n'y ajoute rien. Toute chaîne affichée vit ici,
 * jamais en dur dans un composant ou un service.
 *
 * Aucune donnée fictive, aucun nom, aucun contenu clinique d'exemple (règle 8).
 */
export const frCommunication = {
  /** Refus honnête : la charge porte un signal patient, l'egress a bloqué. */
  refusFrontiere:
    "Je ne peux pas envoyer ce message : il contient des données du cabinet qui ne quittent pas la machine.",
  /** Envoi impossible sans consentement du patient pour ce canal. */
  consentementManquant:
    "Envoi impossible : le consentement du patient pour ce canal n'est pas enregistré.",
  /** Hors-ligne : le message est conservé, pas envoyé. */
  misEnFile:
    "Le message est préparé mais n'a pas encore été envoyé. Connexion externe indisponible.",
  /** Canal non connecté (ex. Instagram avant configuration). */
  canalNonConnecte:
    "Ce canal n'est pas encore connecté. Vérifiez les connexions avant d'envoyer.",
  /** Envoi de masse / publication : approbation humaine exigée. */
  approbationRequise:
    "Cette action nécessite une approbation explicite avant exécution.",
  /** Contenu clinique détecté : escalade humaine, pas de conseil. */
  escaladeClinique:
    "Ce message semble contenir un contenu clinique. Il a été transmis à l'équipe soignante, sans réponse automatique.",
} as const;
