import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validerOrigineCabinet, chargerConnexionCabinet } from "../../electron/main/connexion-cabinet";

describe("clinic client configuration", () => {
  it.each(["https://doctor-pc:43118", "https://doctor-pc.lan:43118", "https://192.168.1.20:43118", "https://10.0.1.2", "https://localhost:44318"])("accepts clinic endpoint %s", origin => {
    expect(validerOrigineCabinet(origin)).toBe(new URL(origin).origin);
  });
  it.each(["http://192.168.1.20:43118", "https://example.com", "https://8.8.8.8", "https://user:secret@doctor-pc", "https://doctor-pc/connexion", "https://doctor-pc?x=1", "https://doctor-pc#x", "https://doctor-pc/../", "https://doctor-pc\\evil"])("refuses unsafe endpoint %s", origin => {
    expect(() => validerOrigineCabinet(origin)).toThrow();
  });
  it("a client artifact with absent configuration cannot initialize its own database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-client-config-"));
    try {
      expect(() => chargerConnexionCabinet(path.join(dir, "absent.json"), "clinic-client")).toThrow(/CONFIGURATION/);
      expect(chargerConnexionCabinet(path.join(dir, "absent.json"), "standalone")).toEqual({ mode: "standalone" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("invalid existing config never silently falls back to standalone", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-client-config-"));
    const file = path.join(dir, "desktop.json");
    try {
      for (const config of ["{}", "not-json", JSON.stringify({ version: 1, mode: "standalone" }), JSON.stringify({ version: 1, mode: "client", origin: "http://doctor-pc" })]) {
        writeFileSync(file, config);
        expect(() => chargerConnexionCabinet(file, "clinic-client")).toThrow();
      }
      writeFileSync(file, JSON.stringify({ version: 1, mode: "client", origin: "https://doctor-pc:43118" }));
      expect(chargerConnexionCabinet(file, "clinic-client")).toEqual({ mode: "client", origin: "https://doctor-pc:43118" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("the Doctor host artifact also requires explicit host configuration", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mindcare-host-config-"));
    const file = path.join(dir, "desktop.json");
    try {
      expect(() => chargerConnexionCabinet(file, "clinic-host")).toThrow(/CONFIGURATION/);
      writeFileSync(file, JSON.stringify({ version: 1, mode: "client", origin: "https://doctor-pc:43118" }));
      expect(() => chargerConnexionCabinet(file, "clinic-host")).toThrow();
      writeFileSync(file, JSON.stringify({ version: 1, mode: "host", origin: "https://doctor-pc:43118" }));
      expect(chargerConnexionCabinet(file, "clinic-host")).toEqual({ mode: "host", origin: "https://doctor-pc:43118" });
      expect(chargerConnexionCabinet(file, "clinic-client")).toEqual({ mode: "client", origin: "https://doctor-pc:43118" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
