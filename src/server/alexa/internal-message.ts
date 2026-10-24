/**
 * Le canal `app.internal_messages` est opérationnel, jamais clinique.
 *
 * Le commentaire de `cabinet-collaboration.ts` est explicite : ni nom de
 * patient, ni identifiant de dossier, ni montant. Cette garde rend la règle
 * exécutable avant la proposition, au lieu de compter sur la rédaction du
 * modèle. Elle est volontairement stricte : un message refusé peut toujours
 * être remplacé par le geste « patient arrivé » sur le tableau de réception.
 */

export interface InternalMessagePatient {
  readonly firstName: string;
  readonly lastName: string;
  readonly recordNumber?: string | null;
  readonly idDocumentNumber?: string | null;
}

export type InternalMessageDecision =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: "empty" | "too-long" | "patient-data" | "clinical-data" };

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

const CLINICAL_TERMS = [
  "diagnostic", "diagnose", "pathologie", "symptome", "traitement",
  "medicament", "ordonnance", "posologie", "dose", "mg", "certificat",
  "arret de travail", "arret", "consultation", "dossier medical",
  "psychose", "depression", "anxiete", "suicide", "schizophrenie",
  "bipolar", "hallucination", "delire", "insomnie",
] as const;

function containsToken(haystack: string, raw: string | null | undefined): boolean {
  const token = normalized(raw ?? "");
  return token.length >= 3 && haystack.includes(token);
}

export function prepareInternalMessage(
  raw: string,
  patient: InternalMessagePatient,
): InternalMessageDecision {
  const body = raw.trim();
  if (body.length < 3) return { ok: false, reason: "empty" };
  if (body.length > 1000) return { ok: false, reason: "too-long" };

  const text = normalized(body);
  if (containsToken(text, patient.firstName) || containsToken(text, patient.lastName)
    || containsToken(text, patient.recordNumber) || containsToken(text, patient.idDocumentNumber)) {
    return { ok: false, reason: "patient-data" };
  }

  // Un identifiant ou un numéro de dossier recopié sans le nom reste une
  // donnée patient. Un petit nombre opérationnel (« 20 minutes ») reste permis.
  if (/(?<!\d)\d{6,}(?!\d)/u.test(text)) return { ok: false, reason: "patient-data" };
  if (CLINICAL_TERMS.some((term) => text.includes(term))) {
    return { ok: false, reason: "clinical-data" };
  }
  return { ok: true, body };
}
