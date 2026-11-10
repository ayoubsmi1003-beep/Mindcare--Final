import { expect, it, vi } from 'vitest';

const clinical = vi.hoisted(() => ({ buildClinicalContext: vi.fn() }));
const narrative = vi.hoisted(() => ({
  extractRecurringClinicalTheme: vi.fn(() => null),
  summarizeClinicalConsultations: vi.fn(),
  summarizeClinicalContext: vi.fn(),
  summarizeClinicalCaseContext: vi.fn(),
  relativeClinicalDate: vi.fn(() => ''),
  requestsClinicalDate: vi.fn(() => false),
}));
vi.mock('@/server/alexa/clinical-context', () => clinical);
vi.mock('@/server/alexa/clinical-narrative', () => narrative);

import { agentExecutor } from '@/server/alexa/agent-tools';
import type { ClinicalContext } from '@/shared/alexa/clinical';
import type { DbPort } from '@/services/db/port';

const patientId = '22222222-2222-4222-8222-222222222222';
const visit = (id: string, day: string) => ({ id, startedAt: `${day}T10:00:00+01:00`, endedAt: `${day}T11:00:00+01:00`, notes: [] });
const context = (): ClinicalContext => ({
  patientId, consultations: [visit('33333333-3333-4333-8333-333333333333', '2026-10-20'), visit('44444444-4444-4444-8444-444444444444', '2026-10-10')],
  treatments: { current: [], history: [], historyComplete: true }, diagnoses: [], scales: [], sourceRevision: 'a'.repeat(64),
  coverage: { requested: 100, returned: 2, complete: true, hasMore: false },
});
const rpc: Pick<DbPort, 'rpc'>['rpc'] = async <T>(name: string) => {
  if (name !== 'get_patient') return { ok: false as const, error: { code: 'inattendu' as const, message: 'Unexpected' } };
  return { ok: true as const, data: [{ id: patientId, first_name: 'Lina', last_name: 'Test' }] as unknown as readonly T[] };
};
const run = (text: string) => {
  const input = { text, conversationId: 'plain-summary', clientTurnId: crypto.randomUUID(), appContext: { patientId, page: `/patients/${patientId}` } };
  return agentExecutor(input, { rpc }, { rpc: vi.fn() })({ id: 'summary', name: 'get_patient_context', args: { partIds: ['summary'], section: 'summary' } }, '2026-10-27T09:00:00+01:00', [], new AbortController().signal);
};

it('answers a plain record summary from the recorded fields, without asking the model', async () => {
  clinical.buildClinicalContext.mockResolvedValue(context());
  narrative.summarizeClinicalCaseContext.mockRejectedValue(new Error('the model must not be asked'));
  const result = await run('Résume le dossier du patient sélectionné.');
  expect(narrative.summarizeClinicalCaseContext).not.toHaveBeenCalled();
  expect(result.status).toBe('ok');
  expect(result.text).toMatch(/Aucun traitement/u);
  expect(result.presentation).toBeUndefined();
});

it('says that a record too long to read whole is partial, instead of presenting it as complete', async () => {
  clinical.buildClinicalContext.mockResolvedValue({ ...context(), coverage: { requested: 100, returned: 100, complete: false, hasMore: true } });
  const result = await run('Résume le dossier du patient sélectionné.');
  expect(result.status).toBe('partial');
  expect(result.complete).toBe(false);
});
