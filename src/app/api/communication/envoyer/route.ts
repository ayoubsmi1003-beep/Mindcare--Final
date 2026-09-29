/**
 * `POST /api/communication/envoyer` — exécution d'un envoi préparé.
 *
 * Frontière d'exécution, pas un proxy générique :
 * 1. l'outil doit être connu du registre fermé ET ne pas exiger d'approbation
 *    d'action (`facebook.publier`, `instagram.publier` sont refusés ici —
 *    Phase 9, jamais en 422 silencieux : le refus est explicite) ;
 * 2. le canal doit avoir un adaptateur (instagram → refus honnête) ;
 * 3. le message doit être à l'état `approved` (la préparation vit dans
 *    `services/communication`, jamais ici) ;
 * 4. le consentement est revérifié quand un patient est lié ;
 * 5. `approved → sending` AVANT l'appel (anti-double-envoi par race) ;
 * 6. résultat honnête : `sent` + référence externe, `blocked` sur refus
 *    egress, `failed` sur panne — jamais de faux succès.
 *
 * Un `failed` ne repart pas seul : nouvelle préparation requise (le retry
 * opérateur est Phase 6). Le retry réseau (1× transitoire) vit déjà dans
 * `appelComposio`.
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { adaptateurPour } from "@/server/communication/adaptateurs";
import { capaciteConnue, exigeApprobation } from "@/server/communication/registre-outils";
import { SchemaEnvoyer } from "@/server/communication/schemas";
import { faireePgPort } from "@/server/db/pgPort";
import { withCaller, type Querier } from "@/server/db/withCaller";

import { preparer, refus } from "../../db/_commun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LigneMessage {
  readonly id: string;
  readonly etat: string;
  readonly contenu: string;
}

interface Routage {
  readonly canal: string;
  readonly destinataire: string | null;
  readonly patientId: string | null;
}

type IssueEnvoi =
  | { readonly erreur: "indisponible" | "regle-metier" | "introuvable"; readonly statut: number }
  | { readonly envoye: true; readonly idExterne: string | null };

export async function POST(requete: Request): Promise<NextResponse> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  let brut: unknown;
  try {
    brut = await requete.json();
  } catch {
    return refus("regle-metier", 400);
  }
  const analyse = SchemaEnvoyer.safeParse(brut);
  if (!analyse.success) return refus("regle-metier", 400);
  const { conversationId, messageId, canal, outil } = analyse.data;

  if (!capaciteConnue(outil)) return refus("introuvable", 404);
  if (exigeApprobation(outil)) {
    // Publications : effet visible, approbation d'action exigée — câblé en
    // Phase 9 (Marketing), refusé ici plutôt que demi-exécuté.
    return refus("regle-metier", 422);
  }
  const adaptateur = adaptateurPour(canal);
  if (adaptateur === null) return refus("regle-metier", 422);

  try {
    const issue: IssueEnvoi = await withCaller(ctx.userId, async (q) => {
      const port = faireePgPort(q, "api.communication.envoyer");

      const messages = await port.rpc<LigneMessage>("comm_list_messages", {
        p_conversation_id: conversationId,
        p_limit: 500,
      });
      if (!messages.ok) return { erreur: "indisponible" as const, statut: 503 };
      const message = messages.data.find((m) => m.id === messageId);
      if (message === undefined) return { erreur: "introuvable" as const, statut: 404 };
      if (message.etat !== "approved") return { erreur: "regle-metier" as const, statut: 422 };

      const routages = await port.rpc<Routage>("comm_conversation_routage", {
        p_conversation_id: conversationId,
      });
      if (!routages.ok) return { erreur: "indisponible" as const, statut: 503 };
      const routage = routages.data[0];
      if (routage === undefined || routage.canal !== canal) {
        return { erreur: "regle-metier" as const, statut: 422 };
      }
      if (routage.patientId !== null) {
        const consentements = await port.rpc<boolean>("comm_get_consent", {
          p_patient_id: routage.patientId,
          p_canal: canal,
        });
        if (!consentements.ok) return { erreur: "indisponible" as const, statut: 503 };
        if (consentements.data[0] !== true) return { erreur: "regle-metier" as const, statut: 422 };
      }

      const envoi = await port.rpc<boolean>("comm_transition_message", {
        p_message_id: messageId,
        p_vers: "sending",
      });
      if (!envoi.ok || envoi.data[0] !== true) {
        return { erreur: "regle-metier" as const, statut: 422 };
      }

      const cle = `comm:${conversationId}:${messageId}`;
      await port.rpc<boolean>("comm_register_delivery", { p_message_id: messageId, p_cle: cle });

      // L'entité Composio vient de l'environnement serveur (appelComposio),
      // jamais du cabinet : le cloisonnement cabinet reste en base (RLS).
      const resultat = await adaptateur.envoyer({
        outil,
        charge: { texte: message.contenu, destinataire: routage.destinataire },
        cleIdempotence: cle,
        sessionToken: randomUUID(),
      });

      if (!resultat.ok) {
        // Refus de frontière (PII) → `blocked` : relecture humaine exigée.
        // Panne → `failed` : pas de retry silencieux, pas de faux succès.
        await passer(q, messageId, resultat.error.code === "frontiere" ? "blocked" : "failed");
        return resultat.error.code === "frontiere"
          ? { erreur: "regle-metier" as const, statut: 422 }
          : { erreur: "indisponible" as const, statut: 503 };
      }

      await passer(q, messageId, "sent");
      await port.rpc<boolean>("comm_ajouter_ref_externe", {
        p_message_id: messageId,
        p_provider: "composio",
        p_provider_message_id: resultat.data.idExterne ?? cle,
      });
      return { envoye: true as const, idExterne: resultat.data.idExterne };
    });

    if ("erreur" in issue) return refus(issue.erreur, issue.statut);
    return NextResponse.json({ ok: true, data: { idExterne: issue.idExterne } });
  } catch {
    return refus("indisponible", 503);
  }
}

async function passer(q: Querier, messageId: string, vers: string): Promise<void> {
  const port = faireePgPort(q, "api.communication.envoyer");
  await port.rpc<boolean>("comm_transition_message", { p_message_id: messageId, p_vers: vers });
}
