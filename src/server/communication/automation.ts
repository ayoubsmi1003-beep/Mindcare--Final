/**
 * Évaluateur d'automations — TRIGGER → CONDITIONS → ACTION → VÉRIFICATION → AUDIT.
 *
 * Serveur uniquement (portes via `Querier`, jamais de PII vers l'extérieur).
 * Trois balayages, tous fail-closed et tous tracés :
 *
 * 1. SANS RÉPONSE : conversations `AI_HANDLING` dont le dernier entrant
 *    dépasse le seuil → `HUMAN_REQUIRED` (« Sans réponse depuis X min »).
 * 2. CLINIQUE : le dernier entrant porte un signal clinique → `HUMAN_REQUIRED`
 *    (« Contenu clinique — escalade »), réponse prédéfinie côté écran,
 *    JAMAIS de conseil généré.
 * 3. RAPPELS : RDV confirmés à <48h avec conversation liée ET consentement →
 *    comptés + journalisés (action `envoi_individuel`, métadonnées seules).
 *    L'ENVOI lui-même attend les gabarits Meta approuvés (Phase 7) : le
 *    bilan rend des candidats, pas des succès — aucun faux « rappel envoyé ».
 */
import { faireePgPort } from "@/server/db/pgPort";
import type { Querier } from "@/server/db/withCaller";
import {
  detecterContenuClinique,
  type BilanAutomation,
} from "@/services/communication/automation";

interface AttenteRow {
  readonly conversationId: string;
  readonly canal: string;
  readonly dernierMessageA: string;
}

interface MessageLigne {
  readonly id: string;
  readonly direction: "entrant" | "sortant";
  readonly etat: string;
  readonly contenu: string;
}

interface ConversationLigne {
  readonly id: string;
  readonly canal: string;
  readonly etatHandoff: string;
  readonly patientId: string | null;
}

interface AgendaBrut {
  readonly id: string;
  readonly status: string;
  readonly patient_id: string | null;
}

export async function evaluerAutomations(
  q: Querier,
  options: { readonly seuilMinutes: number; readonly maintenantIso: string },
): Promise<BilanAutomation> {
  const port = faireePgPort(q, "api.communication.automations");
  let sansReponse = 0;
  let escalades = 0;

  const attente = await port.rpc<AttenteRow>("comm_conversations_en_attente", {
    p_seuil_minutes: options.seuilMinutes,
  });
  if (attente.ok) {
    for (const conv of attente.data) {
      const msgs = await port.rpc<MessageLigne>("comm_list_messages", {
        p_conversation_id: conv.conversationId,
        p_limit: 5,
      });
      if (!msgs.ok) continue;
      const derniers = msgs.data.filter((m) => m.direction === "entrant");
      const dernier = derniers[derniers.length - 1];
      const clinique = dernier !== undefined && detecterContenuClinique(dernier.contenu);
      await port.rpc<boolean>("comm_request_handoff", {
        p_conversation_id: conv.conversationId,
        p_vers: "HUMAN_REQUIRED",
        p_motif: clinique
          ? "Contenu clinique détecté — escalade humaine, sans réponse automatique."
          : `Sans réponse depuis plus de ${options.seuilMinutes} min.`,
      });
      if (clinique) escalades += 1;
      else sansReponse += 1;
    }
  }

  let rappels = 0;
  const fin = new Date(Date.parse(options.maintenantIso) + 48 * 3_600_000).toISOString();
  const agenda = await port.rpc<AgendaBrut>("list_agenda", {
    p_from: options.maintenantIso,
    p_to: fin,
    p_practitioner: null,
    p_statuts: "{confirmed}",
  });
  if (agenda.ok) {
    const convs = await port.rpc<ConversationLigne>("comm_list_conversations", { p_limit: 200 });
    const liste = convs.ok ? convs.data : [];
    for (const rdv of agenda.data) {
      if (rdv.patient_id === null) continue;
      const conv = liste.find((c) => c.patientId === rdv.patient_id);
      if (conv === undefined) continue;
      const consent = await port.rpc<boolean>("comm_get_consent", {
        p_patient_id: rdv.patient_id,
        p_canal: conv.canal,
      });
      if (consent.ok && consent.data[0] === true) rappels += 1;
    }
  }

  // Audit : compteurs et horodatage seuls, jamais de contenu ni d'identité.
  await port.rpc<string>("comm_log_action", {
    p_type: "envoi_individuel",
    p_charge: JSON.stringify({
      bilan: "automation",
      rappels,
      sansReponse,
      escalades,
      evalueA: options.maintenantIso,
    }),
  });

  return { rappels, sansReponse, escalades };
}
