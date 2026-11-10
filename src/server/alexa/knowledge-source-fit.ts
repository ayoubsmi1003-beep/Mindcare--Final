/**
 * Some rows can't answer some questions, however well their words match. Measured: "que faire devant
 * une dyskinésie tardive" filled its five places with the French DSM, a diagnostic manual, because
 * its words match in French while the English treatment books only reach the list through vectors.
 *
 * This only removes rows. Known limit: when a treatment question has its only passages in the DSM, the
 * answer says no evidence was found, which this filter caused.
 */
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/gu, " ");

const TREATMENT = /\b(?:traiter|traitements?|soigner|que faire|prise en charge|prendre en charge|posologies?|doses?|dosages?|titration|titrer|how to treat|treatment|management|dosing)\b/u;
const DIAGNOSTIC = /\b(?:dsm\w*|criteres?|diagnostics?|diagnostiques?|definition|qu est[- ]ce)\b/u;

export function asksForTreatment(question: string): boolean {
  const text = fold(question);
  return TREATMENT.test(text) && !DIAGNOSTIC.test(text);
}

/** The Stahl "Generic?" rows hold "Yes" or "No" about availability, and were being quoted as answers. */
export function rowCanAnswer(question: string, title: string, section: string | null | undefined, locationQuestion: boolean): boolean {
  const path = fold(section ?? "").split("›").map(part => part.trim());
  if (!locationQuestion && path.includes("index") && !/\bindex\b/u.test(fold(question))) return false;
  if (path.at(-1) === "generic?" && !/generi/u.test(fold(question))) return false;
  if (!locationQuestion && /\bdsm\b/u.test(fold(title)) && asksForTreatment(question)) return false;
  return true;
}
