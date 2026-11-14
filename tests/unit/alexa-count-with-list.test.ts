import { expect, it, vi } from 'vitest';
import { agentExecutor } from '@/server/alexa/agent-tools';

const asOf = '2026-11-14T12:00:00.000Z';
const condition = { field: 'identity_card', op: 'missing', value: null };
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, first_name: `Prénom${i}`, last_name: `Nom${i}`, missing: ['identity_card'], completed_consultations: null, outstanding_balance: null }));
}
async function count(total: number) {
  const page = rows(Math.min(total, 20));
  const rpc = vi.fn().mockResolvedValue({ ok: true, data: [{ total, rows: page, metrics: {}, unknownAge: 0, revision: 'a'.repeat(32), asOf, conditions: [condition], complete: true, offset: 0 }] });
  const execute = agentExecutor({ text: 'Combien de dossiers actifs sont sans CNI ?', conversationId: `count-list-${total}`, clientTurnId: crypto.randomUUID(), appContext: { patientId: null, page: '/jarvis' } }, { rpc }, { rpc: vi.fn() });
  const result = await execute({ id: 'count', name: 'query_patients', args: { partIds: ['count'], mode: 'count', filters: [condition], population: 'active' } }, asOf, [], new AbortController().signal);
  return { result, spec: JSON.parse(rpc.mock.calls[0]![1].p_spec), page };
}

it('answers a filtered count with the count, then every patient of the first page', async () => {
  const { result, spec, page } = await count(3);
  expect(spec).toMatchObject({ mode: 'list', offset: 0 });
  expect(result.text).toMatch(/^Parmi les patients actifs de votre périmètre, 3 n’ont pas de numéro de carte d’identité renseigné\. Les voici :/u);
  for (const p of page) expect(result.text).toContain(`${p.first_name} ${p.last_name}`);
});
it('says a zero count without a list', async () => {
  const { result } = await count(0);
  expect(result.text).toBe('Parmi les patients actifs de votre périmètre, aucun n’a de numéro de carte d’identité manquant.');
  expect(result.status).toBe('empty');
});
it('names the single patient of a count of one', async () => {
  const { result } = await count(1);
  expect(result.text).toContain('1 n’a pas de numéro de carte d’identité renseigné. Il s’agit de :');
  expect(result.text).toContain('Prénom0 Nom0');
});
it('shows the first twenty of 57 with the exact total and a next page the follow-up can read', async () => {
  const { result } = await count(57);
  expect(result.text).toContain('57 n’ont pas');
  expect(result.text).toContain('Voici les 20 premiers :');
  expect(result.text).toContain('Prénom19 Nom19');
  expect(result.text).toMatch(/Affichage des patients 1 à 20 sur 57\. La suite est disponible/u);
  expect(result.data).toMatchObject({ total: 57, hasMore: true, patientQuery: { mode: 'list' } });
});
