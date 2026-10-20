import { X509Certificate, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { validerOrigineCabinet } from './connexion-cabinet.js';
export function verifierCertificatCabinet(certificate: string, origin: string, expected: string, now = Date.now()): boolean {
  try {
    const cert = new X509Certificate(certificate); const trusted = new X509Certificate(expected);
    const hostname = new URL(validerOrigineCabinet(origin)).hostname.replace(/^\[|\]$/g, '');
    return cert.raw.length === trusted.raw.length && timingSafeEqual(cert.raw, trusted.raw)
      && Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo)
      && cert.verify(cert.publicKey)
      && Boolean(isIP(hostname) ? cert.checkIP(hostname) : cert.checkHost(hostname, { wildcards: false }));
  } catch { return false; }
}
