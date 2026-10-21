import { expect, it } from 'vitest';
import { runAlexa } from '@/server/alexa/orchestrator';
import type { AlexaEvent } from '@/shared/alexa/turn';
import type { ClientSql } from '@/server/jarvis/client-sql';

it('answers a desktop greeting without reading the selected patient or waiting for inference', async () => {
  const events: AlexaEvent[] = [];
  const knowledge: ClientSql = { rpc: async <T>() => ({ data: null as T | null, error: null }) };
  await runAlexa({text:'bonjour alexa',conversationId:'desktop-greeting',clientTurnId:'11111111-1111-4111-8111-111111111111',appContext:{patientId:'22222222-2222-4222-8222-222222222222',page:'/patients/22222222-2222-4222-8222-222222222222'}}, {
    native:true, actor:'desktop-greeting', knowledge,
    db:{rpc:async()=>{throw Error('Greeting must not read clinical data');}},
    agentInfer:async()=>{throw Error('Greeting must not call the model');},
  }, event=>events.push(event), new AbortController().signal);
  expect(events.some(e=>e.type==='sentence'&&e.text.startsWith('Bonjour'))).toBe(true);
  expect(events.find(e=>e.type==='done')).toMatchObject({limited:false});
});
