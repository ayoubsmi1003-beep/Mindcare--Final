/**
 * Audit Alexa/Jarvis Slice 1 (§15/§36) — les jalons du tour.
 *
 * `dernierDiagnostic()` répond à « Pourquoi Alexa n'a-t-elle pas répondu ? »
 * sans ouvrir un fichier : chemin, tiroir, durées par étape, TTFT. Ce test
 * fige deux propriétés :
 * 1. l'absence d'une étape EST le diagnostic (null, jamais 0 — 0 voudrait
 *    dire « instantané », ce qui serait un mensonge) ;
 * 2. rien d'identifiant ne peut en sortir (nombres et codes fermés seuls).
 */

import { describe, expect, it } from "vitest";

import {
  consignerMesure,
  dernierDiagnostic,
  exporterMesures,
  reinitialiserMesures,
} from "@/services/jarvis-mesures";

describe("jalons §15/§36 — dernierDiagnostic", () => {
  it("tour complet : session, premier événement, TTFT, total", () => {
    reinitialiserMesures();
    consignerMesure({
      msTotal: 3200,
      nbAppels: 2,
      chemin: "patient",
      code: "OK",
      msSession: 120,
      msPremierEvenement: 900,
      msPremierDelta: 1400,
    });
    const d = dernierDiagnostic();
    expect(d).not.toBeNull();
    expect(d?.chemin).toBe("patient");
    expect(d?.code).toBe("OK");
    expect(d?.msTotal).toBe(3200);
    expect(d?.msSession).toBe(120);
    expect(d?.msPremierEvenement).toBe(900);
    expect(d?.ttftMs).toBe(1400);
    expect(d?.nbAppels).toBe(2);
  });

  it("échec avant tout événement : null, jamais 0", () => {
    reinitialiserMesures();
    consignerMesure({ msTotal: 15000, nbAppels: 0, chemin: "inconnu", code: "MODEL_TIMEOUT" });
    const d = dernierDiagnostic();
    expect(d?.ttftMs).toBeNull();
    expect(d?.msSession).toBeNull();
    expect(d?.msPremierEvenement).toBeNull();
  });

  it("événement sans delta : le TTFT retombe sur le premier événement", () => {
    reinitialiserMesures();
    consignerMesure({
      msTotal: 2000,
      nbAppels: 0,
      chemin: "connaissance",
      code: "OK",
      msSession: 80,
      msPremierEvenement: 700,
    });
    expect(dernierDiagnostic()?.ttftMs).toBe(700);
  });

  it("anneau vide : pas de diagnostic", () => {
    reinitialiserMesures();
    expect(dernierDiagnostic()).toBeNull();
  });

  it("le diagnostic ne porte que des nombres et des codes fermés", () => {
    reinitialiserMesures();
    consignerMesure({
      msTotal: 100,
      nbAppels: 1,
      chemin: "patient",
      code: "OK",
      msSession: 10,
      msPremierEvenement: 20,
      msPremierDelta: 30,
    });
    const d = dernierDiagnostic();
    const serialise = JSON.stringify(d);
    // Aucun champ texte libre, aucun nom, aucun identifiant.
    expect(Object.keys(d ?? {}).sort()).toEqual(
      ["chemin", "code", "msPremierEvenement", "msSession", "msTotal", "nbAppels", "ttftMs"].sort(),
    );
    expect(serialise).not.toContain("patient-");
    expect(exporterMesures().durees.n).toBe(1);
    reinitialiserMesures();
  });
});
