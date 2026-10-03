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

import { z } from "zod";
import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import { versContenu, type ResumeDernier } from "./patients";
import { alexa } from "@/i18n/alexa";

interface ResumeRowBrut {
  readonly id: string;
  readonly version: number;
  readonly genere_le: string;
  readonly genere_par: string | null;
  readonly content: unknown;
  readonly aJour?: boolean;
}

export interface ResultatGeneration {
  readonly resume: ResumeDernier;
}

const savedSummary = z.object({
  id: z.uuid(), version: z.number().int().positive(), genere_le: z.string(), genere_par: z.string().nullable(),
  content: z.unknown().refine(value => typeof value === "object" && value !== null && !Array.isArray(value)),
  aJour: z.boolean(),
}).strict();

/** Post-render read: some existing workspace versions omit their summary field. */
export async function chargerResumeCas(patientId: string): Promise<Result<{ readonly resume: ResumeDernier | null }>> {
  const result = await db().rpc<unknown>("get_alexa_case_summary", { p_patient_id: patientId });
  if (!result.ok) return err(result.error);
  if (result.data[0] === null) return ok({ resume: null });
  const parsed = savedSummary.safeParse(result.data[0]);
  if (!parsed.success) return err({ code: "indisponible", message: alexa.lectureIndisponible, context: "alexa.summary.read" });
  return ok({ resume: { ...versResumeDernier(parsed.data), aJour: parsed.data.aJour } });
}

/** Database compares the whole clinical revision, including updates that do not change counts. */
export async function verifierFraicheurResume(patientId: string): Promise<Result<{ readonly aJour: boolean }>> {
  const result = await db().rpc<{ readonly aJour: boolean }>("get_alexa_summary_status", { p_patient_id: patientId });
  if (!result.ok) return err(result.error);
  const status = result.data[0];
  return status ? ok(status) : err({ code: "indisponible", message: alexa.lectureIndisponible, context: "alexa.summary.status" });
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
    aJour: row.aJour ?? true,
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
