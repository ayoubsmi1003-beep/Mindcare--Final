/**
 * Routes Communication — validation d'entrée uniquement (le réseau et la
 * base restent derrière les portes et l'egress, testés ailleurs).
 */
import { describe, expect, it } from "vitest";

import { SchemaEnvoyer, SchemaStatutQuery, SchemaWebhook } from "../../src/server/communication/schemas";

describe("schémas communication", () => {
  it("accepte un envoi WhatsApp complet", () => {
    const r = SchemaEnvoyer.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000000",
      messageId: "00000000-0000-4000-8000-000000000001",
      canal: "whatsapp",
      outil: "whatsapp.envoyer_texte",
    });
    expect(r.success).toBe(true);
  });

  it("refuse un outil incohérent avec le canal (anti-aiguillage)", () => {
    const r = SchemaEnvoyer.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000000",
      messageId: "00000000-0000-4000-8000-000000000001",
      canal: "instagram",
      outil: "whatsapp.envoyer_texte",
    });
    expect(r.success).toBe(false);
  });

  it("accepte une réponse instagram sur le bon outil", () => {
    const r = SchemaEnvoyer.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000000",
      messageId: "00000000-0000-4000-8000-000000000001",
      canal: "instagram",
      outil: "instagram.envoyer_reponse",
    });
    expect(r.success).toBe(true);
  });

  it("refuse un webhook sans contenu ni référence", () => {
    expect(
      SchemaWebhook.safeParse({ canal: "whatsapp", expediteur: "+213000000000" }).success,
    ).toBe(false);
  });

  it("accepte un webhook entrant complet", () => {
    const r = SchemaWebhook.safeParse({
      canal: "whatsapp",
      expediteur: "+213000000000",
      providerMessageId: "wamid.test",
      contenu: "Salam, je confirme",
      langue: "mixte",
    });
    expect(r.success).toBe(true);
  });

  it("borne la requête de statut au canal connu", () => {
    expect(SchemaStatutQuery.safeParse({ canal: "sms" }).success).toBe(false);
    expect(SchemaStatutQuery.safeParse({}).success).toBe(true);
  });
});
