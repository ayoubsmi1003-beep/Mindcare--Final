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

/**
 * Écran Messages (centre de communication) — libellés d'interface.
 * Le nom d'écran reste « Messages » (imposé par `fr.nav.ecrans`, jamais
 * « Communications »). Aucune donnée fictive : les états vides sont honnêtes.
 */
export const frMessages = {
  titre: "Messages",
  sousTitre: "Conversations WhatsApp et Facebook du cabinet",
  filtres: {
    tous: "Tous",
    whatsapp: "WhatsApp",
    facebook: "Facebook",
    nonTraites: "Non traités",
    humainRequis: "Humain requis",
  },
  listeVide: "Aucune conversation pour ce filtre.",
  aucuneSelection: "Sélectionnez une conversation pour lire et répondre.",
  conversationVide: "Aucun message dans cette conversation.",
  prospect: "Prospect (dossier non lié)",
  connexion: {
    connecte: "Connecté",
    nonConnecte: "Non connecté",
    erreur: "Erreur de connexion",
  },
  actions: {
    preparer: "Préparer",
    approuverEtEnvoyer: "Approuver et envoyer",
    envoyer: "Envoyer",
    refuser: "Refuser",
    passerAccueil: "Passer à l'accueil",
    reprendreIA: "Reprendre en IA",
    resoudre: "Marquer résolu",
    lier: "Lier",
    proposerRendezVous: "Proposer un rendez-vous",
    voirDossier: "Voir le dossier",
  },
  consentement: {
    titre: "Consentement",
    actif: "Envois autorisés sur ce canal",
    inactif: "Envois bloqués : consentement absent",
    autoriser: "Autoriser",
    retirer: "Retirer",
  },
  candidats: "Dossiers correspondants",
  aucunCandidat: "Aucun dossier ne correspond à ce numéro. L'humaine lie le dossier.",
  compositeurPlaceholder: "Écrivez un message…",
  envoye: "Message envoyé.",
  prepareQueu: "Message en file : il partira quand la connexion reviendra.",
  prepareApprobation: "Brouillon prêt : approuvez-le pour l'envoyer.",
  prepareBloque: "Message bloqué par la politique d'envoi.",
  echecEnvoi: "L'envoi a échoué. Aucun faux succès : réessayez depuis un nouveau brouillon.",
  /** Motif d'annulation posé quand le patient annule par messagerie (porte 022 l'exige). */
  motifAnnulationPatient: "Annulation demandée par le patient (messagerie).",
  handoff: {
    AI_HANDLING: "Prise en charge : IA",
    HUMAN_REQUIRED: "Humain requis",
    HUMAN_HANDLING: "Prise en charge : accueil",
    RESOLVED: "Résolue",
  },
} as const;
