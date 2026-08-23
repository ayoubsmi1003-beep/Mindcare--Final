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
import type { ResumeDernier, TypeSourceResume } from "./patients";

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
    contenu: normaliserContenu(row.content),
  };
}

/** Même façonnage tolérant que côté lecture (patients.ts), dupliqué volontairement petit. */
function normaliserContenu(brut: unknown): ResumeDernier["contenu"] {
  const o =
    typeof brut === "object" && brut !== null
      ? (brut as Record<string, unknown>)
      : {};
  const items = (cle: string): ResumeDernier["contenu"]["enBref"] => {
    const v = o[cle];
    if (!Array.isArray(v)) return [];
    return v.flatMap((i) => {
      if (typeof i !== "object" || i === null) return [];
      const texte = (i as { texte?: unknown }).texte;
      if (typeof texte !== "string") return [];
      const sources = Array.isArray((i as { sources?: unknown }).sources)
        ? ((i as { sources: ReadonlyArray<unknown> }).sources.flatMap((s) => {
            if (typeof s !== "object" || s === null) return [];
            const t = (s as { t?: unknown }).t;
            const id = (s as { id?: unknown }).id;
            return typeof t === "string" && typeof id === "string"
              ? [{ t: t as TypeSourceResume, id }]
              : [];
          }))
        : [];
      return [{ texte, sources }];
    });
  };
  return {
    schema: 1,
    enBref: items("en_bref"),
    evolutionRecente: items("evolution_recente"),
    aDiscuter: items("a_discuter"),
    dernierEtat:
      typeof o.dernier_etat === "object" && o.dernier_etat !== null
        ? (o.dernier_etat as Readonly<Record<string, unknown>>)
        : null,
    traitementsDocumentes: items("traitements_documentes"),
    pointsAttention: items("points_attention"),
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
