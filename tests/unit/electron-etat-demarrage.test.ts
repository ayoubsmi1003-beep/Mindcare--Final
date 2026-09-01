/**
 * La machine à états de démarrage Electron (§H du plan) — chaque transition,
 * et chaque bord d'échec, y compris le budget de reprise borné à 1 essai.
 */
import { describe, expect, it } from "vitest";

import {
  BUDGET_RECUPERATION,
  etatInitial,
  reduire,
  type EtatMachine,
} from "../../electron/main/etat-demarrage";

function joue(evenements: Parameters<typeof reduire>[1][]): EtatMachine {
  return evenements.reduce(reduire, etatInitial());
}

describe("machine à états de démarrage", () => {
  it("chemin nominal complet, cluster déjà présent", () => {
    const m = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_PRESENT" },
      { type: "SERVICE_DEMARRE" },
      { type: "BASE_JOIGNABLE" },
      { type: "MIGRATIONS_A_JOUR" },
      { type: "BACKEND_DEMARRE" },
      { type: "SANTE_OK" },
      { type: "SANTE_OK" },
    ]);
    expect(m.etat).toBe("READY");
    expect(m.tentativesRecuperation).toBe(0);
  });

  it("premier lancement : cluster absent → initialisation avant démarrage", () => {
    const m = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_ABSENT" },
      { type: "CLUSTER_INITIALISE" },
      { type: "SERVICE_DEMARRE" },
      { type: "BASE_JOIGNABLE" },
      { type: "MIGRATIONS_A_JOUR" },
      { type: "BACKEND_DEMARRE" },
      { type: "SANTE_OK" },
      { type: "SANTE_OK" },
    ]);
    expect(m.etat).toBe("READY");
  });

  it("runtime PostgreSQL absent → échec terminal immédiat, pas de reprise", () => {
    const m = joue([{ type: "RUNTIME_PRESENT" }, { type: "RUNTIME_ABSENT", detail: "introuvable" }]);
    expect(m).toEqual({ etat: "FAILED", tentativesRecuperation: 0, cause: "runtime-absent", detail: "introuvable" });
  });

  it("version de cluster incompatible → échec terminal, pas de reprise", () => {
    const m = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_VERSION_INCOMPATIBLE", detail: "PG_VERSION=16, attendu 15" },
    ]);
    expect(m.etat).toBe("FAILED");
    expect(m.cause).toBe("version-cluster-incompatible");
  });

  it("port occupé → échec terminal, pas de reprise (comportement de garde-origine.mjs)", () => {
    const m = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_PRESENT" },
      { type: "PORT_OCCUPE", detail: "43117" },
    ]);
    expect(m).toEqual({ etat: "FAILED", tentativesRecuperation: 0, cause: "port-occupe", detail: "43117" });
  });

  it("migration manquante sur disque → échec terminal (jamais de reprise silencieuse)", () => {
    const m = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_PRESENT" },
      { type: "SERVICE_DEMARRE" },
      { type: "BASE_JOIGNABLE" },
      { type: "MIGRATIONS_MANQUANTES", detail: "083" },
    ]);
    expect(m.etat).toBe("FAILED");
    expect(m.cause).toBe("migration-manquante");
  });

  it("base injoignable : une reprise bornée, puis échec terminal", () => {
    const m1 = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_PRESENT" },
      { type: "SERVICE_DEMARRE" },
      { type: "BASE_INJOIGNABLE", detail: "ECONNREFUSED" },
    ]);
    expect(m1.etat).toBe("RECOVERY");
    expect(m1.tentativesRecuperation).toBe(1);
    expect(m1.tentativesRecuperation).toBe(BUDGET_RECUPERATION);

    const m2 = [
      { type: "REESSAYER" as const },
      { type: "RUNTIME_PRESENT" as const },
      { type: "CLUSTER_PRESENT" as const },
      { type: "SERVICE_DEMARRE" as const },
      { type: "BASE_INJOIGNABLE" as const, detail: "ECONNREFUSED" },
    ].reduce(reduire, m1);
    expect(m2.etat).toBe("FAILED");
    expect(m2.cause).toBe("base-injoignable");
    expect(m2.tentativesRecuperation).toBe(1);
  });

  it("plantage du backend après READY → reprise puis rétablissement", () => {
    const pret = joue([
      { type: "RUNTIME_PRESENT" },
      { type: "CLUSTER_PRESENT" },
      { type: "SERVICE_DEMARRE" },
      { type: "BASE_JOIGNABLE" },
      { type: "MIGRATIONS_A_JOUR" },
      { type: "BACKEND_DEMARRE" },
      { type: "SANTE_OK" },
      { type: "SANTE_OK" },
    ]);
    const apresCrash = reduire(pret, { type: "BACKEND_CRASH", detail: "SIGSEGV" });
    expect(apresCrash.etat).toBe("RECOVERY");
    expect(apresCrash.tentativesRecuperation).toBe(1);

    const retabli = [
      { type: "REESSAYER" as const },
      { type: "RUNTIME_PRESENT" as const },
      { type: "CLUSTER_PRESENT" as const },
      { type: "SERVICE_DEMARRE" as const },
      { type: "BASE_JOIGNABLE" as const },
      { type: "MIGRATIONS_A_JOUR" as const },
      { type: "BACKEND_DEMARRE" as const },
      { type: "SANTE_OK" as const },
      { type: "SANTE_OK" as const },
    ].reduce(reduire, apresCrash);
    expect(retabli.etat).toBe("READY");
    // La cause de l'échec précédent ne doit pas survivre à un rétablissement.
    expect(retabli.cause).toBeUndefined();
  });

  it("état FAILED est terminal : aucun événement n'en sort", () => {
    const echoue = joue([{ type: "RUNTIME_PRESENT" }, { type: "RUNTIME_ABSENT" }]);
    const apres = reduire(echoue, { type: "REESSAYER" });
    expect(apres).toBe(echoue);
  });

  it("événement hors séquence est ignoré sans muter l'état", () => {
    const m = etatInitial();
    const apres = reduire(m, { type: "SANTE_OK" });
    expect(apres).toBe(m);
  });
});
