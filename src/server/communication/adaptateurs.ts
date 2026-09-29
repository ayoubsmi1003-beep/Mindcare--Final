/**
 * Adaptateurs provider — l'abstraction MindCare devant Composio.
 *
 * Le domaine dépend de `FournisseurCommunication`, jamais des noms Composio.
 * Aujourd'hui : `ComposioWhatsAppAdapter`, `ComposioFacebookAdapter`.
 * Instagram : pas d'adaptateur tant que le compte n'est pas connecté —
 * demander un envoi Instagram rend `indisponible`, jamais un faux succès.
 */

import { appelComposio, type LlmResult } from "@/server/egress/external-call";

import { trouverOutil } from "./registre-outils";

export interface DemandeEnvoi {
  /** Capacité MindCare (ex. `whatsapp.envoyer_texte`). */
  readonly outil: string;
  readonly charge: Readonly<Record<string, unknown>>;
  readonly cleIdempotence: string;
  readonly entiteId: string;
  readonly sessionToken: string;
}

export interface FournisseurCommunication {
  readonly canal: string;
  envoyer(
    demande: DemandeEnvoi,
  ): Promise<LlmResult<{ readonly idExterne: string | null }>>;
}

async function executerViaRegistre(
  demande: DemandeEnvoi,
): Promise<LlmResult<{ readonly idExterne: string | null }>> {
  const outil = trouverOutil(demande.outil);
  if (outil === null) {
    return {
      ok: false,
      error: { code: "indisponible", message: "Capacité inconnue." },
    };
  }
  return appelComposio({
    outil: outil.actionComposio,
    charge: demande.charge,
    cleIdempotence: demande.cleIdempotence,
    entiteId: demande.entiteId,
    sessionToken: demande.sessionToken,
  });
}

export const ComposioWhatsAppAdapter: FournisseurCommunication = {
  canal: "whatsapp",
  envoyer: executerViaRegistre,
};

export const ComposioFacebookAdapter: FournisseurCommunication = {
  canal: "facebook",
  envoyer: executerViaRegistre,
};

const ADAPTATEURS: Readonly<Record<string, FournisseurCommunication>> = {
  whatsapp: ComposioWhatsAppAdapter,
  facebook: ComposioFacebookAdapter,
};

/** Rend l'adaptateur du canal, ou null (ex. instagram avant connexion). */
export function adaptateurPour(canal: string): FournisseurCommunication | null {
  return ADAPTATEURS[canal] ?? null;
}
