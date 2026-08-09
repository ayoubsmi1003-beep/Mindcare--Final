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
import { log } from "./log";
import { err, ok, type Result } from "./result";

/** Miroir exact de `app.doc_type` (002). Fermé : un type non listé ici ne compile pas. */
export type TypeDocument =
  | "bonne_sante_mentale"
  | "suivi_medical"
  | "certificat_medical"
  | "justification";

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
    log.error("documents.emission", { code: result.error.code });
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
    log.error("documents.lecture", { code: result.error.code });
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
    log.error("documents.dossier", { code: result.error.code });
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
    log.error("documents.impression", { code: result.error.code });
    return err(result.error);
  }

  const compte = result.data[0] ?? null;
  log.info("documents.impression", { count: compte ?? 0 });
  return ok(compte);
}
