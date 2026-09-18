/**
 * Dossiers patients — ADR-019.
 *
 * ⚠️ AUCUN `select` SUR LA TABLE `patients` DANS CE FICHIER, ET NULLE PART
 * AILLEURS. La migration 017 a révoqué `SELECT ON app.patients` à
 * `authenticated` et à `service_role`. Un accès direct ne rendrait pas une
 * liste vide — il rendrait `42501 permission denied`. Ce n'est pas une
 * restriction qu'on s'impose par discipline : c'est la base qui refuse.
 *
 * Les fonctions ci-dessous appellent les seules portes ouvertes, qui
 * journalisent la lecture dans `audit.log` avant de retourner, dans la même
 * transaction (I4). Il n'existe pas de chemin qui lise un dossier sans laisser
 * de trace, et c'est la raison d'être de tout le dispositif.
 *
 * Conséquence à connaître avant d'écrire un écran : les filtres et la
 * pagination de PostgREST ne s'appliquent plus ici. Ce sont des PARAMÈTRES, et
 * `p_limit` est borné EN BASE — une pagination que l'appelant choisit sans
 * limite est un export.
 *
 * ═══ CE QUE PATIENTS V2 A AJOUTÉ ═══════════════════════════════════════════
 *
 * `getPatientWorkspace` — la façade de lecture de l'espace de travail : tout
 * l'écran d'ouverture en UN appel (047). C'est un PRÉCURSEUR du Digital Twin
 * canonique, pas le Digital Twin : aucune projection, aucune vue matérialisée,
 * aucun cache. Le champ `contrat` en porte la version de forme.
 *
 * `listPatientTimeline` — la chronologie, paginée en KEYSET. Le curseur part
 * en DEUX SCALAIRES parce que `RpcArgs` n'accepte pas d'objet (voir plus bas).
 *
 * `updatePatient` — la modification. Elle passe par `app.update_patient`,
 * l'unique porte d'écriture ; aucun second chemin n'est créé.
 *
 * ═══ CE QUE CE FICHIER NE DÉCIDE PAS ═══════════════════════════════════════
 *
 * Il ne décide rien de la cloison. `clinique` et `traitements` valent `null`
 * quand la porte les a rendus nuls : c'est une absence de DROIT, distincte
 * d'une absence de DONNÉE (qui, elle, arrive en objet aux listes vides). Un
 * `if (role === …)` ici serait un défaut de conception (règle 4).
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor, type AppError } from "./errors";
import { log } from "./log";
import { err, ok, type Page, type Result } from "./result";

// ---------------------------------------------------------------------------
// Identité — les types de base
// ---------------------------------------------------------------------------

/** Ligne de liste. Volontairement pauvre : une liste n'a pas besoin du dossier. */
export interface PatientListItem {
  readonly id: string;
  readonly recordNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string | null;
  /**
   * L'âge en années révolues, CALCULÉ PAR LA PORTE (066) — jamais ici.
   *
   * ⚠️ NE PAS LE RECALCULER À PARTIR DE `birthDate`. Un âge dérivé dans le
   * navigateur dépend de l'horloge du poste : une machine mal réglée vieillit
   * ou rajeunit une patiente d'un an, en silence, et le jour de l'anniversaire
   * l'erreur devient systématique. Même motif que `format.ts`.
   *
   * `null` quand la date de naissance est inconnue — l'absence se dit, elle ne
   * s'affiche pas « 0 ans » (règle 8).
   */
  readonly age: number | null;
  readonly phone: string;
  readonly isActive: boolean;
}

/**
 * Contact d'urgence. La colonne est un `jsonb` SANS AUCUNE CONTRAINTE en base
 * (004) : n'importe quelle forme a pu y être écrite. On lit donc avec
 * tolérance — une forme inattendue rend `null`, jamais une exception qui
 * ferait tomber la fiche entière pendant une consultation.
 */
export interface EmergencyContact {
  readonly name: string | null;
  readonly relation: string | null;
  readonly phone: string | null;
}

export interface Patient extends PatientListItem {
  readonly cabinetId: string;
  readonly practitionerId: string;
  readonly sex: Sexe | null;
  readonly address: string | null;
  readonly phoneAlt: string | null;
  readonly notesAdmin: string | null;
  readonly idDocumentNumber: string | null;
  readonly idDocumentIssuer: string | null;
  readonly emergencyContact: EmergencyContact | null;
  /**
   * 088. `null` = NON RENSEIGNÉE, et ce n'est pas « célibataire ».
   *
   * La distinction compte au-delà du dossier : `app.civilite` imprime « Mlle »
   * pour une femme célibataire et « Mme » partout ailleurs, `null` compris.
   * Confondre l'absence avec une valeur ferait imprimer une civilité que
   * personne n'a saisie sur un certificat remis au patient.
   */
  readonly maritalStatus: SituationFamiliale | null;
}

export type Sexe = "M" | "F";

/** 088. Reflète exactement l'enum `app.marital_status`. */
export type SituationFamiliale =
  | "celibataire"
  | "en_couple"
  | "marie"
  | "divorce"
  | "veuf";

export const SITUATIONS_FAMILIALES: readonly SituationFamiliale[] = [
  "celibataire",
  "en_couple",
  "marie",
  "divorce",
  "veuf",
];

export interface PatientSearchFilters {
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}

interface SearchRow {
  readonly id: string;
  readonly record_number: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly birth_date: string | null;
  readonly age: number | null;
  readonly phone: string;
  readonly is_active: boolean;
  readonly total_count: number;
}

interface PatientRow extends SearchRow {
  readonly cabinet_id: string;
  readonly practitioner_id: string;
  readonly sex: Sexe | null;
  readonly address: string | null;
  readonly phone_alt: string | null;
  readonly notes_admin: string | null;
  readonly id_document_number: string | null;
  readonly id_document_issuer: string | null;
  readonly emergency_contact: unknown;
  readonly marital_status: SituationFamiliale | null;
}

function toListItem(row: SearchRow): PatientListItem {
  return {
    id: row.id,
    recordNumber: row.record_number,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    // `?? null` et non `row.age` seul : tant que 066 n'est pas appliquée, la
    // porte ne renvoie pas la colonne et la valeur est `undefined`. L'écran
    // doit alors ne RIEN afficher — pas « undefined ans ». Le dépôt a déjà été
    // en avance sur la base ; on rend cette avance inoffensive.
    age: row.age ?? null,
    phone: row.phone,
    isActive: row.is_active,
  };
}

// ---------------------------------------------------------------------------
// Le contact d'urgence — lecture tolérante
// ---------------------------------------------------------------------------
// `.nullish()` et non `.optional()` : la clé peut être absente OU explicitement
// nulle, et les deux veulent dire la même chose ici. Un objet dont aucune des
// trois clés n'est exploitable rend `null` plutôt qu'un contact vide, qui
// s'afficherait comme une carte de contact sans contact.
const CONTACT_URGENCE = z.object({
  name: z.string().nullish(),
  relation: z.string().nullish(),
  phone: z.string().nullish(),
});

function versContactUrgence(brut: unknown): EmergencyContact | null {
  if (brut === null || brut === undefined) return null;

  const analyse = CONTACT_URGENCE.safeParse(brut);
  if (!analyse.success) return null;

  const contact: EmergencyContact = {
    name: analyse.data.name ?? null,
    relation: analyse.data.relation ?? null,
    phone: analyse.data.phone ?? null,
  };

  const vide =
    contact.name === null && contact.relation === null && contact.phone === null;
  return vide ? null : contact;
}

// ---------------------------------------------------------------------------
// L'erreur de schéma — nommée, jamais générique (motif finance-cash.ts)
// ---------------------------------------------------------------------------
// Une réponse qui ne respecte pas le contrat de la porte n'a rien
// d'« inattendu » : elle est NOMMÉE. `technical` dit LAQUELLE des portes a
// dévié, ce qu'aucun aveu générique ne permettrait de retrouver plus tard.
function erreurDeSchema(porte: string): AppError {
  return {
    code: "regle-metier",
    message: fr.patients.reponseIncoherente,
    technical: "schema",
    context: `rpc:${porte}`,
  };
}

/**
 * Le CHEMIN des clés fautives, jamais une valeur : citer les données reçues
 * ferait sortir un nom, un téléphone ou une adresse dans un journal (règle 1).
 */
function cheminsZod(erreur: z.ZodError): string {
  return erreur.issues.map((i) => i.path.join(".")).join(",");
}

// ---------------------------------------------------------------------------
// Recherche et fiche — inchangées dans leur contrat
// ---------------------------------------------------------------------------

export async function searchPatients(
  filters: PatientSearchFilters = {},
): Promise<Result<Page<PatientListItem>>> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  const result = await db().rpc<SearchRow>("search_patients", {
    p_query: filters.query ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (!result.ok) {
    log.error("patients.recherche", logFieldsFor(result.error));
    return err(result.error);
  }

  const rows = result.data.map(toListItem);
  // `total_count` est identique sur toutes les lignes (CROSS JOIN en base).
  // Zéro ligne signifie zéro résultat VISIBLE — pas zéro patient : la RLS a pu
  // filtrer l'intégralité du résultat, et c'est un fonctionnement normal.
  const total = result.data[0]?.total_count ?? 0;

  log.info("patients.recherche", { count: rows.length });
  return ok({ rows, total, offset, limit });
}

export async function getPatient(id: string): Promise<Result<Patient | null>> {
  const result = await db().rpc<PatientRow>("get_patient", { p_id: id });

  if (!result.ok) {
    // Pas de `patientId` ici : règle 1 et I5. L'événement et le code suffisent
    // à diagnostiquer ; la trace nominative légale est dans `audit.log`, écrite
    // par `app.get_patient` avant même que cette erreur ne survienne.
    log.error("patients.fiche", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // Dossier inexistant OU hors du périmètre de l'appelant : la base ne
    // distingue pas les deux, et l'interface ne doit pas non plus. Répondre
    // « ce dossier existe mais ne vous est pas accessible » divulguerait
    // l'existence d'un patient d'une autre praticienne (cloison ADR-003).
    return ok(null);
  }

  return ok({
    ...toListItem(row),
    cabinetId: row.cabinet_id,
    practitionerId: row.practitioner_id,
    sex: row.sex,
    address: row.address,
    phoneAlt: row.phone_alt,
    notesAdmin: row.notes_admin,
    idDocumentNumber: row.id_document_number,
    idDocumentIssuer: row.id_document_issuer,
    emergencyContact: versContactUrgence(row.emergency_contact),
    maritalStatus: row.marital_status,
  });
}

// ---------------------------------------------------------------------------
// L'espace de travail — le contrat de la porte 047
// ---------------------------------------------------------------------------
// La frontière de confiance. Ce qui n'est pas décrit ici n'entre pas dans
// l'application, même si la porte le rendait un jour.

/** `numeric` de Postgres arrive en nombre ou en chaîne selon l'amplitude. */
const NOMBRE = z.coerce.number();

const IDENTITE = z.object({
  id: z.string(),
  record_number: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string().nullable(),
  age: NOMBRE.nullable(),
  sex: z.enum(["M", "F"]).nullable(),
  // 089. `nullish` et non `nullable` : une base servie par une version
  // antérieure du contrat n'envoie pas la clé du tout, et l'écran doit
  // continuer d'ouvrir la fiche plutôt que d'échouer sur un champ d'affichage.
  marital_status: z
    .enum(["celibataire", "en_couple", "marie", "divorce", "veuf"])
    .nullish(),
  is_active: z.boolean(),
});

const CONTACT = z.object({
  phone: z.string(),
  phone_alt: z.string().nullable(),
  address: z.string().nullable(),
  emergency_contact: z.unknown(),
});

const IDENTIFICATION = z.object({
  id_document_number: z.string().nullable(),
  id_document_issuer: z.string().nullable(),
});

const DIAGNOSTIC = z.object({
  id: z.string(),
  code_system: z.string(),
  code: z.string().nullable(),
  label: z.string(),
  is_primary: z.boolean(),
  onset_date: z.string().nullable(),
  resolved_at: z.string().nullable(),
});

// ⚠️ `precedent` et `delta` sont nuls quand il n'existe qu'UNE mesure. La porte
// le garantit, et l'écran s'appuie dessus pour ne pas dessiner une tendance à
// partir d'une seule observation.
const ECHELLE = z.object({
  scale_code: z.string(),
  scale_name: z.string(),
  dernier: z.object({
    score: NOMBRE.nullable(),
    date: z.string(),
    interpretation: z.string().nullable(),
  }),
  precedent: z
    .object({ score: NOMBRE.nullable(), date: z.string() })
    .nullable(),
  delta: NOMBRE.nullable(),
});

const CONSULTATION_RESUME = z.object({
  id: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  status: z.string(),
  kind: z.string().nullable(),
  practitioner_name: z.string().nullable(),
});

const LIGNE_PRESCRIPTION = z.object({
  id: z.string(),
  designation: z.string().nullable(),
  brand_name: z.string().nullable(),
  dose: z.string().nullable(),
  frequency_per_day: NOMBRE.nullable(),
  duration_days: NOMBRE.nullable(),
  instructions: z.string().nullable(),
});

const PRESCRIPTION = z.object({
  id: z.string(),
  prescribed_at: z.string(),
  is_handwritten: z.boolean(),
  practitioner_name: z.string().nullable(),
  lignes: z.array(LIGNE_PRESCRIPTION),
});

const RENDEZ_VOUS_RESUME = z.object({
  id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.string(),
  kind: z.string().nullable(),
  practitioner_name: z.string().nullable(),
});

const TRAITEMENT_V2 = z.object({
  id: z.string(),
  status: z.enum(["active", "paused", "stopped"]),
  dose: z.string().nullable(),
  dose_unit: z.string().nullable(),
  frequency: z.string().nullable(),
  timing: z.unknown(),
  instructions: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  stopped_at: z.string().nullable(),
  stopped_reason: z.string().nullable(),
  current_version: NOMBRE,
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
  medication_id: z.string(),
  medication_raw: z.string().nullable(),
  brand_name: z.string().nullable(),
  form: z.string().nullable(),
  strength: z.string().nullable(),
  inn: z.string().nullable().optional(),
});

const ESPACE_TRAVAIL = z.object({
  contrat: z.literal(1),
  genere_a: z.string(),
  identite: IDENTITE,
  contact: CONTACT,
  identification: IDENTIFICATION,
  admin: z.object({ notes_admin: z.string().nullable() }),
  // `null` = domaine inaccessible. Objet aux listes vides = accessible, sans
  // donnée. Les deux se distinguent, et c'est tout l'enjeu de la porte.
  clinique: z
    .object({
      diagnostics: z.array(DIAGNOSTIC),
      echelles: z.array(ECHELLE),
      derniere_consultation: CONSULTATION_RESUME.nullable(),
      nombre_consultations: NOMBRE,
    })
    .nullable(),
  traitements: z
    .object({
      derniere_prescription: PRESCRIPTION.nullable(),
      nombre_prescriptions: NOMBRE,
    })
    .nullable(),
  // ADR-028 traitements_v2 — additif, jamais cassant (contrat reste 1).
  traitements_v2: z
    .object({
      actifs: z.array(TRAITEMENT_V2),
      en_pause: z.array(TRAITEMENT_V2),
      arretes_recents: z.array(TRAITEMENT_V2),
      total_actifs: NOMBRE,
      total: NOMBRE,
    })
    .nullable()
    .optional(),
  agenda: z.object({
    prochain_rendez_vous: RENDEZ_VOUS_RESUME.nullable(),
    dernier_rendez_vous: RENDEZ_VOUS_RESUME.nullable(),
    nombre_rendez_vous: NOMBRE,
  }),
  documents: z.object({
    nombre: NOMBRE,
    dernier_emis_le: z.string().nullable(),
  }),
  // Patients V3 — champs ADDITIFS (contrat INCHANGÉ à 1 : une clé optionnelle
  // ne casse aucun consommateur existant). Absents des réponses d'avant 053.
  rendez_vous_du_jour: z.array(RENDEZ_VOUS_RESUME).optional(),
  resume: z
    .object({
      id: z.string(),
      version: NOMBRE,
      genere_le: z.string(),
      genere_par: z.string().nullable(),
      a_jour: z.boolean(),
      contenu: z.unknown(),
    })
    .nullable()
    .optional(),
});

export interface Diagnostic {
  readonly id: string;
  readonly codeSystem: string;
  readonly code: string | null;
  readonly label: string;
  readonly isPrimary: boolean;
  readonly onsetDate: string | null;
  readonly resolvedAt: string | null;
}

export interface EchelleResume {
  readonly scaleCode: string;
  readonly scaleName: string;
  readonly dernier: {
    readonly score: number | null;
    readonly date: string;
    readonly interpretation: string | null;
  };
  readonly precedent: { readonly score: number | null; readonly date: string } | null;
  readonly delta: number | null;
}

export interface ConsultationResume {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: string;
  readonly kind: string | null;
  readonly practitionerName: string | null;
}

export interface LignePrescription {
  readonly id: string;
  readonly designation: string | null;
  readonly brandName: string | null;
  readonly dose: string | null;
  readonly frequencyPerDay: number | null;
  readonly durationDays: number | null;
  readonly instructions: string | null;
}

export interface PrescriptionResume {
  readonly id: string;
  readonly prescribedAt: string;
  readonly isHandwritten: boolean;
  readonly practitionerName: string | null;
  readonly lignes: readonly LignePrescription[];
}

export interface TraitementV2 {
  readonly id: string;
  readonly status: "active" | "paused" | "stopped";
  readonly dose: string | null;
  readonly doseUnit: string | null;
  readonly frequency: string | null;
  readonly timing: readonly string[];
  readonly instructions: string | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly stoppedAt: string | null;
  readonly stoppedReason: string | null;
  readonly currentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string | null;
  readonly medicationId: string;
  readonly medicationRaw: string | null;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strength: string | null;
  readonly inn: string | null;
}

export interface RendezVousResume {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: string;
  readonly kind: string | null;
  readonly practitionerName: string | null;
}

export interface PatientWorkspace {
  readonly contrat: 1;
  /** ISO 8601 AVEC offset. Formaté en heure d'Alger à l'affichage seulement. */
  readonly genereA: string;

  readonly identite: {
    readonly id: string;
    readonly recordNumber: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly birthDate: string | null;
    readonly age: number | null;
    readonly sex: Sexe | null;
    readonly maritalStatus: SituationFamiliale | null;
    readonly isActive: boolean;
  };

  readonly contact: {
    readonly phone: string;
    readonly phoneAlt: string | null;
    readonly address: string | null;
    readonly emergencyContact: EmergencyContact | null;
  };

  readonly identification: {
    readonly idDocumentNumber: string | null;
    readonly idDocumentIssuer: string | null;
  };

  readonly admin: { readonly notesAdmin: string | null };

  /** `null` = domaine inaccessible à ce rôle. Objet vide = accessible, sans donnée. */
  readonly clinique: {
    readonly diagnostics: readonly Diagnostic[];
    readonly echelles: readonly EchelleResume[];
    readonly derniereConsultation: ConsultationResume | null;
    readonly nombreConsultations: number;
  } | null;

  readonly traitements: {
    readonly dernierePrescription: PrescriptionResume | null;
    readonly nombrePrescriptions: number;
  } | null;

  readonly traitementsV2: {
    readonly actifs: readonly TraitementV2[];
    readonly enPause: readonly TraitementV2[];
    readonly arretesRecents: readonly TraitementV2[];
    readonly totalActifs: number;
    readonly total: number;
  } | null;

  readonly agenda: {
    readonly prochainRendezVous: RendezVousResume | null;
    readonly dernierRendezVous: RendezVousResume | null;
    readonly nombreRendezVous: number;
  };

  readonly documents: {
    readonly nombre: number;
    readonly dernierEmisLe: string | null;
  };

  /** RDV du jour, bornes Africa/Algiers — le bandeau « Aujourd'hui ». */
  readonly rendezVousDuJour: readonly RendezVousResume[];

  /** Dernière version valide du Résumé du cas ; null = aucune (ou hors droit). */
  readonly resume: ResumeDernier | null;
}

// ---------------------------------------------------------------------------
// Patients V3 — le Résumé du cas (contrat `content.schema: 1`)
// ---------------------------------------------------------------------------
// La vérité clinique reste en base. Chaque item porte ses SOURCES — la porte
// `save_case_summary` refuse toute citation qui ne correspond pas à une ligne
// réelle du patient, côté SQL ; ici on ne fait que donner une FORME lisible.

export type TypeSourceResume =
  | "diagnostic"
  | "echelle"
  | "prescription"
  | "consultation"
  | "rdv"
  | "document";

const TYPES_SOURCE: readonly TypeSourceResume[] = [
  "diagnostic",
  "echelle",
  "prescription",
  "consultation",
  "rdv",
  "document",
];

export interface SourceResume {
  readonly t: TypeSourceResume;
  readonly id: string;
}

export interface ItemResume {
  readonly texte: string;
  readonly sources: readonly SourceResume[];
}

/** Sections fermées — l'ensemble est verrouillé par la porte (053/055). */
/** La forme historique — cinq sections plates, sans dimension temporelle. */
export interface ContenuResumeV1 {
  readonly schema: 1;
  readonly enBref: readonly ItemResume[];
  readonly evolutionRecente: readonly ItemResume[];
  readonly aDiscuter: readonly ItemResume[];
  readonly dernierEtat: Readonly<Record<string, unknown>> | null;
  readonly traitementsDocumentes: readonly ItemResume[];
  readonly pointsAttention: readonly ItemResume[];
}

/** L'aperçu compact — composé EN BASE, jamais rédigé par un modèle (068/069). */
export interface ApercuResume {
  readonly nom: string;
  readonly age: number | null;
  readonly residence: string | null;
  readonly diagnostics: readonly ItemResume[];
  readonly traitements: readonly ItemResume[];
  readonly contexte: readonly ItemResume[];
}

export interface PeriodeResume {
  readonly periode: string;
  readonly entrees: readonly ItemResume[];
}

/** La forme chronologique (069) — aperçu, parcours par période, état actuel. */
export interface ContenuResumeV2 {
  readonly schema: 2;
  readonly apercu: ApercuResume;
  readonly chronologie: readonly PeriodeResume[];
  readonly anterieur: readonly ItemResume[];
  readonly etatActuel: readonly ItemResume[];
}

/**
 * ⚠️ UNION DISCRIMINÉE, ET LES DEUX BRANCHES RESTENT VIVANTES. Les résumés
 * déjà écrits en schéma 1 ne deviennent pas illisibles le jour du
 * déploiement : l'écran lit `schema` et rend la forme correspondante. Un
 * remplacement sec aurait affiché « aucun résumé » sur tous les dossiers
 * jusqu'à leur régénération — une perte visible, pour rien.
 */
export type ContenuResumeCas = ContenuResumeV1 | ContenuResumeV2;

export interface ResumeDernier {
  readonly id: string;
  readonly version: number;
  readonly genereLe: string;
  readonly generePar: string | null;
  /** Calculé EN BASE : les faits couverts n'ont pas bougé depuis la génération. */
  readonly aJour: boolean;
  readonly contenu: ContenuResumeCas;
}

function versSources(brut: unknown): readonly SourceResume[] {
  if (!Array.isArray(brut)) return [];
  const out: SourceResume[] = [];
  for (const s of brut) {
    if (typeof s !== "object" || s === null) continue;
    const t = (s as { t?: unknown }).t;
    const id = (s as { id?: unknown }).id;
    if (
      typeof t === "string" &&
      typeof id === "string" &&
      (TYPES_SOURCE as readonly string[]).includes(t)
    ) {
      out.push({ t: t as TypeSourceResume, id });
    }
  }
  return out;
}

function versItems(brut: unknown): readonly ItemResume[] {
  if (!Array.isArray(brut)) return [];
  const out: ItemResume[] = [];
  for (const i of brut) {
    if (typeof i !== "object" || i === null) continue;
    const texte = (i as { texte?: unknown }).texte;
    if (typeof texte !== "string" || texte.trim() === "") continue;
    out.push({ texte, sources: versSources((i as { sources?: unknown }).sources) });
  }
  return out;
}

export function versContenu(brut: unknown): ContenuResumeCas {
  const o =
    typeof brut === "object" && brut !== null
      ? (brut as Record<string, unknown>)
      : {};

  if (o.schema === 2 || o.schema === "2") {
    const apercuBrut =
      typeof o.apercu === "object" && o.apercu !== null
        ? (o.apercu as Record<string, unknown>)
        : {};
    return {
      schema: 2,
      apercu: {
        nom: typeof apercuBrut.nom === "string" ? apercuBrut.nom : "",
        age: typeof apercuBrut.age === "number" ? apercuBrut.age : null,
        residence: typeof apercuBrut.residence === "string" ? apercuBrut.residence : null,
        diagnostics: versItems(apercuBrut.diagnostics),
        traitements: versItems(apercuBrut.traitements),
        contexte: versItems(apercuBrut.contexte),
      },
      chronologie: Array.isArray(o.chronologie)
        ? o.chronologie.flatMap((p) => {
            if (typeof p !== "object" || p === null) return [];
            const periode = (p as { periode?: unknown }).periode;
            if (typeof periode !== "string" || periode.trim() === "") return [];
            const entrees = versItems((p as { entrees?: unknown }).entrees);
            return entrees.length === 0 ? [] : [{ periode, entrees }];
          })
        : [],
      anterieur: versItems(o.anterieur),
      etatActuel: versItems(o.etat_actuel),
    };
  }

  return {
    schema: 1,
    enBref: versItems(o.en_bref),
    evolutionRecente: versItems(o.evolution_recente),
    aDiscuter: versItems(o.a_discuter),
    dernierEtat:
      typeof o.dernier_etat === "object" && o.dernier_etat !== null
        ? (o.dernier_etat as Readonly<Record<string, unknown>>)
        : null,
    traitementsDocumentes: versItems(o.traitements_documentes),
    pointsAttention: versItems(o.points_attention),
  };
}

function versResume(brut: z.infer<typeof ESPACE_TRAVAIL>["resume"]): ResumeDernier | null {
  if (!brut) return null;
  return {
    id: brut.id,
    version: brut.version,
    genereLe: brut.genere_le,
    generePar: brut.genere_par,
    aJour: brut.a_jour,
    contenu: versContenu(brut.contenu),
  };
}

function versRendezVous(
  brut: z.infer<typeof RENDEZ_VOUS_RESUME> | null,
): RendezVousResume | null {
  if (brut === null) return null;
  return {
    id: brut.id,
    startsAt: brut.starts_at,
    endsAt: brut.ends_at,
    status: brut.status,
    kind: brut.kind,
    practitionerName: brut.practitioner_name,
  };
}

function versTraitementV2(brut: z.infer<typeof TRAITEMENT_V2>): TraitementV2 {
  let timing: readonly string[] = [];
  if (Array.isArray(brut.timing)) timing = (brut.timing as unknown[]).filter((x): x is string => typeof x === "string");
  return {
    id: brut.id,
    status: brut.status,
    dose: brut.dose,
    doseUnit: brut.dose_unit,
    frequency: brut.frequency,
    timing,
    instructions: brut.instructions,
    startDate: brut.start_date,
    endDate: brut.end_date,
    stoppedAt: brut.stopped_at,
    stoppedReason: brut.stopped_reason,
    currentVersion: brut.current_version,
    createdAt: brut.created_at,
    updatedAt: brut.updated_at ?? null,
    medicationId: brut.medication_id,
    medicationRaw: brut.medication_raw,
    brandName: brut.brand_name,
    form: brut.form,
    strength: brut.strength,
    inn: brut.inn ?? null,
  };
}

function versEspaceTravail(brut: z.infer<typeof ESPACE_TRAVAIL>): PatientWorkspace {
  return {
    contrat: brut.contrat,
    genereA: brut.genere_a,

    identite: {
      id: brut.identite.id,
      recordNumber: brut.identite.record_number,
      firstName: brut.identite.first_name,
      lastName: brut.identite.last_name,
      birthDate: brut.identite.birth_date,
      age: brut.identite.age,
      sex: brut.identite.sex,
      maritalStatus: brut.identite.marital_status ?? null,
      isActive: brut.identite.is_active,
    },

    contact: {
      phone: brut.contact.phone,
      phoneAlt: brut.contact.phone_alt,
      address: brut.contact.address,
      emergencyContact: versContactUrgence(brut.contact.emergency_contact),
    },

    identification: {
      idDocumentNumber: brut.identification.id_document_number,
      idDocumentIssuer: brut.identification.id_document_issuer,
    },

    admin: { notesAdmin: brut.admin.notes_admin },

    clinique:
      brut.clinique === null
        ? null
        : {
            diagnostics: brut.clinique.diagnostics.map((d) => ({
              id: d.id,
              codeSystem: d.code_system,
              code: d.code,
              label: d.label,
              isPrimary: d.is_primary,
              onsetDate: d.onset_date,
              resolvedAt: d.resolved_at,
            })),
            echelles: brut.clinique.echelles.map((e) => ({
              scaleCode: e.scale_code,
              scaleName: e.scale_name,
              dernier: {
                score: e.dernier.score,
                date: e.dernier.date,
                interpretation: e.dernier.interpretation,
              },
              precedent: e.precedent,
              delta: e.delta,
            })),
            derniereConsultation:
              brut.clinique.derniere_consultation === null
                ? null
                : {
                    id: brut.clinique.derniere_consultation.id,
                    startedAt: brut.clinique.derniere_consultation.started_at,
                    endedAt: brut.clinique.derniere_consultation.ended_at,
                    status: brut.clinique.derniere_consultation.status,
                    kind: brut.clinique.derniere_consultation.kind,
                    practitionerName:
                      brut.clinique.derniere_consultation.practitioner_name,
                  },
            nombreConsultations: brut.clinique.nombre_consultations,
          },

    traitements:
      brut.traitements === null
        ? null
        : {
            dernierePrescription:
              brut.traitements.derniere_prescription === null
                ? null
                : {
                    id: brut.traitements.derniere_prescription.id,
                    prescribedAt:
                      brut.traitements.derniere_prescription.prescribed_at,
                    isHandwritten:
                      brut.traitements.derniere_prescription.is_handwritten,
                    practitionerName:
                      brut.traitements.derniere_prescription.practitioner_name,
                    lignes: brut.traitements.derniere_prescription.lignes.map(
                      (l) => ({
                        id: l.id,
                        designation: l.designation,
                        brandName: l.brand_name,
                        dose: l.dose,
                        frequencyPerDay: l.frequency_per_day,
                        durationDays: l.duration_days,
                        instructions: l.instructions,
                      }),
                    ),
                  },
            nombrePrescriptions: brut.traitements.nombre_prescriptions,
          },

    traitementsV2:
      brut.traitements_v2 === null || brut.traitements_v2 === undefined
        ? null
        : {
            actifs: brut.traitements_v2.actifs.map(versTraitementV2),
            enPause: brut.traitements_v2.en_pause.map(versTraitementV2),
            arretesRecents: brut.traitements_v2.arretes_recents.map(versTraitementV2),
            totalActifs: brut.traitements_v2.total_actifs,
            total: brut.traitements_v2.total,
          },

    agenda: {
      prochainRendezVous: versRendezVous(brut.agenda.prochain_rendez_vous),
      dernierRendezVous: versRendezVous(brut.agenda.dernier_rendez_vous),
      nombreRendezVous: brut.agenda.nombre_rendez_vous,
    },

    documents: {
      nombre: brut.documents.nombre,
      dernierEmisLe: brut.documents.dernier_emis_le,
    },

    rendezVousDuJour: (brut.rendez_vous_du_jour ?? []).flatMap((r) => {
      const v = versRendezVous(r);
      return v === null ? [] : [v];
    }),
    resume: versResume(brut.resume ?? null),
  };
}

/**
 * Le seul appel de l'ouverture d'un dossier. UNE porte, tout l'écran (PERF §3).
 *
 * Rend `null` quand la porte a rendu NULL : dossier inexistant OU hors
 * périmètre, indistinctement. L'écran affiche un message unique — distinguer
 * confirmerait l'existence d'un dossier chez la consœur (ADR-003).
 */
export async function getPatientWorkspace(
  id: string,
): Promise<Result<PatientWorkspace | null>> {
  const result = await db().rpc<unknown>("get_patient_workspace", { p_id: id });

  if (!result.ok) {
    log.error("patients.espaceTravail", logFieldsFor(result.error));
    return err(result.error);
  }

  const brut = result.data[0];
  if (brut === undefined || brut === null) return ok(null);

  const analyse = ESPACE_TRAVAIL.safeParse(brut);
  if (!analyse.success) {
    log.error("patients.espaceTravail", {
      code: "regle-metier",
      context: `zod:${cheminsZod(analyse.error)}`,
    });
    return err(erreurDeSchema("get_patient_workspace"));
  }

  log.info("patients.espaceTravail", { count: 1 });
  return ok(versEspaceTravail(analyse.data));
}

// ---------------------------------------------------------------------------
// La chronologie — pagination KEYSET
// ---------------------------------------------------------------------------

export type TimelineEventType =
  | "consultation"
  | "note"
  | "diagnostic"
  | "prescription"
  | "echelle"
  | "rdv"
  | "document"
  | "traitement";

export type TimelineLabelKey =
  | "consultation_ouverte"
  | "consultation_close"
  | "note_signee"
  | "diagnostic_pose"
  | "diagnostic_resolu"
  | "prescription"
  | "echelle"
  | "rdv"
  | "document"
  | "traitement_commence"
  | "traitement_dose_modifiee"
  | "traitement_horaire_modifie"
  | "traitement_pause"
  | "traitement_repris"
  | "traitement_arrete"
  | "traitement_renouvele";

const EVENEMENT = z.object({
  occurred_at: z.string(),
  event_id: z.string(),
  event_type: z.enum([
    "consultation",
    "note",
    "diagnostic",
    "prescription",
    "echelle",
    "rdv",
    "document",
    "traitement",
  ]),
  label_key: z.enum([
    "consultation_ouverte",
    "consultation_close",
    "note_signee",
    "diagnostic_pose",
    "diagnostic_resolu",
    "prescription",
    "echelle",
    "rdv",
    "document",
    "traitement_commence",
    "traitement_dose_modifiee",
    "traitement_horaire_modifie",
    "traitement_pause",
    "traitement_repris",
    "traitement_arrete",
    "traitement_renouvele",
  ]),
  practitioner_name: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
});

export interface TimelineCursor {
  readonly occurredAt: string;
  readonly eventId: string;
}

export interface TimelineEvent {
  readonly occurredAt: string;
  readonly eventId: string;
  readonly eventType: TimelineEventType;
  readonly labelKey: TimelineLabelKey;
  readonly practitionerName: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface TimelinePage {
  readonly evenements: readonly TimelineEvent[];
  /** `null` = fin du flux. L'écran affiche une fin explicite, pas un bouton mort. */
  readonly curseurSuivant: TimelineCursor | null;
}

const TAILLE_PAGE_CHRONOLOGIE = 20;

/**
 * La chronologie longitudinale, page par page.
 *
 * ⚠️ LE CURSEUR PART EN DEUX SCALAIRES, PAS EN OBJET. `RpcArgs` n'accepte que
 * `string | number | boolean | null` (`db/port.ts`) — c'est la même contrainte
 * qui oblige `listAgenda` à sérialiser `p_statuts`. Un objet passerait
 * silencieusement en `[object Object]`.
 *
 * ⚠️ KEYSET, PAS `OFFSET` : un décalage saute ou répète une ligne dès qu'un
 * événement s'insère entre deux pages, et pendant une consultation il s'en
 * insère. Les deux composantes de l'ordre voyagent ensemble.
 */
export async function listPatientTimeline(
  id: string,
  curseur: TimelineCursor | null = null,
  limite: number = TAILLE_PAGE_CHRONOLOGIE,
): Promise<Result<TimelinePage>> {
  const taille = Math.min(Math.max(limite, 1), 50);

  const result = await db().rpc<unknown>("list_patient_timeline", {
    p_id: id,
    p_before_at: curseur?.occurredAt ?? null,
    p_before_id: curseur?.eventId ?? null,
    p_limit: taille,
  });

  if (!result.ok) {
    log.error("patients.chronologie", logFieldsFor(result.error));
    return err(result.error);
  }

  const analyse = z.array(EVENEMENT).safeParse(result.data);
  if (!analyse.success) {
    log.error("patients.chronologie", {
      code: "regle-metier",
      context: `zod:${cheminsZod(analyse.error)}`,
    });
    return err(erreurDeSchema("list_patient_timeline"));
  }

  const evenements: readonly TimelineEvent[] = analyse.data.map((e) => ({
    occurredAt: e.occurred_at,
    eventId: e.event_id,
    eventType: e.event_type,
    labelKey: e.label_key,
    practitionerName: e.practitioner_name,
    detail: e.detail,
  }));

  // Une page incomplète est la dernière : la porte a rendu tout ce qu'elle
  // avait. Demander une page de plus pour s'en assurer coûterait un appel et
  // une ligne d'audit pour rien.
  const dernier = evenements[evenements.length - 1];
  const curseurSuivant =
    evenements.length < taille || dernier === undefined
      ? null
      : { occurredAt: dernier.occurredAt, eventId: dernier.eventId };

  log.info("patients.chronologie", { count: evenements.length });
  return ok({ evenements, curseurSuivant });
}

// ---------------------------------------------------------------------------
// La modification — l'unique porte d'écriture
// ---------------------------------------------------------------------------

/**
 * Les champs modifiables. C'est L'ALLOWLIST DE LA PORTE `app.update_patient`
 * (020), recopiée ici volontairement : la porte LÈVE sur une clé inconnue, elle
 * ne l'ignore pas. Mieux vaut donc échouer ici, avant l'appel, que d'apprendre
 * en production qu'un champ n'existait pas.
 *
 * `is_active` fait partie de l'allowlist de la porte mais PAS de ce formulaire :
 * désactiver un dossier est un geste qui mérite sa propre confirmation, pas une
 * case au milieu d'un formulaire d'identité.
 *
 * Sémantique de la porte, à connaître avant d'écrire un écran : clé absente =
 * inchangé ; clé à `null` = effacé — SAUF `first_name`, `last_name` et `phone`,
 * que la porte protège par `coalesce` parce que leurs colonnes sont NOT NULL.
 */
export interface PatientChanges {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly birthDate?: string | null;
  readonly sex?: Sexe | null;
  readonly phone?: string;
  readonly phoneAlt?: string | null;
  readonly address?: string | null;
  readonly idDocumentNumber?: string | null;
  readonly idDocumentIssuer?: string | null;
  readonly emergencyContact?: EmergencyContact | null;
  readonly notesAdmin?: string | null;
  readonly maritalStatus?: SituationFamiliale | null;
}

/** La correspondance camel → snake, écrite en toutes lettres. */
const CHAMPS_MODIFIABLES = {
  firstName: "first_name",
  lastName: "last_name",
  birthDate: "birth_date",
  sex: "sex",
  phone: "phone",
  phoneAlt: "phone_alt",
  address: "address",
  idDocumentNumber: "id_document_number",
  idDocumentIssuer: "id_document_issuer",
  emergencyContact: "emergency_contact",
  notesAdmin: "notes_admin",
  maritalStatus: "marital_status",
} as const satisfies Readonly<Record<keyof PatientChanges, string>>;

// Miroir exact de la contrainte `patients_phone_format` (004). La vérifier ici
// donne un message en français à la saisie ; la base reste l'autorité.
const FORMAT_TELEPHONE = /^[0-9+ ]{8,20}$/;

/**
 * Ramène un numéro saisi à la main au SEUL alphabet que 004 accepte.
 *
 * On écrit un téléphone algérien de dix façons — « 0554-12-34-56 »,
 * « 0554.12.34.56 », « (0554) 12 34 56 ». La contrainte, elle, n'accepte que
 * chiffres, espaces et « + ». Le formulaire refusait donc une saisie JUSTE, et
 * `errors.ts` — à bon droit, le texte brut de Postgres n'atteint jamais
 * l'écran — n'en disait qu'« une valeur saisie n'est pas acceptée ».
 *
 * ⚠️ CETTE FONCTION NE CORRIGE PAS UN NUMÉRO, elle en change la PONCTUATION.
 * Aucun chiffre n'est ajouté, retiré ni deviné : « 0554 » reste trop court et
 * reste refusé. Fabriquer un numéro plausible serait la règle 8.
 * Le résultat est réaffiché dans le champ — rien n'est normalisé en douce.
 */
export function normaliserTelephone(valeur: string): string {
  return valeur
    .replace(/[.\-\u2013\u2014/\()\u00A0]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Le numéro est-il acceptable pour 004 ? Exporté pour que le formulaire dise
 * NON avant l'aller-retour, avec le format en clair, plutôt que de recevoir un
 * refus générique. La base reste l'autorité : ceci n'est qu'un miroir.
 */
export function telephoneValide(valeur: string): boolean {
  return FORMAT_TELEPHONE.test(valeur);
}

const MODIFICATIONS = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  birthDate: z.string().nullable().optional(),
  sex: z.enum(["M", "F"]).nullable().optional(),
  phone: z.string().trim().regex(FORMAT_TELEPHONE).optional(),
  phoneAlt: z.string().trim().regex(FORMAT_TELEPHONE).nullable().optional(),
  address: z.string().nullable().optional(),
  idDocumentNumber: z.string().nullable().optional(),
  idDocumentIssuer: z.string().nullable().optional(),
  emergencyContact: z
    .object({
      name: z.string().nullable(),
      relation: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable()
    .optional(),
  notesAdmin: z.string().nullable().optional(),
  // Le `z.enum` REFUSE ici ce que l'enum Postgres refuserait de toute façon.
  // L'intérêt n'est pas la protection — 088 est l'autorité — mais le message :
  // un refus de saisie parle français, un `invalid input value for enum` non.
  maritalStatus: z
    .enum(["celibataire", "en_couple", "marie", "divorce", "veuf"])
    .nullable()
    .optional(),
});

function erreurDeSaisie(chemins: string): AppError {
  return {
    code: "regle-metier",
    message: fr.patients.saisieInvalide,
    technical: "validation",
    context: `zod:${chemins}`,
  };
}

/**
 * Modifier un dossier. Passe par `app.update_patient` — l'UNIQUE porte
 * d'écriture, qui verrouille, valide son allowlist et laisse `trg_audit` (013)
 * écrire la trace. Aucun second chemin n'est créé ici.
 *
 * ⚠️ `p_changes` PART EN CHAÎNE. `RpcArgs` n'accepte que des scalaires
 * (`db/port.ts`) : un objet JavaScript s'y sérialiserait en `[object Object]`,
 * la porte lèverait « charge de modification invalide », et l'erreur
 * ressemblerait à un problème de données alors que c'est un problème de type.
 */
export async function updatePatient(
  id: string,
  changes: PatientChanges,
): Promise<Result<Patient>> {
  const analyse = MODIFICATIONS.safeParse(changes);
  if (!analyse.success) {
    log.error("patients.modification", {
      code: "regle-metier",
      context: `zod:${cheminsZod(analyse.error)}`,
    });
    return err(erreurDeSaisie(cheminsZod(analyse.error)));
  }

  // Seules les clés RÉELLEMENT fournies partent : une clé absente veut dire
  // « inchangé » pour la porte, et envoyer `undefined` la ferait basculer du
  // côté « effacer ».
  const charge: Record<string, unknown> = {};
  for (const [cle, colonne] of Object.entries(CHAMPS_MODIFIABLES)) {
    const valeur = analyse.data[cle as keyof PatientChanges];
    if (valeur !== undefined) charge[colonne] = valeur;
  }

  if (Object.keys(charge).length === 0) {
    // Rien à écrire : ne pas appeler la porte du tout. Un aller-retour vide
    // produirait quand même une ligne d'audit de modification, ce qui ferait
    // mentir le journal.
    return getPatientOuErreur(id);
  }

  const result = await db().rpc<PatientRow>("update_patient", {
    p_id: id,
    p_changes: JSON.stringify(charge),
  });

  if (!result.ok) {
    log.error("patients.modification", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // La porte n'a rien rendu : hors périmètre, ou dossier disparu entre la
    // lecture et l'écriture. Un seul message, comme partout ailleurs.
    return err({
      code: "introuvable",
      message: fr.patients.ficheIntrouvable,
      context: "rpc:update_patient",
    });
  }

  log.info("patients.modification", { count: Object.keys(charge).length });
  return ok(versPatient(row));
}

function versPatient(row: PatientRow): Patient {
  return {
    ...toListItem(row),
    maritalStatus: row.marital_status,
    cabinetId: row.cabinet_id,
    practitionerId: row.practitioner_id,
    sex: row.sex,
    address: row.address,
    phoneAlt: row.phone_alt,
    notesAdmin: row.notes_admin,
    idDocumentNumber: row.id_document_number,
    idDocumentIssuer: row.id_document_issuer,
    emergencyContact: versContactUrgence(row.emergency_contact),
  };
}

/** Relecture après une modification vide — jamais une écriture pour rien. */
async function getPatientOuErreur(id: string): Promise<Result<Patient>> {
  const relu = await getPatient(id);
  if (!relu.ok) return err(relu.error);
  if (relu.data === null) {
    return err({
      code: "introuvable",
      message: fr.patients.ficheIntrouvable,
      context: "rpc:get_patient",
    });
  }
  return ok(relu.data);
}

// ---------------------------------------------------------------------------
// Patients V3 — la création, et les candidats doublons
// ---------------------------------------------------------------------------
// ⚠️ UNE SEULE PORTE D'ÉCRITURE DE CRÉATION : `app.create_patient` (050/052).
// Elle numérote sans trou (`next_number('patient_record','ALL')`), porte la
// garde de doublon dure au périmètre RLS de l'appelant (ERRCODE 23505),
// valide le praticien responsable et laisse `trg_audit` tracer. Aucun
// `insert` direct ici ni ailleurs : ce fichier ne connaît que des portes.

/** Candidat doublon rendu par `app.find_similar_patients` (051). */
export interface CandidatSimilaire {
  readonly id: string;
  readonly recordNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string | null;
  readonly phone: string;
  readonly isActive: boolean;
  /** Sert à CLASSER. Jamais affiché tel quel : l'écran montre des raisons. */
  readonly score: number;
  readonly raisonNom: boolean;
  readonly raisonTelephone: boolean;
  readonly raisonNaissance: boolean;
}

const SIMILAIRE = z.object({
  id: z.string(),
  record_number: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string().nullable(),
  phone: z.string(),
  is_active: z.boolean(),
  score: NOMBRE,
  raison_nom: z.boolean(),
  raison_telephone: z.boolean(),
  raison_naissance: z.boolean(),
});

export interface FiltresSimilaires {
  readonly prenom?: string;
  readonly nom?: string;
  readonly telephone?: string;
  readonly naissance?: string | null;
}

/**
 * Les candidats doublons, pendant la saisie de création.
 *
 * ⚠️ CHAQUE APPEL ÉCRIT UNE TRACE `recherche` — l'écran débounce à 300 ms,
 * comme la recherche de liste débounce à 250 ms (même raison : ne pas noyer
 * `audit.log` d'une ligne par caractère).
 *
 * La porte borne sa limite à 8 EN BASE.
 */
export async function chercherPatientsSimilaires(
  filtres: FiltresSimilaires,
): Promise<Result<readonly CandidatSimilaire[]>> {
  const result = await db().rpc<unknown>("find_similar_patients", {
    p_prenom: filtres.prenom ?? null,
    p_nom: filtres.nom ?? null,
    p_telephone: filtres.telephone ?? null,
    p_naissance: filtres.naissance ?? null,
    p_limit: 8,
  });

  if (!result.ok) {
    log.error("patients.similaires", logFieldsFor(result.error));
    return err(result.error);
  }

  const analyse = z.array(SIMILAIRE).safeParse(result.data);
  if (!analyse.success) {
    log.error("patients.similaires", {
      code: "regle-metier",
      context: `zod:${cheminsZod(analyse.error)}`,
    });
    return err(erreurDeSchema("find_similar_patients"));
  }

  const candidats = analyse.data.map((c) => ({
    id: c.id,
    recordNumber: c.record_number,
    firstName: c.first_name,
    lastName: c.last_name,
    birthDate: c.birth_date,
    phone: c.phone,
    isActive: c.is_active,
    score: c.score,
    raisonNom: c.raison_nom,
    raisonTelephone: c.raison_telephone,
    raisonNaissance: c.raison_naissance,
  }));

  log.info("patients.similaires", { count: candidats.length });
  return ok(candidats);
}

/**
 * Correspondance FORTE — le seul seuil qui exige une confirmation explicite
 * (« Créer malgré tout »). Conjonction téléphone+naissance (la règle dure de
 * 01-SCHEMA §3.1, vue côté conseil) ou nom quasi identique.
 *
 * ⚠️ CE SEUIL N'EST PAS AFFICHÉ : il pilote un geste, jamais un chiffre.
 */
export function doublonFort(c: CandidatSimilaire): boolean {
  return (c.raisonTelephone && c.raisonNaissance) || c.score >= 0.62;
}

/** Le formulaire de création ne collecte QUE ce que le schéma porte (004). */
export interface PatientACreer {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly birthDate?: string | null;
  readonly sex?: Sexe | null;
  readonly phoneAlt?: string | null;
  readonly address?: string | null;
  readonly idDocumentNumber?: string | null;
  readonly idDocumentIssuer?: string | null;
  readonly emergencyContact?: EmergencyContact | null;
  readonly notesAdmin?: string | null;
  /** Facultatif : absent ⇒ la porte prend `auth.uid()` (le créateur praticien). */
  readonly practitionerId?: string;
}

const CREATION = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().regex(FORMAT_TELEPHONE),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  sex: z.enum(["M", "F"]).nullish(),
  maritalStatus: z
    .enum(["celibataire", "en_couple", "marie", "divorce", "veuf"])
    .nullish(),
  phoneAlt: z.string().trim().regex(FORMAT_TELEPHONE).nullish(),
  address: z.string().nullish(),
  idDocumentNumber: z.string().nullish(),
  idDocumentIssuer: z.string().nullish(),
  emergencyContact: z
    .object({
      name: z.string().nullable(),
      relation: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable()
    .optional(),
  notesAdmin: z.string().nullish(),
  practitionerId: z.guid().optional(),
});

/**
 * Créer un dossier. Passe par `app.create_patient` — charge sérialisée en
 * CHAÎNE (`RpcArgs` scalaires ; la porte accepte les deux formes, leçon 049).
 *
 * Refus spécifique : le garde de doublon dur lève SQLSTATE `23505`. La base
 * reste l'autorité du refus, mais le MESSAGE affiché est écrit ICI — le texte
 * brut de Postgres n'atteint jamais l'écran (I5), et « conflit » générique ne
 * dirait pas quel geste faire.
 */
export async function creerPatient(
  donnees: PatientACreer,
): Promise<Result<Patient>> {
  const analyse = CREATION.safeParse(donnees);
  if (!analyse.success) {
    log.error("patients.creation", {
      code: "regle-metier",
      context: `zod:${cheminsZod(analyse.error)}`,
    });
    return err(erreurDeSaisie(cheminsZod(analyse.error)));
  }

  // Seules les clés réellement fournies partent ; les vides partent en `null`
  // (effacer avant naissance = champ non renseigné, jamais une chaîne vide).
  const d = analyse.data;
  const charge: Record<string, unknown> = {
    first_name: d.firstName,
    last_name: d.lastName,
    phone: d.phone,
  };
  if (d.birthDate) charge.birth_date = d.birthDate;
  if (d.sex !== undefined && d.sex !== null) charge.sex = d.sex;
  // 089. La clé n'est envoyée QUE si elle porte une valeur : `create_patient`
  // refuse une clé inconnue, mais une clé connue à `null` écrirait « non
  // renseignée » — ce qui est déjà le défaut. On n'envoie donc rien.
  if (d.maritalStatus !== undefined && d.maritalStatus !== null) {
    charge.marital_status = d.maritalStatus;
  }
  if (d.phoneAlt !== undefined && d.phoneAlt !== null && d.phoneAlt !== "") {
    charge.phone_alt = d.phoneAlt;
  }
  if (d.address !== undefined && d.address !== null && d.address.trim() !== "") {
    charge.address = d.address;
  }
  if (d.idDocumentNumber !== undefined && d.idDocumentNumber !== null && d.idDocumentNumber.trim() !== "") {
    charge.id_document_number = d.idDocumentNumber;
  }
  if (d.idDocumentIssuer !== undefined && d.idDocumentIssuer !== null && d.idDocumentIssuer.trim() !== "") {
    charge.id_document_issuer = d.idDocumentIssuer;
  }
  if (d.emergencyContact !== undefined && d.emergencyContact !== null) {
    charge.emergency_contact = d.emergencyContact;
  }
  if (d.notesAdmin !== undefined && d.notesAdmin !== null && d.notesAdmin.trim() !== "") {
    charge.notes_admin = d.notesAdmin;
  }
  if (d.practitionerId !== undefined) charge.practitioner_id = d.practitionerId;

  const result = await db().rpc<PatientRow>("create_patient", {
    p_charge: JSON.stringify(charge),
  });

  if (!result.ok) {
    if (
      result.error.technical === "23505" &&
      result.error.context === "rpc:create_patient"
    ) {
      log.error("patients.creation", { code: "conflit", context: "rpc:create_patient" });
      return err({
        code: "conflit",
        message: fr.patients.creation.doublonRefuse,
        technical: "23505",
        context: "rpc:create_patient",
      });
    }
    log.error("patients.creation", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // La porte n'a rien rendu : hors périmètre. Un seul message, partout.
    return err({
      code: "introuvable",
      message: fr.patients.ficheIntrouvable,
      context: "rpc:create_patient",
    });
  }

  log.info("patients.creation", { count: 1 });
  return ok(versPatient(row));
}

// ---------------------------------------------------------------------------
// Patients V3 — le signalement d'une information de résumé jugée fausse
// ---------------------------------------------------------------------------

export type VerdictSignalement = "incorrect" | "imprecis" | "hors_sujet";

const VERDICTS: readonly VerdictSignalement[] = [
  "incorrect",
  "imprecis",
  "hors_sujet",
];

/**
 * Signaler une information du résumé jugée fausse — append-only
 * (`app.flag_case_summary`, 053). Ne mute JAMAIS le résumé : le correctif est
 * une RÉGÉNÉRATION, qui créera une nouvelle version.
 */
export async function signalerResume(
  summaryId: string,
  verdict: VerdictSignalement,
  motif: string,
): Promise<Result<null>> {
  const net = motif.trim();
  if (!(VERDICTS as readonly string[]).includes(verdict) || net === "") {
    return err({
      code: "regle-metier",
      message: fr.patients.resume.signalementInvalide,
      context: "rpc:flag_case_summary",
    });
  }

  const result = await db().rpc("flag_case_summary", {
    p_summary_id: summaryId,
    p_verdict: verdict,
    p_motif: net.slice(0, 1000),
  });

  if (!result.ok) {
    log.error("patients.signalement", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("patients.signalement", { count: 1 });
  return ok(null);
}