/**
 * Journal applicatif structuré.
 *
 * I5 EST APPLIQUÉ PAR LE TYPE, PAS PAR LA VIGILANCE. `LogFields` est une
 * interface FERMÉE : un champ non déclaré est une erreur de compilation. On ne
 * peut donc pas écrire `log("recherche", { nom: patient.lastName })` — ça ne
 * compile pas. C'est délibérément plus rigide qu'un `Record<string, unknown>` :
 * un journal permissif finit toujours par porter un nom, généralement le jour
 * où quelqu'un débogue en urgence.
 *
 * CE N'EST PAS L'AUDIT LÉGAL. L'audit d'I4 vit dans `audit.log`, en base, en
 * ajout seul, alimenté par les déclencheurs de 013 et les fonctions de 017.
 * Ceci est un journal de DIAGNOSTIC, volatile, pour comprendre une panne. Ne
 * jamais présenter l'un pour l'autre devant un juge.
 */

/**
 * `patientId` A ÉTÉ RETIRÉ DE CETTE INTERFACE, et ne doit pas y revenir.
 *
 * Il y figurait avec le commentaire « identifiant technique, non identifiant en
 * soi ». La règle 1 de CLAUDE.md dit exactement l'inverse : elle nomme
 * `patient_id` dans la liste des données qui ne quittent jamais la machine —
 * « pas vers un log ». Un UUID qui désigne une personne dans un cabinet de
 * psychiatrie de quelques centaines de dossiers EST identifiant : recoupé avec
 * un horodatage et un agenda, il nomme quelqu'un.
 *
 * L'argument « ce n'est pas grave, on ne journalise pas en production » ne tient
 * pas non plus : c'est une garantie d'une seule ligne (`NODE_ENV`), et le jour
 * où quelqu'un la déplace pour déboguer une panne en cabinet, la fuite est déjà
 * écrite. On retire la possibilité plutôt que la circonstance.
 *
 * Pour relier une panne à un dossier, la trace légale existe déjà et elle est au
 * bon endroit : `audit.log`, en base, en ajout seul, illisible par l'API.
 */
export interface LogFields {
  /** Code d'erreur applicatif ou SQLSTATE. Jamais un message. */
  readonly code?: string;
  /** Durée en millisecondes. */
  readonly durationMs?: number;
  /** Nombre de lignes rendues. Un compte, jamais un contenu. */
  readonly count?: number;
}

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, event: string, fields: LogFields): void {
  // Pas de journal en production tant qu'aucune destination n'est choisie.
  // Écrire dans la console du navigateur en cabinet, c'est laisser une trace
  // lisible par quiconque ouvre les outils de développement sur le poste — et
  // ce poste est dans une salle de consultation.
  if (process.env.NODE_ENV === "production") return;

  const payload: Record<string, string | number> = { event };
  if (fields.code !== undefined) payload["code"] = fields.code;
  if (fields.durationMs !== undefined) payload["durationMs"] = fields.durationMs;
  if (fields.count !== undefined) payload["count"] = fields.count;

  console[level](JSON.stringify(payload));
}

export const log = {
  info: (event: string, fields: LogFields = {}): void => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}): void => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}): void => emit("error", event, fields),
};
