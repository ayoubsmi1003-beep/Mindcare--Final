/**
 * La porte d'accès aux fonctions d'IA clinique (Alexa / Jarvis).
 *
 * ═══ POURQUOI CETTE PORTE EST ICI, ET PAS DANS L'UI ═════════════════════════
 *
 * L'interface masque Alexa pour le rôle `assistant`, mais une requête HTTP
 * directe vers `/api/alexa/*` ou `/api/jarvis/*` ne passait que le contrôle de
 * session. La RLS protège encore chaque lecture de dossier, mais une fonction
 * réservée au médecin doit être refusée par le serveur, pas seulement cachée.
 *
 * La décision de rôle reste en base : `app.get_my_profile()` lit le profil de
 * l'appelant sous sa propre identité. Cette fonction ne fait que transporter
 * le booléen jusqu'à la route. Elle n'élargit aucun droit clinique : les
 * lectures de patients continuent de passer par les portes et la RLS.
 */

import { faireePgPort } from "@/server/db/pgPort";
import { withCaller } from "@/server/db/withCaller";

interface ProfilRole {
  readonly role: string;
}

/** Vrai pour `owner` et `practitioner` ; faux pour `assistant` et `patient`. */
export async function iaCliniqueAutorisee(userId: string): Promise<boolean> {
  try {
    const resultat = await withCaller(userId, async (q) =>
      faireePgPort(q, "auth.ia").rpc<ProfilRole>("get_my_profile", {}),
    );
    const role = resultat.ok ? resultat.data[0]?.role : undefined;
    return role === "owner" || role === "practitioner";
  } catch {
    // Base injoignable : on refuse. Une porte qui s'ouvre sur une panne n'est
    // pas une porte.
    return false;
  }
}
