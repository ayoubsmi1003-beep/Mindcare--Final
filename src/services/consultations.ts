/**
 * Séance et note clinique.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Ni `consultations`, ni
 * `clinical_notes`, ni `clinical_note_amendments`. Il n'appelle que les neuf
 * portes de la migration 026, et le contrôle 1 du checkpoint S5 le vérifie.
 *
 * La raison est la même qu'en S4, en plus grave : ces tables n'ont AUCUNE
 * policy assistante — elles lui sont invisibles jusqu'en SQL brut (007, 008).
 * Les lire par PostgREST fonctionnerait pour la praticienne, mais produirait
 * des lectures de dossier SANS trace d'audit, exactement le chemin non audité
 * qu'ADR-019 a fermé pour les patients et que 022 a fermé pour l'agenda.
 *
 * ═══ CE QUE CE FICHIER NE DÉCIDE PAS ═══════════════════════════════════════
 *
 * Il ne décide RIEN de l'immuabilité. `noteEstVerrouillee` plus bas dit ce que
 * l'ÉCRAN AFFICHE ; ce que la base PERMET est décidé par `trg_note_immutable`
 * (008), et par lui seul. La distinction n'est pas rhétorique : si l'horloge du
 * poste dérive de deux minutes, cette fonction se trompe et le déclencheur, non.
 * C'est le déclencheur qui a raison, et l'écran doit savoir encaisser un refus
 * sur un bouton qu'il croyait actif.
 *
 * Ne jamais présenter le grisage d'un bouton comme la protection d'I15.
 */

import { fr } from "@/i18n/fr";

import type { ConsultationKind } from "./appointments";
import { db } from "./db";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/** Les deux valeurs de `app.consult_status` (002). Union fermée, comme partout. */
export type ConsultationStatus = "open" | "closed";

/** Les deux valeurs de `app.note_status` (002). */
export type NoteStatus = "draft" | "signed";

/**
 * Les quatre champs SOAP, et rien d'autre.
 *
 * C'est l'allowlist de `app.save_note`, reprise à l'identique côté typage : une
 * clé de plus ne compile pas ici, et serait refusée en base de toute façon. Les
 * deux barrières disent la même chose — celle du bas est la vraie.
 */
export interface NoteSoap {
  readonly subjective: string | null;
  readonly objective: string | null;
  readonly assessment: string | null;
  readonly plan: string | null;
}

export const CHAMPS_SOAP = ["subjective", "objective", "assessment", "plan"] as const;

export type ChampSoap = (typeof CHAMPS_SOAP)[number];

/**
 * La note d'une séance, telle que l'écran la lit.
 *
 * `lockAfter` est renseigné DÈS la signature, jamais avant : c'est
 * `trg_note_sign` qui le pose. Un `lockAfter` non nul sur un brouillon
 * signalerait un défaut en base, pas un cas à gérer ici.
 */
export interface Note {
  readonly id: string;
  readonly status: NoteStatus;
  readonly soap: NoteSoap;
  readonly signedAt: string | null;
  readonly signerName: string | null;
  readonly lockAfter: string | null;
}

export interface Consultation {
  readonly id: string;
  readonly status: ConsultationStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly rawNotes: string | null;
  readonly appointmentId: string | null;
  readonly appointmentKind: ConsultationKind | null;
  readonly patientId: string | null;
  readonly recordNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly practitionerId: string;
  readonly practitionerName: string | null;
  /** `null` tant qu'aucune note n'a été ouverte — c'est l'état initial d'une séance. */
  readonly note: Note | null;
}

export interface Amendment {
  readonly id: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly reason: string;
  readonly body: string;
  readonly createdAt: string;
}

interface ConsultationRow {
  readonly id: string;
  readonly status: ConsultationStatus;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly raw_notes: string | null;
  readonly appointment_id: string | null;
  readonly appointment_kind: ConsultationKind | null;
  readonly patient_id: string | null;
  readonly record_number: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly practitioner_id: string;
  readonly practitioner_name: string | null;
  readonly note_id: string | null;
  readonly note_status: NoteStatus | null;
  readonly subjective: string | null;
  readonly objective: string | null;
  readonly assessment: string | null;
  readonly plan: string | null;
  readonly signed_at: string | null;
  readonly signer_name: string | null;
  readonly lock_after: string | null;
}

interface AmendmentRow {
  readonly id: string;
  readonly author_id: string;
  readonly author_name: string | null;
  readonly reason: string;
  readonly body: string;
  readonly created_at: string;
}

function toNote(row: ConsultationRow): Note | null {
  // La jointure est un LEFT JOIN en base : une séance sans note rend bien une
  // ligne, avec les colonnes de note à NULL. `note_id` est le seul témoin fiable
  // de la présence d'une note — un champ SOAP vide n'en est pas un, puisqu'une
  // note peut exister avec un seul de ses quatre champs renseigné.
  if (row.note_id === null || row.note_status === null) return null;

  return {
    id: row.note_id,
    status: row.note_status,
    soap: {
      subjective: row.subjective,
      objective: row.objective,
      assessment: row.assessment,
      plan: row.plan,
    },
    signedAt: row.signed_at,
    signerName: row.signer_name,
    lockAfter: row.lock_after,
  };
}

function toConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    rawNotes: row.raw_notes,
    appointmentId: row.appointment_id,
    appointmentKind: row.appointment_kind,
    patientId: row.patient_id,
    recordNumber: row.record_number,
    firstName: row.first_name,
    lastName: row.last_name,
    practitionerId: row.practitioner_id,
    practitionerName: row.practitioner_name,
    note: toNote(row),
  };
}

// ---------------------------------------------------------------------------
// Le verrou, tel que l'interface le LIT — la base reste seule à le DÉCIDER
// ---------------------------------------------------------------------------

/**
 * Où en est la fenêtre de correction de 15 minutes (I15).
 *
 * UNE SEULE FONCTION, LUE PAR TOUT LE MONDE. C'est la leçon de `repartition()`
 * en S4 : la grille d'agenda plaçait les séances d'un côté et les comptait de
 * l'autre, et l'écran affirmait « 0 séance » sur un jour qui en portait deux.
 * Deux calculs pour une même vérité finissent toujours par diverger. L'écran de
 * consultation ne recalcule donc jamais cette fenêtre de son côté.
 *
 * `maintenant` est un PARAMÈTRE, pas un `Date.now()` interne : une fonction qui
 * lit l'horloge n'est pas testable, et celle-ci décide de ce qu'on affiche à
 * propos d'une pièce juridique.
 */
export type EtatVerrou = "brouillon" | "fenetre-correction" | "verrouillee";

export function noteEstVerrouillee(note: Note | null, maintenant: number): EtatVerrou {
  if (note === null || note.status === "draft") return "brouillon";

  // Note signée SANS `lockAfter` : impossible si `trg_note_sign` a fait son
  // travail. On tranche vers le plus sûr — verrouillée — plutôt que d'ouvrir
  // l'édition d'une note signée sur la foi d'une colonne manquante.
  if (note.lockAfter === null) return "verrouillee";

  const echeance = Date.parse(note.lockAfter);
  if (Number.isNaN(echeance)) return "verrouillee";

  return maintenant < echeance ? "fenetre-correction" : "verrouillee";
}

/**
 * Millisecondes restantes avant verrouillage, ou `null` hors fenêtre.
 * Dérivée de la même donnée que `noteEstVerrouillee`, pour la même raison.
 */
export function tempsRestantAvantVerrou(
  note: Note | null,
  maintenant: number,
): number | null {
  if (noteEstVerrouillee(note, maintenant) !== "fenetre-correction") return null;
  if (note?.lockAfter == null) return null;
  return Math.max(0, Date.parse(note.lockAfter) - maintenant);
}

/** Une note vide ne se signe pas — `app.sign_note` refuse, l'écran le sait avant. */
export function noteEstVide(soap: NoteSoap): boolean {
  return CHAMPS_SOAP.every((champ) => (soap[champ] ?? "").trim() === "");
}

// ---------------------------------------------------------------------------
// Les portes
// ---------------------------------------------------------------------------

export interface StartConsultationInput {
  readonly patientId: string;
  /**
   * OBLIGATOIRE, et ce n'est pas une contrainte d'interface : c'est le
   * rendez-vous qui prouve que le dossier relève de l'appelante. Le `WITH CHECK`
   * de `consultations_clinical` (007) ne porte que sur `practitioner_id` — sans
   * rendez-vous, une praticienne pourrait ouvrir une séance sur la patiente
   * d'une consœur (ADR-003). La porte 026 refuse `NULL` ; ce typage ne fait que
   * rendre le refus impossible à provoquer par distraction.
   */
  readonly appointmentId: string;
}

/**
 * Ouvre une séance, ou REPREND celle qui est déjà ouverte sur le même
 * rendez-vous. La reprise est décidée en base (026) : deux onglets, un
 * rechargement de page ou un double clic ne doivent pas produire une violation
 * d'unicité illisible.
 */
export async function startConsultation(
  input: StartConsultationInput,
): Promise<Result<string>> {
  const result = await db().rpc<string>("start_consultation", {
    p_patient_id: input.patientId,
    p_appointment_id: input.appointmentId,
  });

  if (!result.ok) {
    log.error("consultation.ouverture", { code: result.error.code });
    return err(result.error);
  }

  const id = result.data[0];
  if (id === undefined || id === null) {
    // La porte rend toujours un identifiant en cas de succès. Une réponse vide
    // signifie que la RLS a refusé sans lever — on ne rend PAS un succès, sinon
    // l'écran ouvrirait une séance qui n'existe pas.
    log.error("consultation.ouverture", { code: "vide" });
    return err({ code: "interdit", message: fr.erreurs.interdit });
  }

  log.info("consultation.ouverture", { count: 1 });
  return ok(id);
}

/** L'identifiant de la séance ouverte de l'appelante, ou `null`. Ne journalise rien en base. */
export async function getOpenConsultation(): Promise<Result<string | null>> {
  const result = await db().rpc<string>("get_open_consultation", {});

  if (!result.ok) {
    log.error("consultation.encours", { code: result.error.code });
    return err(result.error);
  }

  return ok(result.data[0] ?? null);
}

export async function getConsultation(id: string): Promise<Result<Consultation | null>> {
  const result = await db().rpc<ConsultationRow>("get_consultation", { p_id: id });

  if (!result.ok) {
    // Aucun identifiant patient ici : règle 1 et I5. La trace nominative légale
    // est écrite par la porte, AVANT la lecture, donc elle existe même quand cet
    // appel échoue.
    log.error("consultation.lecture", { code: result.error.code });
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) {
    // Séance inexistante OU hors périmètre : la base ne distingue pas les deux,
    // et l'interface ne doit pas non plus (cloison ADR-003).
    return ok(null);
  }

  return ok(toConsultation(row));
}

/**
 * Enregistre le brouillon de travail de la séance.
 *
 * Appelée souvent — à chaque pause de frappe. Elle rend `false` quand la séance
 * est introuvable ou hors périmètre : pas une erreur, mais surtout pas un
 * succès, sinon l'écran afficherait « Enregistré » sur un texte perdu.
 */
export async function saveRawNotes(id: string, texte: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("save_raw_notes", {
    p_id: id,
    p_texte: texte,
  });

  if (!result.ok) {
    log.error("consultation.brouillon", { code: result.error.code });
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  return ok(touche);
}

export async function closeConsultation(id: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("close_consultation", { p_id: id });

  if (!result.ok) {
    log.error("consultation.cloture", { code: result.error.code });
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("consultation.cloture", { count: touche ? 1 : 0 });
  return ok(touche);
}

/**
 * Enregistre les champs SOAP.
 *
 * Une propriété ABSENTE ne change rien ; une chaîne vide EFFACE. Le document
 * est construit clé par clé plutôt que sérialisé d'un bloc : `app.save_note`
 * REFUSE toute clé hors allowlist, et il vaut mieux ne pas l'envoyer que
 * s'expliquer avec une erreur de base sur un écran de consultation.
 */
export async function saveNote(
  consultationId: string,
  changes: Partial<Record<ChampSoap, string>>,
): Promise<Result<string | null>> {
  const document: Record<string, string> = {};
  for (const champ of CHAMPS_SOAP) {
    const valeur = changes[champ];
    if (valeur !== undefined) document[champ] = valeur;
  }

  if (Object.keys(document).length === 0) {
    // Rien à écrire. On ne consulte pas la base pour ne rien faire : ce serait
    // une ligne d'audit d'écriture pour une modification qui n'a pas eu lieu.
    return ok(null);
  }

  const result = await db().rpc<string>("save_note", {
    p_consultation_id: consultationId,
    // Le document voyage SÉRIALISÉ : `RpcArgs` (ADR-020) n'accepte que des
    // scalaires, délibérément. La porte reçoit du `text` et fait le cast.
    p_changes: JSON.stringify(document),
  });

  if (!result.ok) {
    log.error("note.brouillon", { code: result.error.code });
    return err(result.error);
  }

  return ok(result.data[0] ?? null);
}

/**
 * Signe la note. Geste humain explicite, jamais automatisé.
 *
 * ⚠️ Cette fonction n'entre dans AUCUNE allowlist Jarvis, aujourd'hui ni plus
 * tard : `sign_clinical_note` est un outil interdit (CLAUDE.md), parce que la
 * signature porte la responsabilité médicale de la praticienne.
 */
export async function signNote(noteId: string): Promise<Result<boolean>> {
  const result = await db().rpc<string>("sign_note", { p_id: noteId });

  if (!result.ok) {
    log.error("note.signature", { code: result.error.code });
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("note.signature", { count: touche ? 1 : 0 });
  return ok(touche);
}

export async function amendNote(
  noteId: string,
  motif: string,
  corps: string,
): Promise<Result<boolean>> {
  const result = await db().rpc<string>("amend_note", {
    p_note_id: noteId,
    p_motif: motif,
    p_corps: corps,
  });

  if (!result.ok) {
    log.error("note.amendement", { code: result.error.code });
    return err(result.error);
  }

  const touche = result.data[0] !== undefined && result.data[0] !== null;
  log.info("note.amendement", { count: touche ? 1 : 0 });
  return ok(touche);
}

export async function listAmendments(noteId: string): Promise<Result<readonly Amendment[]>> {
  const result = await db().rpc<AmendmentRow>("list_amendments", { p_note_id: noteId });

  if (!result.ok) {
    log.error("note.amendements", { code: result.error.code });
    return err(result.error);
  }

  log.info("note.amendements", { count: result.data.length });
  return ok(
    result.data.map((row) => ({
      id: row.id,
      authorId: row.author_id,
      authorName: row.author_name,
      reason: row.reason,
      body: row.body,
      createdAt: row.created_at,
    })),
  );
}
