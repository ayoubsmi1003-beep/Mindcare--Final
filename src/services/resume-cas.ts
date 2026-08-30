/**
 * Service Résumé du cas — le SEUL appelant de la passerelle dédiée.
 *
 * ⚠️ L'IA NE BLOQUE JAMAIS L'ÉCRAN : cet appel part APRÈS le rendu du
 * workspace, sur geste explicite. L'écran garde toujours un repli
 * (dernier résumé valide, ou Point de situation déterministe).
 *
 * L'écriture n'existe PAS ici : la passerelle appelle elle-même
 * `app.save_case_summary` sous le JWT de l'appelante — une seule chaîne de
 * responsabilité, citations vérifiées deux fois (passerelle puis porte).
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import { versContenu, type ResumeDernier } from "./patients";

interface ResumeRowBrut {
  readonly id: string;
  readonly version: number;
  readonly genere_le: string;
  readonly genere_par: string | null;
  readonly content: unknown;
}

export interface ResultatGeneration {
  readonly resume: ResumeDernier;
}

function versResumeDernier(row: ResumeRowBrut): ResumeDernier {
  return {
    id: row.id,
    version: Number(row.version),
    genereLe: row.genere_le,
    generePar: row.genere_par,
    // Une génération qui vient d'aboutir est par définition à jour des faits
    // qu'elle a lus ; le prochain passage par le workspace recalculera
    // `a_jour` en base si quelque chose bouge entre-temps.
    aJour: true,
    // ⚠️ MÊME NORMALISATION QUE LA LECTURE. Ce fichier en portait une copie
    // « volontairement petite » ; avec deux schémas à distinguer, deux copies
    // auraient divergé — et la divergence se serait vue comme un résumé vide
    // après génération, mais correct après rechargement.
    contenu: versContenu(row.content),
  };
}

export async function genererResumeCas(
  patientId: string,
): Promise<Result<ResultatGeneration>> {
  const result = await db().invokeFunction<{
    resume: ResumeRowBrut;
    totalSignaux?: number;
    plafondSignaux?: number;
  }>("jarvis-resume-cas", { patientId });

  if (!result.ok) {
    log.error("patients.resumeCas.generation", logFieldsFor(result.error));
    return err(result.error);
  }

  log.info("patients.resumeCas.generation", { count: 1 });
  return ok({ resume: versResumeDernier(result.data.resume) });
}
