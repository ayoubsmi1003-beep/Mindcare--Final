import { expect, it } from 'vitest';
import type { ClinicalContext } from '@/shared/alexa/clinical';
import { clinicalSectionComplete, clinicalSummaryComplete } from '@/server/alexa/clinical-coverage';

it('treats a verified bounded consultation summary as complete without requiring older history', () => {
  const consultations = Array.from({ length: 6 }, (_, visit) => ({
    id: `a1000000-0000-4000-8000-${String(visit + 1).padStart(12, '0')}`,
    startedAt: `2026-10-${String(visit + 1).padStart(2, '0')}T09:00:00Z`,
    endedAt: `2026-10-${String(visit + 1).padStart(2, '0')}T09:30:00Z`,
    notes: [{
      id: `a2000000-0000-4000-8000-${String(visit + 1).padStart(12, '0')}`,
      version: '1',
      subjective: 's'.repeat(500), objective: 'o'.repeat(500), assessment: 'a'.repeat(500), plan: 'p'.repeat(500),
      amendments: [],
    }],
  }));
  const context: ClinicalContext = {
    patientId: 'a3000000-0000-4000-8000-000000000001',
    consultations,
    diagnoses: [], scales: [],
    treatments: { current: [], history: [], historyComplete: true },
    sourceRevision: 'a'.repeat(64),
    coverage: { requested: 6, returned: 6, complete: true, hasMore: true },
  };

  expect(clinicalSectionComplete(context, 'history')).toBe(false);
  expect(clinicalSummaryComplete(context, true, true)).toBe(true);
  expect(clinicalSummaryComplete(context, false, true)).toBe(false);
  expect(clinicalSummaryComplete(context, true, false)).toBe(false);
});

it('treats an unqualified summary as partial when older consultations remain',()=>{
 const context={patientId:'a3000000-0000-4000-8000-000000000001',consultations:[],diagnoses:[],scales:[],treatments:{current:[],history:[],historyComplete:true},sourceRevision:'a'.repeat(64),coverage:{requested:6,returned:6,complete:true,hasMore:true}} satisfies ClinicalContext;
 expect(clinicalSummaryComplete(context,true,false)).toBe(false);
 expect(clinicalSummaryComplete(context,true,true)).toBe(true);
});
