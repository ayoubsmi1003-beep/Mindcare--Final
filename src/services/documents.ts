/**
 * Documents — émission, lecture d'un dossier, impression.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE. Ni `documents`, ni `document_templates`.
 * Il n'appelle que les quatre portes de la migration 030, et le contrôle 1 du
 * checkpoint S7b le vérifie.
 *
 * La raison est celle de S5/S7a, transposée aux documents : un document EST une
 * pièce clinique (policy `documents_clinical`, 010) et `get_document` /
 * `list_patient_documents` nomment des patients — elles écrivent une trace
 * `fiche` / `liste` dans `audit.log` AVANT de lire. Requêter `app.documents` par
 * PostgREST rendrait les mêmes lignes SANS cette trace — le chemin non audité
 * qu'ADR-019 a fermé.
 *
 * ═══ CE QUE CE FICHIER NE DÉCIDE PAS ═══════════════════════════════════════
 *
 * Il ne décide RIEN de la cloison. Qui peut émettre, qui peut lire, qui reçoit
 * zéro ligne est tranché EN BASE (RLS + `app.current_role()`, 030 §2/§3). Si
 * jamais on lisait ici `if (role === 'assistant')` pour cacher un document, ce
 * serait un défaut de conception — la policy est l'endroit où corriger.
 *
 * Il ne rend PAS un document modifiable ou supprimable. `030` ne pose aucune
 * porte `update_document` ni `delete_document`, et la table elle-même est
 * verrouillée par trigger (`assert_document_immutable`, `forbid_document_delete`)
 * — un document émis ne se corrige jamais depuis cet écran ni aucun autre.
 */

import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

/** Miroir exact de `app.doc_type` (002). Fermé : un type non listé ici ne compile pas. */
export type TypeDocument =
  | "bonne_sante_mentale"
  | "suivi_medical"
  | "certificat_medical"
  | "justification";

export type StatutDocument = "issued" | "voided";

/** Contrat canonique de readiness — couche métier autoritaire */
export interface ReadinessMissing {
  readonly key: string;
  readonly label: string;
  readonly severity: "blocking" | "warning";
}
export interface DocumentReadiness {
  readonly canIssue: boolean;
  readonly canPrint: boolean;
  readonly missing: readonly ReadinessMissing[];
}

/**
 * Le jeu de champs EXACT attendu par `app.issue_document` pour chaque type.
 *
 * ⚠️ MIROIR D'UN CONTRAT GELÉ EN BASE (030 §2, ADR-011), PAS UNE SOURCE.
 * La base refuse une clé en trop comme une clé manquante ; ce tableau ne fait
 * que permettre au formulaire de demander les bons champs AVANT l'aller-retour.
 * Il ne décide rien : si les deux divergent un jour, c'est la base qui a
 * raison et l'écran qui tombe — pas l'inverse.
 *
 * ⚠️ `jours_lettres` EST DEMANDÉ PAR LA BASE MAIS N'EST PAS SAISI. 030 l'exige
 * dans le jeu de clés ; 043 l'ÉCRASE au moment du rendu par le résultat de
 * `app.nombre_en_lettres`. Ce qui s'imprime ne peut donc pas contredire le
 * nombre en chiffres, quoi qu'envoie l'appelant. Le formulaire l'affiche en
 * lecture seule, pour que la praticienne voie ce qui partira.
 *
 * ⚠️ DEPUIS 045, IL EXISTE UNE CLÉ FACULTATIVE, ET « FACULTATIF » NE VEUT PAS
 * DIRE « OMISSIBLE ». `traitement_2` (certificat médical, seconde puce) peut
 * partir VIDE, mais elle doit partir : le test d'ensemble reste exact, et une
 * clé absente est toujours un refus. Pire, si la base l'acceptait absente, le
 * marqueur resterait littéral sur le papier. L'écran envoie donc TOUJOURS les
 * trois clés — voir la construction du payload dans `/documents`, qui les
 * dérive du contrat plutôt que de ce que la praticienne a tapé.
 */
export const CHAMPS_PAR_TYPE: Readonly<Record<TypeDocument, readonly string[]>> = {
  bonne_sante_mentale: ["id_document_number", "mairie"],
  suivi_medical: ["jours", "jours_lettres", "date_debut"],
  certificat_medical: ["date_naissance", "traitement_1", "traitement_2"],
  justification: ["date_consultation"],
};

/** L'ordre d'affichage des types dans l'écran. Le plus courant en premier. */
export const TYPES_DOCUMENT: readonly TypeDocument[] = [
  "bonne_sante_mentale",
  "suivi_medical",
  "certificat_medical",
  "justification",
];

export interface Document {
  readonly id: string;
  readonly docType: TypeDocument;
  readonly docNumber: string;
  /** Absent sur les lignes de liste — seule `getDocument` le rend. */
  readonly renderedHtml: string | null;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly issuedAt: string;
  readonly printedCount: number;
  readonly consultationId: string | null;
  readonly patientId: string | null;
  readonly patientPrenom: string | null;
  readonly patientNom: string | null;
  readonly recordNumber: string | null;
  readonly practitionerName: string | null;
  readonly status: StatutDocument;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly templateId: string | null;
  readonly templateVersion: number | null;
  readonly contentHash: string | null;
  readonly snapshotHeader: Readonly<Record<string, unknown>> | null;
  readonly schemaVersion: string | null;
}

interface DocumentRow {
  readonly document_id: string;
  readonly doc_type: TypeDocument;
  readonly doc_number: string;
  readonly rendered_html?: string;
  readonly variables?: Record<string, unknown>;
  readonly issued_at: string;
  readonly printed_count: number;
  readonly consultation_id: string | null;
  readonly patient_id?: string;
  readonly patient_first_name: string | null;
  readonly patient_last_name: string | null;
  readonly record_number: string | null;
  readonly practitioner_name: string | null;
  readonly status?: StatutDocument;
  readonly voided_at?: string | null;
  readonly void_reason?: string | null;
  readonly template_id?: string | null;
  readonly template_version?: number | null;
  readonly content_hash?: string | null;
  readonly snapshot_header?: Record<string, unknown> | null;
  readonly schema_version?: string | null;
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.document_id,
    docType: row.doc_type,
    docNumber: row.doc_number,
    renderedHtml: row.rendered_html ?? null,
    variables: row.variables ?? {},
    issuedAt: row.issued_at,
    printedCount: row.printed_count,
    consultationId: row.consultation_id,
    patientId: row.patient_id ?? null,
    patientPrenom: row.patient_first_name,
    patientNom: row.patient_last_name,
    recordNumber: row.record_number,
    practitionerName: row.practitioner_name,
    status: row.status ?? "issued",
    voidedAt: row.voided_at ?? null,
    voidReason: row.void_reason ?? null,
    templateId: row.template_id ?? null,
    templateVersion: row.template_version ?? null,
    contentHash: row.content_hash ?? null,
    snapshotHeader: row.snapshot_header ?? null,
    schemaVersion: row.schema_version ?? null,
  };
}

// ---------------------------------------------------------------------------
// Les portes
// ---------------------------------------------------------------------------

/**
 * Émet un document et fige son HTML.
 *
 * `variables` voyage SÉRIALISÉ (ADR-020, `RpcArgs` n'accepte que des
 * scalaires) — la base le reparse et valide le jeu de clés exact du `docType`
 * (ADR-011). Rend `null` quand le dossier est introuvable OU hors périmètre :
 * la base ne distingue pas les deux (ADR-003), l'interface non plus.
 *
 * ⚠️ Un document émis ne se réémet pas. Un double appel avec les mêmes
 * arguments crée un SECOND document, numéroté à sa date — ce n'est PAS
 * rejouable comme `setConsultationPrice`, et l'appelant (l'écran) doit s'assurer
 * qu'un clic ne part qu'une fois.
 */
export async function issueDocument(
  patientId: string,
  docType: TypeDocument,
  variables: Readonly<Record<string, string | number | boolean>>,
  consultationId: string | null = null,
): Promise<Result<string | null>> {
  const result = await db().rpc<string>("issue_document", {
    p_patient_id: patientId,
    p_doc_type: docType,
    p_variables: JSON.stringify(variables),
    p_consultation_id: consultationId,
  });

  if (!result.ok) {
    // Ni identifiant patient, ni variables : règle 1 et I5. Un nom ou une date
    // de naissance dans un journal, c'est une donnée patiente hors machine.
    log.error("documents.emission", logFieldsFor(result.error));
    return err(result.error);
  }

  const id = result.data[0] ?? null;
  log.info("documents.emission", { count: id === null ? 0 : 1 });
  return ok(id);
}

/**
 * UN document, avec son HTML figé — pour l'aperçu ou l'impression.
 *
 * Écrit une trace `fiche` dans `audit.log` AVANT de rendre l'identité du
 * patient (030 §3). Rend `null` pour l'assistante : zéro ligne, aucune trace —
 * elle n'a rien lu.
 */
export async function getDocument(documentId: string): Promise<Result<Document | null>> {
  const result = await db().rpc<DocumentRow>("get_document", { p_id: documentId });

  if (!result.ok) {
    log.error("documents.lecture", logFieldsFor(result.error));
    return err(result.error);
  }

  const row = result.data[0];
  if (row === undefined) return ok(null);

  return ok(toDocument(row));
}

/**
 * Les documents d'UN dossier, sans leur HTML (liste, pas aperçu).
 *
 * Écrit une trace `liste` dans `audit.log` AVANT de rendre — et seulement si le
 * dossier est réellement approchable (030 §3). Assistante → tableau vide, zéro
 * trace.
 */
export async function listPatientDocuments(
  patientId: string,
): Promise<Result<readonly Document[]>> {
  const result = await db().rpc<DocumentRow>("list_patient_documents", {
    p_patient_id: patientId,
  });

  if (!result.ok) {
    log.error("documents.dossier", logFieldsFor(result.error));
    return err(result.error);
  }

  log.info("documents.dossier", { count: result.data.length });
  return ok(result.data.map(toDocument));
}

/**
 * Incrémente le compteur d'impression d'un document.
 *
 * Ne touche à rien d'autre : ni `renderedHtml`, ni `variables`, ni `issuedAt` —
 * un trigger de 030 l'interdirait de toute façon. Rend le nouveau compteur, ou
 * `null` si le document est introuvable ou hors périmètre.
 */
export async function markDocumentPrinted(documentId: string): Promise<Result<number | null>> {
  const result = await db().rpc<number>("mark_document_printed", { p_id: documentId });

  if (!result.ok) {
    log.error("documents.impression", logFieldsFor(result.error));
    return err(result.error);
  }

  const compte = result.data[0] ?? null;
  log.info("documents.impression", { count: compte ?? 0 });
  return ok(compte);
}

/**
 * Convertit un nombre de jours en toutes lettres — pour l'APERÇU du formulaire.
 *
 * ⚠️ CE N'EST PAS CETTE VALEUR QUI S'IMPRIME. Le certificat porte ce que
 * `app.issue_document` recalcule à l'émission (043 §5bis), pas ce que l'écran
 * a affiché. Appeler la même fonction Postgres ici garantit simplement que
 * l'aperçu ne ment pas : une conversion écrite en TypeScript serait une
 * SECONDE vérité, qui divergerait un jour sans que rien ne le signale.
 *
 * Rend `null` hors du domaine 1–999, où la base lève : le formulaire affiche
 * alors sa propre borne plutôt qu'un message de Postgres.
 */
export async function nombreEnLettres(n: number): Promise<Result<string | null>> {
  if (!Number.isInteger(n) || n < 1 || n > 999) return ok(null);

  const result = await db().rpc<string>("nombre_en_lettres", { p_n: n });

  if (!result.ok) {
    log.error("documents.lettres", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(result.data[0] ?? null);
}

// ---------------------------------------------------------------------------
// Readiness — contrat canonique
// ---------------------------------------------------------------------------

const LIBELLES_MANQUANTS: Readonly<Record<string, string>> = {
  "cabinet.name": "Nom du cabinet",
  "cabinet.address": "Adresse du cabinet",
  "cabinet.phone": "Téléphone du cabinet",
  "praticien.full_name": "Nom de la praticienne",
  "praticien.title": "Titre de la praticienne",
  "praticien.speciality_fr": "Spécialité",
  "praticien.order_number": "N° d'Ordre",
  "praticien.phone": "Téléphone de la praticienne",
  "praticien.full_name_ar": "Nom arabe de la praticienne",
};

export async function getDocumentReadiness(): Promise<Result<DocumentReadiness>> {
  const result = await db().rpc<{ canIssue: boolean; canPrint: boolean; missing: string[] }>(
    "document_readiness",
    {},
  );
  if (!result.ok) {
    log.error("documents.readiness", logFieldsFor(result.error));
    return err(result.error);
  }
  const rowUnknown: unknown = result.data[0];
  const row = rowUnknown as { canIssue?: boolean; canPrint?: boolean; missing?: string[] } | undefined;
  // Le RPC document_readiness renvoie jsonb scalari: PostgREST livre l'objet directement
  // Si le pilote livre jsonb comme row, on le normalise
  let payload: { canIssue: boolean; canPrint: boolean; missing: string[] };
  const rowCanIssue = (row as { canIssue?: unknown } | undefined)?.canIssue;
  if (row !== undefined && typeof rowCanIssue === "boolean") {
    payload = row as { canIssue: boolean; canPrint: boolean; missing: string[] };
  } else if (
    row !== undefined &&
    typeof (row as { document_readiness?: unknown }).document_readiness === "object"
  ) {
    const withDoc = row as { document_readiness: { canIssue: boolean; canPrint: boolean; missing: string[] } };
    payload = withDoc.document_readiness;
  } else {
    // fallback: si le RPC retourne jsonb en tant que valeur scalaire dans data[0]
    const raw: unknown = result.data[0];
    if (raw !== null && typeof raw === "object" && "canIssue" in (raw as Record<string, unknown>)) {
      payload = raw as { canIssue: boolean; canPrint: boolean; missing: string[] };
    } else {
      // Défaut sûr: considérer non prêt
      return ok({ canIssue: false, canPrint: false, missing: [] });
    }
  }
  const missing: readonly ReadinessMissing[] = (payload.missing ?? []).map((k) => ({
    key: k,
    label: LIBELLES_MANQUANTS[k] ?? k,
    severity: "blocking" as const,
  }));
  return ok({ canIssue: payload.canIssue, canPrint: payload.canPrint, missing });
}

// ---------------------------------------------------------------------------
// Liste globale paginée
// ---------------------------------------------------------------------------
export interface ListDocumentsFilters {
  readonly query?: string | null;
  readonly type?: TypeDocument | null;
  readonly status?: StatutDocument | null;
  readonly limit?: number;
  readonly offset?: number;
}

export async function listDocuments(
  filters: ListDocumentsFilters = {},
): Promise<Result<readonly Document[]>> {
  const result = await db().rpc<DocumentRow>("list_documents", {
    p_query: filters.query ?? null,
    p_type: filters.type ?? null,
    p_status: filters.status ?? null,
    p_limit: filters.limit ?? 20,
    p_offset: filters.offset ?? 0,
  });
  if (!result.ok) {
    log.error("documents.listeGlobale", logFieldsFor(result.error));
    return err(result.error);
  }
  log.info("documents.listeGlobale", { count: result.data.length });
  return ok(result.data.map(toDocument));
}

// ---------------------------------------------------------------------------
// Annuler (void)
// ---------------------------------------------------------------------------
export async function voidDocument(
  documentId: string,
  reason: string,
): Promise<Result<void>> {
  const r = await db().rpc<unknown>("void_document", {
    p_id: documentId,
    p_reason: reason,
  });
  if (!r.ok) {
    log.error("documents.annulation", logFieldsFor(r.error));
    return err(r.error);
  }
  log.info("documents.annulation", { count: 1 });
  return ok(undefined);
}

export async function verifyDocumentHash(documentId: string): Promise<Result<boolean | null>> {
  const r = await db().rpc<boolean>("verify_document_hash", { p_id: documentId });
  if (!r.ok) {
    log.error("documents.hash", logFieldsFor(r.error));
    return err(r.error);
  }
  const v = r.data[0];
  return ok(v ?? null);
}
