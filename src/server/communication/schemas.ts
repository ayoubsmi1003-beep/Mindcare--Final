/**
 * Schémas Zod des routes `/api/communication/*`.
 * Validés ici, testés sans base (voir `communication-routes.test.ts`).
 */
import { z } from "zod";

export const SchemaCanalEntrant = z.enum(["whatsapp", "instagram", "facebook"]);

export const SchemaStatutQuery = z.object({
  canal: SchemaCanalEntrant.optional(),
});

export const SchemaEnvoyer = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  canal: z.enum(["whatsapp", "facebook"]),
  outil: z.enum(["whatsapp.envoyer_texte", "whatsapp.envoyer_gabarit", "facebook.envoyer_message_page"]),
});

export const SchemaWebhook = z.object({
  canal: SchemaCanalEntrant,
  expediteur: z.string().min(1).max(255),
  providerMessageId: z.string().min(1).max(255),
  contenu: z.string().min(1).max(4000),
  langue: z.enum(["fr", "ar", "darija", "mixte"]).optional(),
});
