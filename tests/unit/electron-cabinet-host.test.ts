import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chargerServeurCabinet, lireVariablesServeur, descelerSecretTls } from "../../electron/main/serveur-cabinet";

describe("protected clinic host configuration", () => {
  it("loads only an explicit versioned host origin and an absolute resource path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-host-"));
    const file = path.join(dir, "MindCare", "private", "clinic-server.json");
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      const valid = { version: 1, origin: "https://doctor-pc:43118", resourcesDir: path.join(dir, "resources") };
      writeFileSync(file, JSON.stringify(valid));
      expect(chargerServeurCabinet(file)).toMatchObject({ origin: valid.origin, resourcesDir: valid.resourcesDir, racineDonnees: path.join(dir, "MindCare") });
      for (const config of [{ ...valid, version: 2 }, { ...valid, origin: "http://doctor-pc" }, { ...valid, resourcesDir: "relative" }, { ...valid, databaseUrl: "do-not-print-test-value" }]) {
        writeFileSync(file, JSON.stringify(config)); expect(() => chargerServeurCabinet(file)).toThrow(/CONFIGURATION/);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("loads recognized server-only optional configuration and rejects process or database overrides", () => {
    expect(lireVariablesServeur('\uFEFF# example\nALEXA_HMAC_KEY="test-only"\nSTT_MODEL=local\r\n')).toEqual({ ALEXA_HMAC_KEY: "test-only", STT_MODEL: "local" });
    // Les deux seules variables qui peuvent activer la recherche vectorielle
    // des livres sont admises dans le fichier protégé ; rien d'autre.
    expect(lireVariablesServeur("KNOWLEDGE_VECTOR=1\nKNOWLEDGE_VECTOR_RECETTE=e5-base"))
      .toEqual({ KNOWLEDGE_VECTOR: "1", KNOWLEDGE_VECTOR_RECETTE: "e5-base" });
    for (const name of ["NODE_OPTIONS", "MC_HTTPS", "MINDCARE_START_URL", "MINDCARE_DATABASE_URL", "NEXT_PUBLIC_GEMINI_API_KEY", "UNKNOWN"]) {
      expect(() => lireVariablesServeur(`${name}=do-not-print-test-value`)).toThrow(/CONFIGURATION/);
    }
    expect(() => lireVariablesServeur("GEMINI_API_KEY=first\nGEMINI_API_KEY=second")).toThrow();
    try { lireVariablesServeur("UNKNOWN=do-not-print-test-value"); } catch (error) { expect(String(error)).not.toContain("do-not-print-test-value"); }
  });
  it.skipIf(process.platform !== "win32")("decrypts a real machine-scoped DPAPI TLS secret and refuses corrupt ciphertext", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-dpapi-"));
    const file = path.join(dir, "clinic-pfx-password.dpapi");
    try {
      execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Security; [IO.File]::WriteAllBytes($env:MINDCARE_TEST_TLS_SECRET, [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('test-secret-only'), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))"], { env: { ...process.env, MINDCARE_TEST_TLS_SECRET: file }, windowsHide: true, timeout: 10_000 });
      expect(await descelerSecretTls(file)).toBe("test-secret-only");
      writeFileSync(file, "invalid");
      await expect(descelerSecretTls(file)).rejects.toThrow(/CERTIFICAT_CABINET/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

it("admits the native Alexa feature switch in protected server configuration",()=>{
 for(const value of ["1","0"])expect(lireVariablesServeur("ALEXA_NATIVE_AGENT_ENABLED="+value)).toEqual({ALEXA_NATIVE_AGENT_ENABLED:value});
});
