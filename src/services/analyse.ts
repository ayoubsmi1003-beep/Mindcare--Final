/**
 * Statistiques — le service de l'écran d'analyse.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Il n'appelle que les deux portes de
 * la migration 207, et rien d'autre. La raison est celle d'ADR-019 : une
 * lecture nominative doit passer par une porte qui journalise. Un `select`
 * direct sur `app.patients` est révoqué — et le serait de toute façon.
 *
 * ⚠️ AUCUNE ARITHMÉTIQUE MÉTIER ICI. Les comptes, les parts, les fenêtres de
 * comparaison et les écarts arrivent DÉJÀ calculés par Postgres. Ce fichier
 * VALIDE et RENOMME (snake_case → camelCase), exactement comme
 * `finance-cash.ts`. Un pourcentage recalculé dans le navigateur finirait par
 * diverger du total affiché juste à côté.
 *
 * ⚠️ `null` N'EST PAS `0`. La porte rend `null` pour un rôle non clinique, et
 * `null` pour un taux dont le dénominateur est nul. L'écran doit distinguer
 * « pas de droit », « pas de données » et « zéro mesuré ». Les types ci-dessous
 * gardent cette distinction.
 */

import { z } from "zod";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

// ---------------------------------------------------------------------------
// Les schémas — la frontière de confiance
// ---------------------------------------------------------------------------

/** `bigint` de Postgres : nombre, ou chaîne au-delà de 2^53. */
const NOMBRE = z.coerce.number();
const TEXTE_OU_NUL = z.union([z.string(), z.null()]);

const PERIODE = z.object({
  du: z.string(),
  au: z.string(),
  jours: NOMBRE,
  precedente_du: z.string(),
  precedente_au: z.string(),
  granularite: z.enum(["jour", "semaine", "mois"]),
});

const COUVERTURE = z.object({
  premiere_activite: TEXTE_OU_NUL,
  derniere_activite: TEXTE_OU_NUL,
});

const FLUX = z.object({
  seances: NOMBRE,
  patientes_vues: NOMBRE,
  retours: NOMBRE,
  nouveaux: NOMBRE,
  absences: NOMBRE,
  annulations: NOMBRE,
  notes_signees: NOMBRE,
  notes_manquantes: NOMBRE,
  echelles: NOMBRE,
  changements_traitement: NOMBRE,
});

const PULSE = FLUX.extend({
  patients_total: NOMBRE,
  patients_suivis: NOMBRE,
  rdv_a_venir: NOMBRE,
  rdv_non_clotures: NOMBRE,
  traitements_actifs: NOMBRE,
});

const SEAU = z.object({
  cle: z.string(),
  seances: NOMBRE,
  nouveaux: NOMBRE,
  absences: NOMBRE,
  couvert: z.boolean(),
});

const PART = z.object({ cle: z.string(), n: NOMBRE });
const PART_NULLE = z.object({ cle: TEXTE_OU_NUL, n: NOMBRE });

const DIAGNOSTIC = z.object({
  label: z.string(),
  code: TEXTE_OU_NUL,
  total: NOMBRE,
  actifs: NOMBRE,
});

const ECHELLE = z.object({
  code: z.string(),
  nom: z.string(),
  n: NOMBRE,
  patientes: NOMBRE,
  bandes: z.array(PART_NULLE),
  derniers: z.array(PART_NULLE),
  repetes: NOMBRE,
});

const ENCAISSE = z.object({
  montant: NOMBRE,
  perimetre: z.enum(["cabinet", "praticienne"]),
});

const APERCU = z.object({
  periode: PERIODE,
  couverture: COUVERTURE,
  pulse: PULSE,
  comparaison: FLUX,
  serie: z.array(SEAU),
  statuts: z.array(PART),
  types: z.array(PART),
  jours_semaine: z.array(PART),
  heures: z.array(PART),
  delais: z.array(PART),
  diagnostics: z.array(DIAGNOSTIC),
  echelles: z.array(ECHELLE),
  encaisse: z.union([ENCAISSE, z.null()]),
});

const LIGNE_DETAIL = z.object({
  // Les identifiants sont des `uuid` EN BASE. On ne revalide pas leur forme
  // ici : la version RFC n'est pas un contrat d'affichage, et les bases de
  // développement utilisent des identifiants tous zéro.
  patient_id: z.string(),
  nom: z.string(),
  numero: TEXTE_OU_NUL,
  evenement_le: z.string(),
  consultation_id: z.union([z.string(), z.null()]),
  rendez_vous_id: z.union([z.string(), z.null()]),
  valeur: TEXTE_OU_NUL,
});

const DETAIL = z.object({
  total: NOMBRE,
  lignes: z.array(LIGNE_DETAIL),
});

// ---------------------------------------------------------------------------
// Les types exposés à l'écran
// ---------------------------------------------------------------------------

export type Granularite = z.infer<typeof PERIODE>["granularite"];
export type FluxAnalyse = z.infer<typeof FLUX>;
export type PulseAnalyse = z.infer<typeof PULSE>;
export type SeauActivite = z.infer<typeof SEAU>;
export type PartAnalyse = z.infer<typeof PART>;
export type DiagnosticAnalyse = z.infer<typeof DIAGNOSTIC>;
export type EchelleAnalyse = z.infer<typeof ECHELLE>;
export type EncaissementAnalyse = z.infer<typeof ENCAISSE>;

export interface ApercuAnalyse {
  readonly periode: z.infer<typeof PERIODE>;
  readonly couverture: z.infer<typeof COUVERTURE>;
  readonly pulse: PulseAnalyse;
  readonly comparaison: FluxAnalyse;
  readonly serie: readonly SeauActivite[];
  readonly statuts: readonly PartAnalyse[];
  readonly types: readonly PartAnalyse[];
  readonly joursSemaine: readonly PartAnalyse[];
  readonly heures: readonly PartAnalyse[];
  readonly delais: readonly PartAnalyse[];
  readonly diagnostics: readonly DiagnosticAnalyse[];
  readonly echelles: readonly EchelleAnalyse[];
  readonly encaisse: EncaissementAnalyse | null;
}

export interface LigneAnalyse {
  readonly patientId: string;
  readonly nom: string;
  readonly numero: string | null;
  readonly evenementLe: string;
  readonly consultationId: string | null;
  readonly rendezVousId: string | null;
  readonly valeur: string | null;
}

export interface DetailAnalyse {
  readonly total: number;
  readonly lignes: readonly LigneAnalyse[];
}

/** Les clés de détail acceptées par la porte. Typées : aucune chaîne libre. */
export type CleDetail =
  | "seances"
  | "patientes_vues"
  | "retours"
  | "nouveaux"
  | "absences"
  | "annulations"
  | "rdv_a_venir"
  | "rdv_non_clotures"
  | "statuts"
  | "types"
  | "jours_semaine"
  | "heures"
  | "notes_signees"
  | "notes_manquantes"
  | "diagnostics"
  | "echelles"
  | "traitements_actifs"
  | "changements_traitement"
  | "delais"
  | "serie"
  | "encaisse";

// ---------------------------------------------------------------------------
// Les appels
// ---------------------------------------------------------------------------

/**
 * L'aperçu complet. `null` = aucun droit (rôle non clinique), PAS une erreur :
 * l'écran affiche alors son état vide, sans apprendre qu'il existe un chiffre.
 *
 * ⚠️ LA PORTE REND UN `jsonb`, ET LE PORT LE REND COMME UNE LIGNE UNIQUE.
 * `data[0]` EST donc l'objet entier, pas une ligne dont il faudrait lire une
 * colonne. Se tromper ici donne un écran qui affiche « aucune donnée » alors
 * que la base a répondu — le défaut exact que le contrat ci-dessus ferme.
 */
export async function getAnalyseOverview(
  du: string,
  au: string,
): Promise<Result<ApercuAnalyse | null>> {
  const resultat = await db().rpc<unknown>("get_analysis_overview", { p_from: du, p_to: au });

  if (!resultat.ok) {
    log.error("analyse.apercu", logFieldsFor(resultat.error));
    return err(resultat.error);
  }

  const brut = resultat.data[0] ?? null;
  if (brut === null) return ok(null);

  const lu = APERCU.safeParse(brut);
  if (!lu.success) {
    // Une divergence de contrat doit se voir comme un bloc explicite, jamais
    // comme un plantage de rendu au pire moment.
    log.error(
      "analyse.apercu.contrat",
      logFieldsFor({ code: "inattendu", message: String(lu.error.issues.length) }),
    );
    return err({ code: "inattendu", message: "Réponse d'analyse illisible." });
  }

  const a = lu.data;
  return ok({
    periode: a.periode,
    couverture: a.couverture,
    pulse: a.pulse,
    comparaison: a.comparaison,
    serie: a.serie,
    statuts: a.statuts,
    types: a.types,
    joursSemaine: a.jours_semaine,
    heures: a.heures,
    delais: a.delais,
    diagnostics: a.diagnostics,
    echelles: a.echelles,
    encaisse: a.encaisse,
  });
}

/**
 * Le détail nominatif — appelé UNIQUEMENT sur un clic. La porte écrit la trace
 * de lecture `liste` avant de rendre un nom. `offset` pagine par 50.
 */
export async function getAnalyseDetail(
  kind: CleDetail,
  cle: string | null,
  du: string,
  au: string,
  offset = 0,
  grain: Granularite = "jour",
): Promise<Result<DetailAnalyse | null>> {
  const resultat = await db().rpc<unknown>("get_analysis_drilldown", {
    p_kind: kind,
    p_cle: cle,
    p_from: du,
    p_to: au,
    p_offset: offset,
    p_limit: 50,
    p_grain: grain,
  });

  if (!resultat.ok) {
    log.error("analyse.detail", logFieldsFor(resultat.error));
    return err(resultat.error);
  }

  const brut = resultat.data[0] ?? null;
  if (brut === null) return ok(null);

  const lu = DETAIL.safeParse(brut);
  if (!lu.success) {
    log.error(
      "analyse.detail.contrat",
      logFieldsFor({ code: "inattendu", message: String(lu.error.issues.length) }),
    );
    return err({ code: "inattendu", message: "Réponse d'analyse illisible." });
  }

  return ok({
    total: lu.data.total,
    lignes: lu.data.lignes.map((l) => ({
      patientId: l.patient_id,
      nom: l.nom,
      numero: l.numero,
      evenementLe: l.evenement_le,
      consultationId: l.consultation_id,
      rendezVousId: l.rendez_vous_id,
      valeur: l.valeur,
    })),
  });
}
