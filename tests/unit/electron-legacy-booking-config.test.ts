import { describe, expect, it } from 'vitest';
import { lireVariablesServeur } from '../../electron/main/serveur-cabinet';

describe('previous booking configuration', () => {
  it('does not prevent startup or pass unused legacy settings to the server', () => {
    const config = [
      'MINDCARE_BOOKING_ENABLED=1',
      'MINDCARE_BOOKING_EDGE_ORIGIN=https://booking.invalid',
      'MINDCARE_BOOKING_BRIDGE_SECRET=test-value',
      'MINDCARE_BOOKING_IDLE_POLL_MS=1000',
      'ALEXA_LOCAL_VOICE=1',
    ].join('\n');
    expect(lireVariablesServeur(config)).toEqual({ ALEXA_LOCAL_VOICE: '1' });
  });
});
