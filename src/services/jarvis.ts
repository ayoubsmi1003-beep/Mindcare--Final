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
import { logFieldsFor } from "./errors";
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
    log.error("jarvis.analyseSeance", logFieldsFor(result.error));
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

// ═══════════════════════════════════════════════════════════════════════════
// V2 — LE PANNEAU
// ═══════════════════════════════════════════════════════════════════════════

/** Les trois issues d'ADR-023, décidées par `_shared/routing.ts` côté serveur. */
export type CheminJarvis = "connaissance" | "patient" | "refus";

/**
 * Ce que la passerelle rend. `outil` est une PROPOSITION : le nom et les
 * arguments viennent du modèle et n'ont encore franchi aucune validation
 * stricte. C'est `jarvis-tools.validerArguments` qui décide s'ils existent.
 */
export type ReponseJarvis =
  | {
      readonly chemin: CheminJarvis;
      readonly type: "texte";
      readonly reponse: string;
      /** Présent sur le seul chemin connaissance — l'interface affiche le registre. */
      readonly registre?: "connaissance-generale";
    }
  | {
      readonly chemin: CheminJarvis;
      readonly type: "outil";
      readonly nom: string;
      readonly args: unknown;
    };

/**
 * Une question à Jarvis. Le ROUTAGE N'EST PAS FAIT ICI et ne doit jamais
 * l'être : il vit dans la passerelle, hors d'atteinte du navigateur. Un
 * classement décidé côté client serait modifiable depuis les outils de
 * développement — c'est-à-dire pas une frontière.
 */
export async function demanderAJarvis(
  message: string,
  conversationId: string,
  /**
   * Résultat du tour précédent — les identifiants que le modèle ne peut pas
   * deviner. Facultatif, et ignoré par la passerelle sur les chemins
   * CONNAISSANCE et REFUS : seul le chemin patient le lit.
   */
  /**
   * Les dossiers du tour précédent, EN CHAMPS. La passerelle masque `nom` et
   * `numero` par des jetons avant l'appel externe, puis compose le bloc et
   * réhydrate la réponse (arbitrage du 2026-08-13, branche b).
   *
   * ⚠️ CE N'EST PAS UNE FRONTIÈRE DE SÉCURITÉ, et ce commentaire existe pour
   * qu'on ne le croie pas : le message libre de l'utilisatrice part BRUT, avec
   * les noms qu'elle y écrit, et les UUID partent en clair. Ceci masque le seul
   * bloc que nous composons nous-mêmes. Réduction de l'exposition, pas
   * suppression.
   */
  contexteDossiers?: readonly {
    readonly id: string;
    readonly nom: string;
    readonly numero: string;
  }[],
  contextePraticienId?: string,
): Promise<Result<ReponseJarvis>> {
  const result = await db().invokeFunction<ReponseJarvis>("jarvis-chat", {
    message,
    conversationId,
    ...(contexteDossiers === undefined || contexteDossiers.length === 0
      ? {}
      : { contexteDossiers, ...(contextePraticienId === undefined ? {} : { contextePraticienId }) }),
  });

  if (!result.ok) {
    log.error("jarvis.chat", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(result.data);
}
