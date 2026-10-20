import { describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { decouvrirCabinets, annoncerCabinet, appairerCabinet, choisirCabinet, ouvrirInvitation, scellerInvitation } from '../../electron/main/decouverte-cabinet';

const cabinet = { id: '7433fd90-ff35-43df-9b35-187bfa45805e', origin: 'https://doctor-pc:43118' };
describe('clinic discovery and authenticated invitation', () => {
  it('never elects a host or switches to an unrelated clinic after an outage', () => {
    expect(choisirCabinet([], undefined)).toBeUndefined();
    expect(choisirCabinet([cabinet, { ...cabinet, id: '3e2f2ee1-1560-4c6d-b1e9-d83b738b47c0' }], undefined)).toBeUndefined();
    expect(choisirCabinet([cabinet], undefined)).toEqual(cabinet);
    expect(choisirCabinet([cabinet], 'different-clinic')).toBeUndefined();
    expect(choisirCabinet([cabinet], cabinet.id)).toEqual(cabinet);
  });
  it('a forged invitation or modified ciphertext cannot establish trust', () => {
    const secret = randomBytes(18).toString('base64url');
    const encrypted = scellerInvitation(secret, { challenge: 'test', certificate: 'public-only' });
    expect(ouvrirInvitation(secret, encrypted)).toEqual({ challenge: 'test', certificate: 'public-only' });
    expect(() => ouvrirInvitation(randomBytes(18).toString('base64url'), encrypted)).toThrow();
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1;
    expect(() => ouvrirInvitation(secret, encrypted)).toThrow();
  });
  it('discovers a real UDP host and obtains public trust only with its live invitation', async () => {
    const probe = createSocket('udp4'); await new Promise<void>(r => probe.bind(0, '127.0.0.1', r));
    const port = probe.address().port; await new Promise<void>(r => probe.close(r));
    const secret = randomBytes(18).toString('base64url');
    const server = await annoncerCabinet(cabinet, 'public-cert-test', () => ({ secret, expiresAt: Date.now() + 30000 }), port);
    try {
      const found = await decouvrirCabinets(200, port, ['127.0.0.1']);
      expect(found).toEqual([{ ...cabinet, address: '127.0.0.1' }]);
      const trust = await appairerCabinet(found[0]!, secret, port, 500);
      expect(trust).toEqual({ ...cabinet, certificate: 'public-cert-test' });
      await expect(appairerCabinet(found[0]!, randomBytes(18).toString('base64url'), port, 200)).rejects.toThrow();
    } finally { await new Promise<void>(r => server.close(r)); }
  });
});
