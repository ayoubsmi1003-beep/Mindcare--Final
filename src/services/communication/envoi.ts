/**
 * Exécution d'envoi — via le port navigateur (`posterEnvoiCommunication`),
 * seul chemin client autorisé vers `POST /api/communication/envoyer`.
 *
 * La route serveur revérifie tout (état `approved`, consentement, registre,
 * egress) : ce module transporte la demande, il n'autorise rien.
 */
import { posterEnvoiCommunication } from "../db/http";
import { err, ok, type Result } from "../result";

export interface ResultatEnvoi {
  readonly idExterne: string | null;
}

export async function executerEnvoi(
  conversationId: string,
  messageId: string,
  canal: "whatsapp" | "facebook",
  outil:
    | "whatsapp.envoyer_texte"
    | "whatsapp.envoyer_gabarit"
    | "facebook.envoyer_message_page",
): Promise<Result<ResultatEnvoi>> {
  const resultat = await posterEnvoiCommunication({ conversationId, messageId, canal, outil });
  if (!resultat.ok) return err(resultat.error);
  const idExterne = resultat.data.idExterne;
  return ok({ idExterne: typeof idExterne === "string" ? idExterne : null });
}
