/**
 * Adaptateurs provider — l'abstraction MindCare devant Composio.
 *
 * Le domaine dépend de `FournisseurCommunication`, jamais des noms Composio.
 * Le slug réellement appelé est résolu au runtime contre le compte connecté
 * (`resoudreOutilComposio`) : sans match, `indisponible` honnête — jamais
 * d'appel vers un slug deviné. Instagram n'a donc pas de « mode dégradé
 * silencieux » : connecté-mais-sans-slug se voit comme indisponible.
 */

import { appelComposio, type LlmResult } from "@/server/egress/external-call";

import { resoudreOutilComposio, trouverOutil } from "./registre-outils";

export interface DemandeEnvoi {
  /** Capacité MindCare (ex. `instagram.envoyer_reponse`). */
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
  const slug = await resoudreOutilComposio(demande.outil);
  if (slug === null) {
    return {
      ok: false,
      error: { code: "indisponible", message: "Capacité indisponible chez le provider." },
    };
  }
  return appelComposio({
    outil: slug,
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

export const ComposioInstagramAdapter: FournisseurCommunication = {
  canal: "instagram",
  envoyer: executerViaRegistre,
};

const ADAPTATEURS: Readonly<Record<string, FournisseurCommunication>> = {
  whatsapp: ComposioWhatsAppAdapter,
  facebook: ComposioFacebookAdapter,
  instagram: ComposioInstagramAdapter,
};

/** Rend l'adaptateur du canal, ou null (canal inconnu — jamais de faux succès). */
export function adaptateurPour(canal: string): FournisseurCommunication | null {
  return ADAPTATEURS[canal] ?? null;
}
