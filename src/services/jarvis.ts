/**
 * Client de l'unique outil Jarvis de S6 — `analyze_session`.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE ET N'IMPORTE AUCUN CLIENT LLM. Il
 * n'appelle qu'`invokeFunction("jarvis-analyze-session", …)`, exactement comme
 * `consultations.ts` n'appelle que des portes RPC (026). La passerelle Deno
 * (`supabase/functions/`) est la SEULE chose qui parle à OpenRouter — voir
 * `_shared/external-call.ts`.
 *
 * `write: false` (`03-JARVIS-TOOLS.md` §3, `JARVIS-DEMO-SPEC.md` §2) : cet
 * appel ne pose AUCUNE ligne `jarvis_actions`, n'écrit rien dans la note SOAP,
 * et n'a besoin d'aucune carte de confirmation. Le résultat est un BROUILLON
 * affiché en lecture seule — `draft_clinical_note`, un outil distinct et
 * `write: true`, est ce qui préremplirait un jour l'éditeur SOAP.
 */

import type { NoteSoap } from "./consultations";
import { db } from "./db";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export interface AnalyseSeance {
  readonly noteStructuree: NoteSoap;
  readonly evolution: readonly string[];
  readonly pointsNonExplores: readonly string[];
}

interface AnalyseSeanceRow {
  readonly noteStructuree: {
    readonly subjective: string;
    readonly objective: string;
    readonly assessment: string;
    readonly plan: string;
  };
  readonly evolution: readonly string[];
  readonly pointsNonExplores: readonly string[];
}

/**
 * Analyse la séance en cours : notes brutes + historique du patient, relus
 * depuis la base au moment de l'appel — jamais depuis une mémoire d'agent
 * (garde-fou n°1 de `JARVIS-DEMO-SPEC.md` §2 bis, « Jarvis ne se souvient
 * d'aucun fait clinique »).
 *
 * Aucun identifiant patient ici, en succès comme en échec : la trace
 * nominative légale est écrite en base par `get_consultation`, que la
 * passerelle appelle avant tout envoi au modèle (règle 1, I5).
 */
export async function analyzeSession(consultationId: string): Promise<Result<AnalyseSeance>> {
  const result = await db().invokeFunction<AnalyseSeanceRow>("jarvis-analyze-session", {
    consultationId,
  });

  if (!result.ok) {
    log.error("jarvis.analyseSeance", { code: result.error.code });
    return err(result.error);
  }

  return ok({
    noteStructuree: {
      subjective: result.data.noteStructuree.subjective,
      objective: result.data.noteStructuree.objective,
      assessment: result.data.noteStructuree.assessment,
      plan: result.data.noteStructuree.plan,
    },
    evolution: result.data.evolution,
    pointsNonExplores: result.data.pointsNonExplores,
  });
}
