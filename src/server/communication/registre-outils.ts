/**
 * Registre FERMÉ des capacités Communication via Composio.
 *
 * Rien n'est activé par défaut : une capacité n'existe que si elle est
 * listée ici, avec son périmètre, son approbation et son audit. Jarvis ne
 * voit que ces noms MindCare (`whatsapp.envoyer_texte`), jamais les slugs
 * Composio bruts — et surtout jamais le catalogue entier.
 *
 * Instagram : AUCUNE entrée tant que le compte n'est pas connecté
 * (NOT_AVAILABLE, fail-closed). Ajouter une entrée = décision explicite.
 */

export type CanalOutil = "whatsapp" | "facebook" | "connexion" | "entrant";

export interface OutilCommunication {
  /** Nom MindCare vu par Jarvis et l'audit. */
  readonly nom: string;
  readonly provider: "composio";
  /** Action candidate côté Composio, résolue au runtime (absente → indisponible honnête). */
  readonly actionComposio: string;
  readonly canal: CanalOutil;
  readonly capacite: string;
  readonly portee: string;
  readonly acteurAutorise: string;
  readonly classificationDonnees: "C4" | "metadonnees";
  readonly destinationEgress: string;
  readonly approbationRequise: boolean;
  readonly evenementAudit: string;
  readonly limiteDebit: string;
  readonly retry: string;
  readonly idempotence: string;
}

export const OUTILS_COMMUNICATION: readonly OutilCommunication[] = [
  {
    nom: "whatsapp.envoyer_texte",
    provider: "composio",
    actionComposio: "WHATSAPP_SEND_TEXT_MESSAGE",
    canal: "whatsapp",
    capacite: "Envoi d'un texte WhatsApp Business à un destinataire vérifié.",
    portee: "Un message, un destinataire, charge C4 uniquement.",
    acteurAutorise: "praticienne, accueil (consentement requis).",
    classificationDonnees: "C4",
    destinationEgress: "Composio → Meta WhatsApp Business.",
    approbationRequise: false,
    evenementAudit: "communication.envoi",
    limiteDebit: "20/min/cabinet.",
    retry: "1× transitoires (timeout, 5xx, 429, réseau) ; jamais 4xx.",
    idempotence: "Clé comm:<conversation>:<empreinte>, UNIQUE en base.",
  },
  {
    nom: "whatsapp.envoyer_gabarit",
    provider: "composio",
    actionComposio: "WHATSAPP_SEND_TEMPLATE_MESSAGE",
    canal: "whatsapp",
    capacite: "Envoi d'un gabarit Meta approuvé (rappels, confirmations).",
    portee: "Gabarit approuvé + paramètres, charge C4 uniquement.",
    acteurAutorise: "praticienne, accueil (consentement requis).",
    classificationDonnees: "C4",
    destinationEgress: "Composio → Meta WhatsApp Business.",
    approbationRequise: false,
    evenementAudit: "communication.envoi_gabarit",
    limiteDebit: "20/min/cabinet.",
    retry: "1× transitoires ; jamais gabarit invalide (4xx).",
    idempotence: "Clé comm:<conversation>:<empreinte>, UNIQUE en base.",
  },
  {
    nom: "whatsapp.statut_message",
    provider: "composio",
    actionComposio: "WHATSAPP_GET_MESSAGE_STATUS",
    canal: "whatsapp",
    capacite: "Lecture du statut de remise d'un message envoyé.",
    portee: "Lecture seule, métadonnées.",
    acteurAutorise: "praticienne, accueil.",
    classificationDonnees: "metadonnees",
    destinationEgress: "Composio → Meta WhatsApp Business (lecture).",
    approbationRequise: false,
    evenementAudit: "communication.statut",
    limiteDebit: "60/min/cabinet.",
    retry: "1× transitoires.",
    idempotence: "Lecture : sans objet.",
  },
  {
    nom: "facebook.envoyer_message_page",
    provider: "composio",
    actionComposio: "FACEBOOK_SEND_PAGE_MESSAGE",
    canal: "facebook",
    capacite: "Réponse de la Page à une conversation entrante (fenêtre Meta).",
    portee: "Un message, une conversation Page, charge C4 uniquement.",
    acteurAutorise: "praticienne, accueil (consentement requis).",
    classificationDonnees: "C4",
    destinationEgress: "Composio → Page Facebook connectée.",
    approbationRequise: false,
    evenementAudit: "communication.envoi",
    limiteDebit: "20/min/cabinet.",
    retry: "1× transitoires ; jamais fenêtre expirée (4xx).",
    idempotence: "Clé comm:<conversation>:<empreinte>, UNIQUE en base.",
  },
  {
    nom: "facebook.publier",
    provider: "composio",
    actionComposio: "FACEBOOK_CREATE_PAGE_POST",
    canal: "facebook",
    capacite: "Publication sur la Page (brouillon approuvé uniquement).",
    portee: "Une publication, effet externe visible.",
    acteurAutorise: "praticienne (action confirmée au préalable).",
    classificationDonnees: "C4",
    destinationEgress: "Composio → Page Facebook connectée.",
    approbationRequise: true,
    evenementAudit: "communication.publication",
    limiteDebit: "5/jour/cabinet.",
    retry: "Aucun retry automatique (effet visible).",
    idempotence: "Action comm_log_action + confirmed_at, exécution unique.",
  },
  {
    nom: "connexion.statut",
    provider: "composio",
    actionComposio: "COMPOSIO_LIST_CONNECTED_ACCOUNTS",
    canal: "connexion",
    capacite: "Lecture du statut des comptes connectés.",
    portee: "Lecture seule, aucun secret rendu.",
    acteurAutorise: "praticienne, accueil.",
    classificationDonnees: "metadonnees",
    destinationEgress: "Composio (comptes).",
    approbationRequise: false,
    evenementAudit: "communication.connexion_statut",
    limiteDebit: "10/min/cabinet.",
    retry: "1× transitoires.",
    idempotence: "Lecture : sans objet.",
  },
  {
    nom: "connexion.tester",
    provider: "composio",
    actionComposio: "COMPOSIO_TEST_CONNECTION",
    canal: "connexion",
    capacite: "Test d'une connexion (ping de capacité, aucun envoi).",
    portee: "Lecture seule, aucun effet.",
    acteurAutorise: "praticienne.",
    classificationDonnees: "metadonnees",
    destinationEgress: "Composio (comptes).",
    approbationRequise: false,
    evenementAudit: "communication.connexion_test",
    limiteDebit: "5/min/cabinet.",
    retry: "Aucun (diagnostic).",
    idempotence: "Lecture : sans objet.",
  },
  {
    nom: "entrant.ingerer",
    provider: "composio",
    actionComposio: "LOCAL_ONLY",
    canal: "entrant",
    capacite: "Persistance locale d'un événement entrant (webhook).",
    portee: "Écriture locale via portes 112, jamais de sortie.",
    acteurAutorise: "système (webhook vérifié).",
    classificationDonnees: "metadonnees",
    destinationEgress: "Aucune (local uniquement).",
    approbationRequise: false,
    evenementAudit: "communication.entrant",
    limiteDebit: "200/min/cabinet.",
    retry: "Rejeu idempotent (provider_message_id UNIQUE).",
    idempotence: "provider_message_id UNIQUE + (conversation, client_msg_id).",
  },
];

/** L'outil est-il connu du registre fermé ? */
export function capaciteConnue(nom: string): boolean {
  return OUTILS_COMMUNICATION.some((o) => o.nom === nom);
}

/** L'exécution exige-t-elle une approbation humaine préalable ? */
export function exigeApprobation(nom: string): boolean {
  return OUTILS_COMMUNICATION.some((o) => o.nom === nom && o.approbationRequise);
}

export function trouverOutil(nom: string): OutilCommunication | null {
  return OUTILS_COMMUNICATION.find((o) => o.nom === nom) ?? null;
}
