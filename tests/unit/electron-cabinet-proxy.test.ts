import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { request, type Server as SecureServer } from "node:https";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { demarrerProxyCabinet } from "../../electron/main/proxy-cabinet";

const certDir = process.env.MINDCARE_TEST_TLS_DIR;
let testDir: string;
let ca: string;
let pfx: Buffer;

describe.skipIf(process.platform !== "win32" && !certDir)("clinic HTTPS transport (real sockets, no clinical data)", () => {
  let backend: Server;
  let proxy: SecureServer;
  let origin: string;
  let lastHeaders: IncomingMessage["headers"] = {};
  let upstreamClosed = false;
  let upstreamWasClosed = false;
  beforeAll(async () => {
    testDir = certDir ?? mkdtempSync(path.join(tmpdir(), "mindcare-tls-"));
    if (!certDir) {
      // In-memory .NET certificate; no certificate or trust store is modified.
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
        $ErrorActionPreference = 'Stop'; $certificate = $null; $rsa = [System.Security.Cryptography.RSACng]::new(2048)
        try {
          $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
          $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddDnsName('localhost'); $request.CertificateExtensions.Add($san.Build())
          $certificate = $request.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddDays(1))
          [IO.File]::WriteAllBytes((Join-Path $env:MINDCARE_TEST_TMP 'transport-test.pfx'), $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, 'isolated-transport-test-only'))
          [IO.File]::WriteAllBytes((Join-Path $env:MINDCARE_TEST_TMP 'transport-test.cer'), $certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        } finally { if ($null -ne $certificate) { $certificate.Dispose() }; $rsa.Dispose() }
      `], { env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules"), MINDCARE_TEST_TMP: testDir }, windowsHide: true, timeout: 15_000, stdio: "pipe" });
    }
    pfx = readFileSync(path.join(testDir, "transport-test.pfx"));
    ca = new X509Certificate(readFileSync(path.join(testDir, "transport-test.cer"))).toString();
    backend = createServer((req, res) => {
      lastHeaders = req.headers;
      if (req.url === "/api/health") { res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}'); return; }
      if (req.url === "/stream") {
        req.on("close", () => { upstreamClosed = true; });
        res.setHeader("Content-Type", "text/event-stream"); res.write("data: first\n\n");
        const timer = setTimeout(() => res.end("data: second\n\n"), 250);
        res.on("close", () => clearTimeout(timer)); return;
      }
      let body = "";
      req.on("data", chunk => { body += String(chunk); });
      req.on("end", () => { res.setHeader("Set-Cookie", ["session=test-only; Secure; HttpOnly; SameSite=Lax"]); res.end(body); });
    });
    await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
    const address = backend.address();
    if (!address || typeof address === "string") throw new Error("backend address");
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const portAddress = probe.address();
    if (!portAddress || typeof portAddress === "string") throw new Error("port address");
    origin = `https://localhost:${portAddress.port}`;
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    proxy = await demarrerProxyCabinet({ origin, pfx, passphrase: "isolated-transport-test-only", upstreamPort: address.port });
  }, 20_000);
  afterAll(async () => {
    proxy?.closeAllConnections();
    if (proxy?.listening) await new Promise<void>(resolve => proxy.close(() => resolve()));
    if (!upstreamWasClosed && backend?.listening) await new Promise<void>(resolve => backend.close(() => resolve()));
    if (!certDir && testDir) rmSync(testDir, { recursive: true, force: true });
  });
  const call = (route: string, options: { trusted?: boolean; method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; body: string; headers: IncomingMessage["headers"] }>((resolve, reject) => {
    const req = request(origin + route, { ca: options.trusted === false ? undefined : ca, family: 4, servername: "localhost", method: options.method ?? "GET", headers: options.headers }, res => {
      let body = ""; res.on("data", chunk => { body += String(chunk); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      res.on("error", reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error("test timeout"))); req.on("error", reject); req.end(options.body);
  });
  it("rejects an untrusted certificate using normal TLS checks", async () => {
    await expect(call("/api/health", { trusted: false })).rejects.toThrow(/certificate|self.signed/i);
  });
  it("serves health only through a trusted clinic certificate", async () => {
    expect(await call("/api/health")).toMatchObject({ status: 200, body: '{"ok":true}' });
  });
  it("still rejects an incorrect TLS hostname with the trusted certificate", async () => {
    await expect(new Promise((resolve, reject) => {
      request(origin + "/api/health", { ca, family: 4, servername: "wrong.clinic.lan" }, resolve).on("error", reject).end();
    })).rejects.toThrow(/altnames|hostname/i);
  });
  it("rejects a wrong Host and a foreign browser Origin", async () => {
    expect((await call("/api/health", { headers: { Host: "attacker.example" } })).status).toBe(421);
    expect((await call("/api/health", { headers: { Origin: "https://attacker.example" } })).status).toBe(403);
  });
  it("requires the clinic Origin on state-changing requests", async () => {
    expect((await call("/echo", { method: "POST", body: "test-only" })).status).toBe(403);
  });
  it("streams request bodies and secure cookies and replaces spoofed forwarding headers", async () => {
    const response = await call("/echo", { method: "POST", body: "transport-test-only", headers: { Origin: origin, "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "http", "X-Forwarded-For": "8.8.8.8" } });
    expect(response).toMatchObject({ status: 200, body: "transport-test-only" });
    expect(response.headers["set-cookie"]).toEqual(["session=test-only; Secure; HttpOnly; SameSite=Lax"]);
    expect(lastHeaders).toMatchObject({ host: new URL(origin).host, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" });
  });
  it("delivers the first SSE chunk before the response finishes", async () => {
    const result = await new Promise<{ firstBeforeEnd: boolean; body: string }>((resolve, reject) => {
      request(origin + "/stream", { ca, family: 4 }, res => {
        let body = ""; let firstBeforeEnd = false;
        res.on("data", chunk => { body += String(chunk); if (body === "data: first\n\n") firstBeforeEnd = true; });
        res.on("end", () => resolve({ firstBeforeEnd, body })); res.on("error", reject);
      }).on("error", reject).end();
    });
    expect(result).toEqual({ firstBeforeEnd: true, body: "data: first\n\ndata: second\n\n" });
  });
  it("closes the upstream stream when the client disconnects", async () => {
    upstreamClosed = false;
    await new Promise<void>((resolve, reject) => {
      const req = request(origin + "/stream", { ca, family: 4 }, res => { res.once("data", () => { res.destroy(); req.destroy(); resolve(); }); });
      req.on("error", reject); req.end();
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(upstreamClosed).toBe(true);
  });
  it("fails closed when the fixed upstream is unavailable", async () => {
    backend.closeAllConnections();
    await new Promise<void>(resolve => backend.close(() => resolve())); upstreamWasClosed = true;
    const response = await call("/api/health");
    expect(response).toMatchObject({ status: 503 });
    expect(response.body).not.toMatch(/127\.0\.0\.1|password|stack|ECONNREFUSED/i);
  });
});
