/** Interim G7 triage, never a substitute for span-level medication review. */
export function contientDoseOcrNonLiberee(extrait: string): boolean {
  const doseUnit = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|microgrammes?|mmol|IU|UI)\b(?!\s*\/\s*(?:dL|L|mL)\b)/iu;
  const liquid = /\d+(?:[.,]\d+)?\s*m[lL]\b(?!\s*\/\s*min\b)/iu;
  const formCount = /\d+(?:[.,]\d+)?\s*(?:tablets?|comprim[ée]s?|capsules?|gouttes?|drops?)\b/iu;
  const namedDose = /\b(?:dose|dosing|dosage|posolog\w*|administr\w*)\b[^\n.!?]{0,35}\d/iu;
  return doseUnit.test(extrait) || liquid.test(extrait) || formCount.test(extrait) || namedDose.test(extrait);
}
