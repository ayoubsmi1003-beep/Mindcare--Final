import { expect, it } from 'vitest';
import { LocalModelSlot } from '@/server/alexa/local-model-slot';

it('waits for a summary to release the inference slot before starting chat', async () => {
  const slot = new LocalModelSlot(), signal = new AbortController().signal;
  const summaryDone = await slot.acquire(signal);
  let chatStarted = false;
  const chat = slot.acquire(signal).then(release => { chatStarted = true; return release; });
  await Promise.resolve(); expect(chatStarted).toBe(false);
  summaryDone(); const chatDone = await chat;
  expect(chatStarted).toBe(true);
  summaryDone();
  let thirdStarted = false;
  const third = slot.acquire(signal).then(release => { thirdStarted = true; return release; });
  await Promise.resolve(); expect(thirdStarted).toBe(false);
  chatDone(); (await third)();
});

it('removes a cancelled request without blocking the next waiting request', async () => {
  const slot = new LocalModelSlot(), signal = new AbortController().signal;
  const release = await slot.acquire(signal), cancelled = new AbortController();
  const waiting = slot.acquire(cancelled.signal);
  cancelled.abort(new Error('Cancelled'));
  await expect(waiting).rejects.toThrow('Cancelled');
  const next = slot.acquire(signal);
  release(); (await next)();
  (await slot.acquire(signal))();
});
