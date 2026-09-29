/**
 * Kernel Communication — politique, idempotence, file hors-ligne.
 * Pur, sans base : la RLS et les portes portent la sécurité, ici on ne
 * teste que la décision locale (miroir honnête du graphe SQL de 112).
 */
import { describe, expect, it } from "vitest";

import { cleIdempotence } from "../../src/services/communication/idempotence";
import {
  deciderEnvoi,
  transitionLocale,
} from "../../src/services/communication/politique";

describe("idempotence", () => {
  it("rend une clé stable pour la même entrée", () => {
    expect(cleIdempotence("conv-1", "bonjour")).toBe(cleIdempotence("conv-1", "bonjour"));
  });

  it("sépare les conversations et les contenus", () => {
    expect(cleIdempotence("conv-1", "bonjour")).not.toBe(cleIdempotence("conv-2", "bonjour"));
    expect(cleIdempotence("conv-1", "bonjour")).not.toBe(cleIdempotence("conv-1", "bonsoir"));
  });

  it("préfixe l'espace de clés", () => {
    expect(cleIdempotence("conv-1", "x").startsWith("comm:")).toBe(true);
  });
});

describe("graphe de transition local (miroir de 112)", () => {
  it("autorise received → classified et draft → approval_required", () => {
    expect(transitionLocale("received", "classified")).toBe(true);
    expect(transitionLocale("draft", "approval_required")).toBe(true);
  });

  it("refuse les sauts (received → sent, draft → sent)", () => {
    expect(transitionLocale("received", "sent")).toBe(false);
    expect(transitionLocale("draft", "sent")).toBe(false);
  });

  it("refuse toute sortie des états terminaux", () => {
    for (const e of ["read", "failed", "blocked", "expired", "rejected"] as const) {
      expect(transitionLocale(e, "sending")).toBe(false);
    }
  });
});

describe("décision d'envoi", () => {
  it("bloque sans consentement", () => {
    expect(
      deciderEnvoi({ consentement: false, signalPatient: false, connecte: true, horsLigne: false }).decision,
    ).toBe("bloquer");
  });

  it("bloque une charge à signal patient", () => {
    expect(
      deciderEnvoi({ consentement: true, signalPatient: true, connecte: true, horsLigne: false }).decision,
    ).toBe("bloquer");
  });

  it("met en file quand le réseau manque, jamais en succès", () => {
    const d = deciderEnvoi({ consentement: true, signalPatient: false, connecte: false, horsLigne: true });
    expect(d.decision).toBe("file");
    expect(d.etatCible).toBe("queued");
  });

  it("autorise le cas nominal", () => {
    expect(
      deciderEnvoi({ consentement: true, signalPatient: false, connecte: true, horsLigne: false }).decision,
    ).toBe("autoriser");
  });
});
