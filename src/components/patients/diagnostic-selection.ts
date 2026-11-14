import { DIAGNOSTICS_FREQUENTS } from '@/i18n/diagnostics-referentiel';
import type { NouveauDiagnostic } from '@/services/diagnoses';
import type { Diagnostic } from '@/services/patients';

export function diagnosticSelection(patientId: string, code: string, diagnostics: readonly Diagnostic[]): NouveauDiagnostic | null {
  const entry = DIAGNOSTICS_FREQUENTS.find(item => item.code === code);
  if (!entry) return null;
  return { patientId, label: entry.label, codeSystem: entry.codeSystem, code: entry.code,
    isPrimary: !diagnostics.some(item => item.resolvedAt === null && item.isPrimary), onsetDate: null };
}

export function addDiagnostic(current: readonly Diagnostic[], added: Diagnostic): readonly Diagnostic[] {
  return [...current.map(item => added.isPrimary && item.isPrimary && item.resolvedAt === null ? {...item, isPrimary: false} : item), added]
    .sort((a,b) => Number(b.isPrimary) - Number(a.isPrimary) || a.label.localeCompare(b.label, 'fr'));
}
