import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { verifierCertificatCabinet } from '../../electron/main/confiance-cabinet';
let certificate: string;
beforeAll(() => {
  if (process.platform !== 'win32') return;
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-cert-'));
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$rsa=[Security.Cryptography.RSACng]::new(2048); $req=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1); $san=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddDnsName('localhost'); $req.CertificateExtensions.Add($san.Build()); $cert=$req.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5),[DateTimeOffset]::Now.AddDays(1)); [IO.File]::WriteAllBytes($env:MC_CERT_TEST,$cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)); $cert.Dispose(); $rsa.Dispose()"], {env:{...process.env, MC_CERT_TEST:path.join(dir,'cert.cer')}, windowsHide:true});
    certificate = new X509Certificate(readFileSync(path.join(dir,'cert.cer'))).toString();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
describe.skipIf(process.platform !== 'win32')('explicit clinic trust never replaces normal TLS validation', () => {
  it('validates the exact certificate and hostname', () => {
    expect(verifierCertificatCabinet(certificate,'https://localhost:43118',certificate)).toBe(true);
    expect(verifierCertificatCabinet(certificate,'https://another-pc:43118',certificate)).toBe(false);
    expect(verifierCertificatCabinet(certificate,'https://localhost:43118','untrusted')).toBe(false);
    expect(verifierCertificatCabinet(certificate,'https://localhost:43118',certificate,Date.now()+3*86400000)).toBe(false);
  });
});
