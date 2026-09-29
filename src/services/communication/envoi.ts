/**
 * Exécution d'envoi — via le port navigateur (`posterEnvoiCommunication`),
 * seul chemin client autorisé vers `POST /api/communication/envoyer`.
 *
 * La route serveur revérifie tout (état `approved`, consentement, registre,
 * egress) : ce module transporte la demande, il n'autorise rien.
 */
import { lireMotifRefusProvider, posterEnvoiBrut } from "../db/http";
import { err, ok, type Result } from "../result";

export interface ResultatEnvoi {
  readonly idExterne: string | null;
  /**
   * Motif HONNÊTE d'un refus du canal (fenêtre 24 h, app Meta non approuvée,
   * destinataire refusé). `null` si l'envoi a réussi ou si l'échec n'est pas
   * un refus provider. C'est ce texte que l'écran montre — jamais un
   * « indisponible » qui ferait perdre des heures.
   */
  readonly motifRefus: string | null;
}

/** Enveloppe lue à la main : un refus provider sort du classement `lireEnveloppe`. */
async function posterEnvoiEtLireMotif(corps: {
  readonly conversationId: string;
  readonly messageId: string;
  readonly canal: "whatsapp" | "facebook" | "instagram";
  readonly outil:
    | "whatsapp.envoyer_texte"
    | "whatsapp.envoyer_gabarit"
    | "facebook.envoyer_message_page"
    | "instagram.envoyer_reponse";
}): Promise<Result<{ idExterne: string | null; motifRefus: string | null }>> {
  let reponse: Response | null;
  try {
    reponse = await posterEnvoiBrut(corps);
  } catch {
    reponse = null;
  }
  if (reponse === null) {
    return err({ code: "indisponible", message: "Messagerie externe indisponible." });
  }

  const motif = await lireMotifRefusProvider(reponse);
  if (motif !== null) {
    return err({ code: "regle-metier", message: motif });
  }
  if (!reponse.ok) {
    const code = reponse.status === 422 ? "regle-metier" : "indisponible";
    return err({ code, message: "L'envoi a été refusé." });
  }
  let lu: unknown;
  try {
    lu = (await reponse.json()) as unknown;
  } catch {
    return err({ code: "indisponible", message: "Réponse d'envoi illisible." });
  }
  const idExterne = (lu as { data?: { idExterne?: unknown } })?.data?.idExterne;
  return ok({
    idExterne: typeof idExterne === "string" ? idExterne : null,
    motifRefus: null,
  });
}

export async function executerEnvoi(
  conversationId: string,
  messageId: string,
  canal: "whatsapp" | "facebook" | "instagram",
  outil:
    | "whatsapp.envoyer_texte"
    | "whatsapp.envoyer_gabarit"
    | "facebook.envoyer_message_page"
    | "instagram.envoyer_reponse",
): Promise<Result<ResultatEnvoi>> {
  const resultat = await posterEnvoiEtLireMotif({
    conversationId,
    messageId,
    canal,
    outil,
  });
  if (!resultat.ok) return err(resultat.error);
  return ok(resultat.data);
}
