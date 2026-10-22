/**
 * La porte « gestion des postes » — appelée par les routes `/api/cabinet/*`.
 *
 * ═══ POURQUOI ELLE EXISTE ═══════════════════════════════════════════════════
 *
 * Les invitations et le registre des postes vivent hors de PostgreSQL, dans
 * `%ProgramData%\MindCare\private` (SYSTEM + Administrateurs). La RLS ne peut
 * donc pas décider qui les manipule. La décision est prise EN BASE par
 * `app.autoriser_gestion_postes()` (owner uniquement, migration 178) ; cette
 * fonction ne fait que la transporter jusqu'à la route.
 *
 * ═══ CE QU'ELLE NE FAIT PAS ═════════════════════════════════════════════════
 *
 * Elle ne remplace aucune autre barrière : la route n'est atteignable que sur
 * la machine hôte (`proxy-cabinet.ts` refuse le LAN), et le proxy exige déjà
 * une session ET un jeton de poste. Trois barrières indépendantes, aucune
 * présentée comme suffisante à elle seule.
 */

import { withCaller } from "@/server/db/withCaller";
import { faireePgPort } from "@/server/db/pgPort";

export async function gestionPostesAutorisee(userId: string): Promise<boolean> {
  try {
    const resultat = await withCaller(userId, async (q) =>
      faireePgPort(q, "cabinet.postes").rpc<boolean>("autoriser_gestion_postes", {}),
    );
    return resultat.ok && resultat.data[0] === true;
  } catch {
    // Base injoignable : on refuse. Une porte qui s'ouvre sur une panne n'est
    // pas une porte.
    return false;
  }
}
