import { describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from '@/server/alexa/agent-loop';

describe('patient scope clarification', () => {
  it.each(['Montre son dossier.', 'Résume sa dernière consultation.'])(
    'asks which patient before an unanchored patient read: %s', async text => {
      const infer = vi.fn(async () => { throw new Error('MiniCPM should not be needed to ask which patient'); });
      const execute = vi.fn();
      const result = await runAgentLoop({
        text,
        conversationId: 'ambiguous-dossier-read',
        clientTurnId: crypto.randomUUID(),
        appContext: { patientId: null, page: '/jarvis' },
      }, { actor: 'ambiguous-dossier-read', infer, execute }, new AbortController().signal);

      expect(infer).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(result.status).toBe('needs_input');
      expect(result.sentences.join(' ')).toContain('Quel patient souhaitez-vous utiliser ?');
    },
  );

  it.each([
    { text: 'Montre le dossier du patient Nadia Test.', patientId: null },
    { text: 'Montre son dossier.', patientId: '22222222-2222-4222-8222-222222222222' },
  ])('does not ask for identity when the request already names or selects a patient', async ({ text, patientId }) => {
    const infer = vi.fn(async () => { throw new Error('A simple dossier read should use the typed read route'); });
    const execute = vi.fn(async call => ({
      callId: call.id, status: 'ok' as const, complete: true, text: 'Dossier lu.',
      patientId: patientId ?? '22222222-2222-4222-8222-222222222222', evidence: [], conditionKeys: [],
    }));
    const result = await runAgentLoop({
      text,
      conversationId: 'anchored-dossier-read',
      clientTurnId: crypto.randomUUID(),
      appContext: { patientId, page: patientId ? `/patients/${patientId}` : '/jarvis' },
    }, { actor: 'anchored-dossier-read', infer, execute }, new AbortController().signal);

    expect(infer).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'get_patient_context', args: expect.objectContaining(patientId ? { patientId } : { patientName: 'Nadia Test' }),
    }), expect.any(String), expect.any(Array), expect.any(AbortSignal), expect.any(String), expect.any(String));
    expect(result.status).not.toBe('needs_input');
  });

  it('resumes the dossier request when the doctor answers the clarification with a patient name', async () => {
    const actor = 'clarification-follow-up';
    const conversationId = 'clarification-follow-up';
    const context = { patientId: null, page: '/jarvis' };
    const first = await runAgentLoop({
      text: 'Montre son dossier.', conversationId, clientTurnId: crypto.randomUUID(), appContext: context,
    }, { actor, infer: vi.fn(async () => { throw new Error('First turn must ask for identity locally'); }), execute: vi.fn() }, new AbortController().signal);
    const infer = vi.fn(async () => { throw new Error('Named follow-up should resolve through the patient read'); });
    const observed: Record<string, unknown>[] = [];
    await runAgentLoop({
      text: 'Nadia Test', conversationId, clientTurnId: crypto.randomUUID(), appContext: context,
    }, { actor, infer, observeCall: call => observed.push({ name: call.name, args: call.args }), execute: async call => ({
      callId: call.id, status: 'ok', complete: true, text: 'Dossier Nadia Test lu.', patientId: '22222222-2222-4222-8222-222222222222', evidence: [], conditionKeys: [],
    }) }, new AbortController().signal);

    expect(first.status).toBe('needs_input');
    expect(infer).not.toHaveBeenCalled();
    expect(observed).toContainEqual(expect.objectContaining({
      name: 'get_patient_context', args: expect.objectContaining({ patientName: 'Nadia Test' }),
    }));
  });

  it('does not choose a patient when the clarification reply contains alternatives', async () => {
    const actor = 'clarification-alternative-follow-up';
    const conversationId = 'clarification-alternative-follow-up';
    const context = { patientId: null, page: '/jarvis' };
    await runAgentLoop({
      text: 'Montre son dossier.', conversationId, clientTurnId: crypto.randomUUID(), appContext: context,
    }, { actor, infer: vi.fn(async () => { throw new Error('Initial turn must clarify locally'); }), execute: vi.fn() }, new AbortController().signal);
    const infer = vi.fn(async () => { throw new Error('An alternative reply must remain unresolved'); });
    const execute = vi.fn();
    const result = await runAgentLoop({
      text: 'Nadia Test ou Samir Test', conversationId, clientTurnId: crypto.randomUUID(), appContext: context,
    }, { actor, infer, execute }, new AbortController().signal);

    expect(result.status).toBe('needs_input');
    expect(infer).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
