import { expect, it, vi } from 'vitest';
import { runAlexa } from '@/server/alexa/orchestrator';
import type { AlexaEvent } from '@/shared/alexa/turn';
import type { ClientSql } from '@/server/jarvis/client-sql';

vi.mock('@/server/alexa/action-proposal', () => ({
  deterministicActionRequest: (text: string) => text.startsWith('Prépare un rendez-vous') || text.startsWith('Imprime'),
  prepareActionProposal: async (input: { text: string }) => input.text.startsWith('Imprime') ? ({
    state: 'print', patientId: '22222222-2222-4222-8222-222222222222',
    documentId: '44444444-4444-4444-8444-444444444444', label: 'Ordonnance DOC-2026-00072',
  }) : ({
    state: 'ready',
    proposal: { tool: 'create_appointment', args: { patientId: '22222222-2222-4222-8222-222222222222', startsAt: '2026-10-27T10:00:00+01:00', durationMinutes: 45 } },
    patientId: '22222222-2222-4222-8222-222222222222',
  }),
}));

it('marks a prepared action as awaiting human confirmation without executing it', async () => {
  const events: AlexaEvent[] = [];
  const knowledge: ClientSql = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
  await runAlexa({
    text: 'Prépare un rendez-vous demain à 10 h 00 pendant 45 minutes pour le patient sélectionné.',
    conversationId: 'action-terminal-test',
    clientTurnId: '11111111-1111-4111-8111-111111111111',
    appContext: { patientId: '22222222-2222-4222-8222-222222222222', page: '/jarvis' },
  }, {
    native: true, actor: 'action-terminal-test', knowledge,
    db: { rpc: async () => { throw Error('Preparing a proposal must not execute it'); } },
  }, event => events.push(event), new AbortController().signal);

  expect(events.some(event => event.type === 'proposal' && event.tool === 'create_appointment')).toBe(true);
  expect([...events].reverse().find(event => event.type === 'done')).toMatchObject({ status: 'needs_confirmation', limited: false });
});

it('keeps the resolved patient on the exact document print navigation', async () => {
  const patientId = '22222222-2222-4222-8222-222222222222';
  const documentId = '44444444-4444-4444-8444-444444444444';
  const events: AlexaEvent[] = [];
  const knowledge: ClientSql = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
  await runAlexa({
    text: 'Imprime l’ordonnance de Nadia Test.',
    conversationId: 'action-terminal-print-test',
    clientTurnId: '33333333-3333-4333-8333-333333333333',
    appContext: { patientId, page: '/jarvis' },
  }, {
    native: true, actor: 'action-terminal-print-test', knowledge,
    db: { rpc: async () => { throw Error('Print preparation must stay read-only'); } },
  }, event => events.push(event), new AbortController().signal);

  expect([...events].reverse().find(event => event.type === 'done')).toMatchObject({
    type: 'done', status: 'completed', patientId, patientScope: 'replace',
    navigation: { target: 'document', patientId, documentId, print: true },
  });
});
