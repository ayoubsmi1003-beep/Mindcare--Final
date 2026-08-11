/**
 * Agenda.
 *
 * ⚠️ CE FICHIER NE REQUÊTE NI `appointments`, NI `appointments_admin`. Il
 * n'appelle que les cinq portes de la migration 022, et le contrôle 1 du
 * checkpoint S4 le vérifie — sur la vue AUSSI, pas seulement sur la table.
 *
 * Précision qui compte, parce que l'inverse a déjà été écrit dans ce projet et
 * corrigé par ADR-017 : **la vue n'est pas le garde-fou.** Depuis ADR-017,
 * `reason` ne vit plus dans `app.appointments` mais dans
 * `app.appointment_reasons`, qui n'a AUCUNE policy assistant — c'est ça qui
 * protège le motif de consultation, et ça tient même en SQL brut. Ne pas
 * réintroduire l'idée que « requêter la vue EST la sécurité » : c'était
 * l'erreur du §5.1 de 01-SCHEMA.
 *
 * Le motif de consultation n'est PAS exposé par ce service. Il appartient à un
 * futur service clinique, dont la RLS décidera — pas ce fichier.
 *
 * POURQUOI LA VUE NE SUFFIT PLUS NON PLUS, ET C'EST NOUVEAU EN S4. Un agenda
 * affiche des NOMS. La vue ne les porte pas, et `app.get_patient` en écrirait
 * une ligne d'audit `fiche` par rendez-vous — douze « ouvertures de dossier »
 * pour un coup d'œil à la journée. `app.list_agenda` en écrit UNE, en contexte
 * `liste`. La preuve I4 de S3 (« une fiche ouverte = +1 ligne, exactement »)
 * reste donc vraie, et c'est le contrôle 9 du checkpoint S4 qui l'atteste.
 *
 * `listAppointments`, qui lisait la vue, A ÉTÉ RETIRÉE. Elle n'a jamais eu
 * d'appelant, et sa signature ne pouvait pas porter le nom du patient sans
 * rouvrir le chemin qu'on vient de fermer.
 */

import { fr } from "@/i18n/fr";

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/**
 * Statut d'un rendez-vous. Les sept valeurs de `app.appt_status` (migration
 * 002), reprises telles quelles : une union fermée fait échouer à la
 * compilation l'ajout d'un statut inventé côté interface.
 */
export type AppointmentStatus =
  | "requested"
  | "confirmed"
  | "arrived"
  | "in_session"
  | "completed"
  | "no_show"
  | "cancelled";

/** Canal d'entrée du rendez-vous (`app.appt_source`). PAS le type de consultation. */
export type AppointmentSource = "phone" | "walk_in" | "web" | "assistant" | "doctor";

/**
 * Type de consultation (`app.consult_kind`, migration 024).
 *
 * Les treize valeurs viennent du cabinet, pas de nous. L'union est FERMÉE : un
 * type inventé côté interface ne compile pas, et c'est exactement la garantie
 * qu'on veut sur une donnée clinique.
 *
 * ⚠️ À ne pas confondre avec `AppointmentSource`, qui dit par quel CANAL le
 * rendez-vous est entré, ni avec le motif de consultation, qui vit dans
 * `app.appointment_reasons` et n'apparaît nulle part dans ce fichier (ADR-017).
 */
export type ConsultationKind =
  | "premiere_consultation"
  | "suivi"
  | "psychotherapie_individuelle"
  | "therapie_couple"
  | "therapie_familiale"
  | "therapie_groupe"
  | "teleconsultation"
  | "certificat_medical"
  | "renouvellement_ordonnance"
  | "evaluation_psychiatrique"
  | "bilan_psychologique"
  | "entretien_famille"
  | "entretien_tiers";

/**
 * Les états qui occupent réellement la grille d'agenda.
 *
 * ⚠️ CE N'EST PAS UNE PROTECTION, et il ne faut jamais le présenter comme telle.
 * La RLS de 006 a déjà décidé quelles LIGNES existent pour l'appelante ; ceci
 * ne fait que choisir lesquelles elle regarde. Une demande `requested` reste
 * parfaitement lisible — elle attend simplement l'approbation de l'assistante
 * et n'a pas à occuper un créneau tant qu'elle ne l'a pas.
 */
export const STATUTS_AGENDA: readonly AppointmentStatus[] = [
  "confirmed",
  "arrived",
  "in_session",
  "completed",
  "no_show",
];

/** L'unique état d'attente d'approbation. */
export const STATUTS_EN_ATTENTE: readonly AppointmentStatus[] = ["requested"];

/**
 * Une ligne d'agenda.
 *
 * L'identité patient est OPTIONNELLE, et ce n'est pas une facilité de typage :
 * `app.list_agenda` joint `app.patients` en LEFT JOIN. Un rendez-vous dont le
 * dossier n'est pas visible — demande web non validée, ou cloison ADR-003 —
 * reste dans l'agenda, sans nom. Faire disparaître la ligne masquerait une
 * heure occupée, donc produirait un double booking.
 */
export interface AgendaEntry {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes: number;
  readonly status: AppointmentStatus;
  readonly source: AppointmentSource;
  readonly kind: ConsultationKind | null;
  readonly notesAdmin: string | null;
  readonly arrivedAt: string | null;
  readonly patientId: string | null;
  readonly recordNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly practitionerId: string;
  readonly practitionerName: string | null;
}

interface AgendaRow {
  readonly id: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly status: AppointmentStatus;
  readonly source: AppointmentSource;
  readonly kind: ConsultationKind | null;
  readonly notes_admin: string | null;
  readonly arrived_at: string | null;
  readonly patient_id: string | null;
  readonly record_number: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly practitioner_id: string;
  readonly practitioner_name: string | null;
}

export interface AgendaRangeFilters {
  /** Borne basse incluse, ISO 8601 avec fuseau (I8 : jamais de `timestamp` nu). */
  readonly from: string;
  /** Borne haute exclue. La base refuse au-delà de 62 jours. */
  readonly to: string;
  readonly practitionerId?: string;
  /**
   * Filtre de VUE, jamais une protection — voir `STATUTS_AGENDA`. Omis, la
   * porte rend tous les états visibles par l'appelante.
   */
  readonly statuts?: readonly AppointmentStatus[];
}

export interface CreateAppointmentInput {
  readonly patientId: string;
  readonly practitionerId: string;
  /** Début, ISO 8601 avec fuseau. */
  readonly startsAt: string;
  /** 5 à 240 minutes. La borne est appliquée EN BASE, pas seulement ici. */
  readonly durationMinutes: number;
  readonly notesAdmin?: string;
  readonly kind?: ConsultationKind;
}

/**
 * Modification d'un rendez-vous.
 *
 * Une propriété ABSENTE ne change rien ; `notesAdmin: null` efface. La
 * distinction est portée jusqu'en base par le document JSON — avec des
 * paramètres nullables, `null` voudrait dire les deux, et on ne pourrait plus
 * vider une note.
 *
 * `patientId`, `practitionerId` et `status` n'y figurent pas, et la base les
 * refuse activement : réattribuer un rendez-vous à une autre praticienne
 * contournerait la cloison ADR-003 par une modification de routine.
 */
export interface UpdateAppointmentChanges {
  readonly startsAt?: string;
  readonly durationMinutes?: number;
  readonly notesAdmin?: string | null;
  /** `null` remet le type à « non renseigné » plutôt que d'y laisser une valeur fausse. */
  readonly kind?: ConsultationKind | null;
}

function minutesBetween(startsAt: string, endsAt: string): number {
  const debut = Date.parse(startsAt);
  const fin = Date.parse(endsAt);
  if (Number.isNaN(debut) || Number.isNaN(fin)) return 0;
  return Math.round((fin - debut) / 60000);
}

function toEntry(row: AgendaRow): AgendaEntry {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    // Calculée, jamais stockée : la base porte `starts_at` et `ends_at`, et
    // deux sources pour une même information finissent toujours par diverger.
    durationMinutes: minutesBetween(row.starts_at, row.ends_at),
    status: row.status,
    source: row.source,
    kind: row.kind,
    notesAdmin: row.notes_admin,
    arrivedAt: row.arrived_at,
    patientId: row.patient_id,
    recordNumber: row.record_number,
    firstName: row.first_name,
    lastName: row.last_name,
    practitionerId: row.practitioner_id,
    practitionerName: row.practitioner_name,
  };
}

export async function listAgenda(
  filters: AgendaRangeFilters,
): Promise<Result<readonly AgendaEntry[]>> {
  const result = await db().rpc<AgendaRow>("list_agenda", {
    p_from: filters.from,
    p_to: filters.to,
    p_practitioner: filters.practitionerId ?? null,
    // Le tableau voyage SÉRIALISÉ : `RpcArgs` n'accepte que des scalaires, et
    // PostgREST sérialise mal un tableau de type énuméré personnalisé. La porte
    // reçoit du `text[]` et fait le cast elle-même, où l'énumération ferme
    // l'ensemble des valeurs admissibles.
    p_statuts:
      filters.statuts === undefined ? null : `{${filters.statuts.join(",")}}`,
  });

  if (!result.ok) {
    log.error("agenda.liste", logFieldsFor(result.error));
    return err(result.error);
  }

  log.info("agenda.liste", { count: result.data.length });
  return ok(result.data.map(toEntry));
}

export async function getAppointment(id: string): Promise<Result<AgendaEntry | null>> {
  const result = await db().rpc<AgendaRow>("get_appointment", { p_id: id });

  if (!result.ok) {
    // Pas d'identifiant patient ici : règle 1 et I5. La trace nominative légale
    // est dans `audit.log`, écrite par la porte avant même que cette erreur ne
    // survienne.
    log.error("agenda.detail", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // Rendez-vous inexistant OU hors du périmètre de l'appelant : la base ne
    // distingue pas les deux, et l'interface ne doit pas non plus. Répondre
    // « ce rendez-vous existe mais ne vous est pas accessible » divulguerait
    // l'activité d'une autre praticienne (cloison ADR-003).
    return ok(null);
  }

  return ok(toEntry(row));
}

export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<Result<string>> {
  const result = await db().rpc<string>("create_appointment", {
    p_patient_id: input.patientId,
    p_practitioner_id: input.practitionerId,
    p_starts_at: input.startsAt,
    p_duration_minutes: input.durationMinutes,
    p_notes_admin: input.notesAdmin ?? null,
    p_kind: input.kind ?? null,
  });

  if (!result.ok) {
    log.error("agenda.creation", logFieldsFor(result.error));
    return err(result.error);
  }

  const id = result.data[0];
  if (id === undefined) {
    // La porte rend toujours un identifiant en cas de succès. Une réponse vide
    // signifie que la RLS a refusé l'écriture sans lever — on ne rend PAS un
    // succès, sinon l'écran annoncerait un rendez-vous qui n'existe pas.
    log.error("agenda.creation", { code: "vide" });
    // Message repris de `fr.erreurs`, jamais rédigé ici : une phrase d'interface
    // écrite dans un service échappe à la relecture linguistique (I8).
    return err({ code: "interdit", message: fr.erreurs.interdit });
  }

  log.info("agenda.creation", { count: 1 });
  return ok(id);
}

export async function updateAppointment(
  id: string,
  changes: UpdateAppointmentChanges,
): Promise<Result<boolean>> {
  // Le document est construit clé par clé, jamais par sérialisation directe de
  // `changes` : `JSON.stringify` d'un objet à propriétés optionnelles omet bien
  // les absentes, mais rien n'empêcherait un appelant d'y glisser une clé de
  // plus. La base refuserait — autant ne pas l'envoyer.
  const document: Record<string, string | number | null> = {};
  if (changes.startsAt !== undefined) document["starts_at"] = changes.startsAt;
  if (changes.durationMinutes !== undefined) {
    document["duration_minutes"] = changes.durationMinutes;
  }
  if (changes.notesAdmin !== undefined) document["notes_admin"] = changes.notesAdmin;
  if (changes.kind !== undefined) document["kind"] = changes.kind;

  if (Object.keys(document).length === 0) {
    // Rien à écrire. On ne consulte pas la base pour ne rien faire : ce serait
    // une ligne d'audit d'écriture pour une modification qui n'a pas eu lieu.
    return ok(false);
  }

  const result = await db().rpc<string>("update_appointment", {
    p_id: id,
    p_changes: JSON.stringify(document),
  });

  if (!result.ok) {
    log.error("agenda.modification", logFieldsFor(result.error));
    return err(result.error);
  }

  // Aucune ligne touchée = rendez-vous introuvable ou hors périmètre. Pas une
  // erreur, mais surtout pas un succès : l'écran doit pouvoir le dire.
  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("agenda.modification", { count: touche ? 1 : 0 });
  return ok(touche);
}

/**
 * Approuve une demande de rendez-vous.
 *
 * `status` étant exclu de l'allowlist de `update_appointment`, c'est la seule
 * voie vers `confirmed` : aucune transition ne se fait par une modification de
 * routine. Qui a le droit d'approuver est tranché par la RLS de 006, pas ici.
 */
export async function confirmAppointment(id: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("confirm_appointment", { p_id: id });

  if (!result.ok) {
    log.error("agenda.approbation", logFieldsFor(result.error));
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("agenda.approbation", { count: touche ? 1 : 0 });
  return ok(touche);
}

export async function cancelAppointment(
  id: string,
  motif: string,
): Promise<Result<boolean>> {
  const result = await db().rpc<string>("cancel_appointment", {
    p_id: id,
    p_motif: motif,
  });

  if (!result.ok) {
    log.error("agenda.annulation", logFieldsFor(result.error));
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("agenda.annulation", { count: touche ? 1 : 0 });
  return ok(touche);
}
