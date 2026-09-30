/**
 * Registre FERMÉ des capacités Communication via Composio.
 *
 * Rien n'est activé par défaut : une capacité n'existe que si elle est
 * listée ici, avec son périmètre, son approbation et son audit. Jarvis ne
 * voit que ces noms MindCare (`whatsapp.envoyer_texte`), jamais les slugs
 * Composio bruts — et surtout jamais le catalogue entier.
 *
 * Instagram : entrées résolues contre le compte connecté (Phase 7). Tant que
 * la découverte ne rend aucun slug, les capacités restent indisponibles —
 * fail-closed, jamais d'appel deviné.
 */

import { listerOutilsComposio } from "@/server/egress/external-call";

import { randomUUID } from "node:crypto";

export type CanalOutil = "whatsapp" | "instagram" | "facebook" | "connexion" | "entrant";

export interface OutilCommunication {
  /** Nom MindCare vu par Jarvis et l'audit. */
  readonly nom: string;
  readonly provider: "composio";
  /**
   * Action candidate côté Composio — INDICATIVE, jamais appelée telle quelle.
   * Le slug réellement appelé est résolu au runtime par `resoudreOutilComposio`
   * contre la liste vivante du compte (`listerOutilsComposio`) : sans match,
   * la capacité est indisponible, jamais devinée.
   */
  readonly actionComposio: string;
  /** Toolkit interrogé à la découverte. */
  readonly toolkit: "whatsapp" | "instagram" | "facebook" | "composio" | "local";
  /** Motifs insensibles à la casse, premier gagnant (`resoudreSlug`). */
  readonly motifs: readonly string[];
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
    toolkit: "whatsapp",
    motifs: ["whatsapp_send_text", "whatsapp_send_message", "send_text_message"],
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
    toolkit: "whatsapp",
    motifs: ["whatsapp_send_template", "send_template_message", "send_template"],
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
    toolkit: "whatsapp",
    motifs: ["whatsapp_get_message", "whatsapp_message_status", "message_status"],
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
    toolkit: "facebook",
    motifs: ["facebook_send", "send_page_message", "pages_messaging"],
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
    toolkit: "facebook",
    motifs: ["facebook_create_post", "create_page_post", "pages_manage_posts"],
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
    toolkit: "composio",
    motifs: ["list_connected", "connected_accounts", "list_connections"],
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
    toolkit: "composio",
    motifs: ["test_connection", "verify_connection", "check_connection"],
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
    toolkit: "local",
    motifs: [],
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
  {
    nom: "instagram.envoyer_reponse",
    provider: "composio",
    actionComposio: "INSTAGRAM_SEND_MESSAGE",
    toolkit: "instagram",
    motifs: ["instagram_send_text", "instagram_send", "ig_send", "instagram_reply", "send_dm"],
    canal: "instagram",
    capacite: "Réponse à un DM entrant, dans la fenêtre Meta.",
    portee: "Un message, une conversation Instagram, charge C4 uniquement.",
    acteurAutorise: "praticienne, accueil (consentement requis).",
    classificationDonnees: "C4",
    destinationEgress: "Composio → Instagram (compte connecté).",
    approbationRequise: false,
    evenementAudit: "communication.envoi",
    limiteDebit: "20/min/cabinet.",
    retry: "1× transitoires ; jamais fenêtre expirée (4xx).",
    idempotence: "Clé comm:<conversation>:<empreinte>, UNIQUE en base.",
  },
  {
    nom: "instagram.lire_commentaires",
    provider: "composio",
    actionComposio: "INSTAGRAM_LIST_COMMENTS",
    toolkit: "instagram",
    motifs: ["get_post_comments", "post_comments", "list_all_messages", "reply_to_comment"],
    canal: "instagram",
    capacite: "Lecture des commentaires (modération, détection de leads).",
    portee: "Lecture seule, métadonnées + textes publics.",
    acteurAutorise: "praticienne, accueil.",
    classificationDonnees: "metadonnees",
    destinationEgress: "Composio → Instagram (lecture).",
    approbationRequise: false,
    evenementAudit: "communication.lecture_commentaires",
    limiteDebit: "30/min/cabinet.",
    retry: "1× transitoires.",
    idempotence: "Lecture : sans objet.",
  },
  {
    nom: "instagram.publier",
    provider: "composio",
    actionComposio: "INSTAGRAM_CREATE_POST",
    toolkit: "instagram",
    motifs: ["instagram_create", "instagram_publish", "ig_publish", "media_publish", "create_media"],
    canal: "instagram",
    capacite: "Publication média (brouillon approuvé uniquement).",
    portee: "Une publication, effet externe visible.",
    acteurAutorise: "praticienne (action confirmée au préalable).",
    classificationDonnees: "C4",
    destinationEgress: "Composio → Instagram (compte connecté).",
    approbationRequise: true,
    evenementAudit: "communication.publication",
    limiteDebit: "5/jour/cabinet.",
    retry: "Aucun retry automatique (effet visible).",
    idempotence: "Action comm_log_action + confirmed_at, exécution unique.",
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

/**
 * Matche des motifs (insensibles à la casse) contre des slugs vivants.
 *
 * Le motif LE PLUS LONG gagne : un préfixe court (`instagram_send`) matche
 * aussi bien `INSTAGRAM_SEND_IMAGE` que `INSTAGRAM_SEND_TEXT_MESSAGE`, et le
 * premier venu n'est pas forcément le bon (prouvé en live : la réponse DM
 * résolvait vers l'envoi d'image). À égalité, le premier motif l'emporte.
 * Null = capacité indisponible, jamais un slug inventé pour « essayer ».
 */
export function resoudreSlug(
  motifs: readonly string[],
  slugs: readonly string[],
): string | null {
  let meilleur: { slug: string; longueur: number } | null = null;
  for (const motif of motifs) {
    const m = motif.toLowerCase();
    if (m === "") continue;
    for (const slug of slugs) {
      if (slug.toLowerCase().includes(m)) {
        if (meilleur === null || m.length > meilleur.longueur) {
          meilleur = { slug, longueur: m.length };
        }
        break;
      }
    }
  }
  return meilleur === null ? null : meilleur.slug;
}

/** Cache de découverte : 5 minutes par toolkit (slugs, pas de données). */
const decouverteCache = new Map<string, { expire: number; slugs: readonly string[] }>();
const FENETRE_DECOUVERTE_MS = 300_000;

/**
 * Résout le slug Composio réellement appelable pour une capacité MindCare.
 * `LOCAL_ONLY` (ingestion locale) ne se résout jamais : null, et l'appelant
 * ne doit pas appeler le réseau dans ce cas.
 */
export async function resoudreOutilComposio(nom: string): Promise<string | null> {
  const outil = trouverOutil(nom);
  if (outil === null || outil.toolkit === "local" || outil.motifs.length === 0) return null;

  const cached = decouverteCache.get(outil.toolkit);
  if (cached !== undefined && Date.now() < cached.expire) {
    return resoudreSlug(outil.motifs, cached.slugs);
  }
  const liste = await listerOutilsComposio(outil.toolkit, randomUUID());
  if (!liste.ok) {
    decouverteCache.delete(outil.toolkit);
    return null;
  }
  decouverteCache.set(outil.toolkit, { expire: Date.now() + FENETRE_DECOUVERTE_MS, slugs: liste.data });
  return resoudreSlug(outil.motifs, liste.data);
}
