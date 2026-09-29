/**
 * `POST /api/communication/webhook` — ingestion d'un événement entrant.
 *
 * Session REQUISE (pas de surface anonyme : le webhook public signé est
 * Phase 3 ; en attendant, l'ingestion passe par un opérateur connecté ou le
 * travailleur d'intégration — fail-closed, jamais d'écriture anonyme).
 *
 * Le contenu entrant est une DONNÉE : stocké localement via les portes 112
 * + 115, jamais retransmis à un modèle ni à un provider. Rejeu provider →
 * `{ duplique: true }`, une seule ligne (UNIQUE provider_message_id).
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { SchemaWebhook } from "@/server/communication/schemas";
import { faireePgPort } from "@/server/db/pgPort";
import { withCaller } from "@/server/db/withCaller";

import { preparer, refus } from "../../db/_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IssueWebhook =
  | { readonly erreur: "indisponible" | "regle-metier"; readonly statut: number }
  | { readonly duplique: true }
  | { readonly conversationId: string; readonly messageId: string };

export async function POST(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  let brut: unknown;
  try {
    brut = await requete.json();
  } catch {
    return refus("regle-metier", 400);
  }
  const analyse = SchemaWebhook.safeParse(brut);
  if (!analyse.success) return refus("regle-metier", 400);
  const { canal, expediteur, providerMessageId, contenu, langue } = analyse.data;

  try {
    const issue: IssueWebhook = await withCaller(ctx.userId, async (q) => {
      const port = faireePgPort(q, "api.communication.webhook");

      const deja = await port.rpc<boolean>("comm_ref_existe", {
        p_provider_message_id: providerMessageId,
      });
      if (!deja.ok) return { erreur: "indisponible" as const, statut: 503 };
      if (deja.data[0] === true) return { duplique: true as const };

      const convs = await port.rpc<string>("comm_trouver_ou_creer_conversation", {
        p_canal: canal,
        p_identifiant_externe: expediteur,
      });
      if (!convs.ok || convs.data[0] === undefined) {
        return { erreur: "regle-metier" as const, statut: 422 };
      }
      const conversationId = convs.data[0];

      const clientMsgId = randomUUID();
      const ajout = await port.rpc<boolean>("comm_append_message", {
        p_conversation_id: conversationId,
        p_client_msg_id: clientMsgId,
        p_direction: "entrant",
        p_contenu: contenu,
        p_langue: langue ?? null,
      });
      if (!ajout.ok || ajout.data[0] !== true) {
        return { erreur: "regle-metier" as const, statut: 422 };
      }

      const messages = await port.rpc<{ id: string; contenu: string }>("comm_list_messages", {
        p_conversation_id: conversationId,
        p_limit: 500,
      });
      if (!messages.ok) return { erreur: "indisponible" as const, statut: 503 };
      // La ligne qu'on vient d'écrire : recherchée par contenu (le dernier
      // élément tromperait en cas d'arrivées concurrentes).
      const ligne = messages.data.find((m) => m.contenu === contenu);
      if (ligne === undefined) return { erreur: "indisponible" as const, statut: 503 };

      await port.rpc<boolean>("comm_transition_message", {
        p_message_id: ligne.id,
        p_vers: "classified",
      });
      await port.rpc<boolean>("comm_ajouter_ref_externe", {
        p_message_id: ligne.id,
        p_provider: "composio",
        p_provider_message_id: providerMessageId,
      });
      return { conversationId, messageId: ligne.id };
    });

    if ("erreur" in issue) return refus(issue.erreur, issue.statut);
    return NextResponse.json({ ok: true, data: issue });
  } catch {
    return refus("indisponible", 503);
  }
}
