/**
 * M07 R3-P3 — transport socket : routage -c/-f, nettoyage, parsing.
 * Exécuteur injecté (zéro docker dans les tests).
 */
import { describe, expect, it, vi } from "vitest";

import { execSocket, lignesSocket } from "../../scripts/transport-socket.mjs";

type AppelSocket = [unknown, string[], ...unknown[]];

function fauxExec(success = "ok\n") {
  const appels: AppelSocket[] = [];
  const fn = (...args: AppelSocket) => {
    appels.push(args);
    return success;
  };
  return { appels, fn };
}

describe("execSocket : petit = -c, volumineux = fichier + nettoyage", () => {
  it("petit script → docker exec -c (aucun fichier)", () => {
    const { appels, fn } = fauxExec();
    const sortie = execSocket("RACINE", "SELECT 1;", { executer: fn });
    expect(sortie).toBe("ok\n");
    expect(appels).toHaveLength(1);
    expect(appels[0]![1]).toContain("-c");
    expect(appels[0]![1]).not.toContain("cp");
  });

  it("gros script → cp + -f + rm (ordre + nettoyage)", () => {
    const { appels, fn } = fauxExec("id1\nid2\n");
    execSocket("RACINE", `SELECT '${"x".repeat(9000)}';`, {
      executer: fn,
      fichierHost: "C:\\Users\\ABCINF~1\\AppData\\Local\\Temp\\opencode\\test-lot.sql",
    });
    const ops = appels.map((a) => a[1][0]);
    expect(ops).toEqual(["cp", "exec", "exec"]);
    expect(appels[1]![1]).toContain("-f");
    expect(appels[2]![1]).toContain("rm");
  });

  it("chemins temporaires surchargeables (namespacement inter-sessions G1-A)", () => {
    const { appels, fn } = fauxExec("id1\n");
    execSocket("RACINE", `SELECT '${"x".repeat(9000)}';`, {
      executer: fn,
      fichierHost: "C:\\Users\\ABCINF~1\\AppData\\Local\\Temp\\opencode\\test-lot-dsm.sql",
      fichierConteneur: "/tmp/r3-lot-dsm.sql",
    });
    const tout = appels.map((a) => a[1].join(" ")).join("\n");
    expect(tout).toContain("/tmp/r3-lot-dsm.sql");
    expect(tout).not.toContain("/tmp/r3-lot.sql ");
  });

  it("échec psql → rm quand même (finally), erreur propagée", () => {
    const { appels, fn } = fauxExec();
    const rate = (...args: AppelSocket) => {
      appels.push(args);
      if (args[1].includes("-f")) throw new Error("psql rate");
      return "";
    };
    expect(() => execSocket("RACINE", `SELECT '${"y".repeat(9000)}';`, {
      executer: rate,
      fichierHost: "C:\\Users\\ABCINF~1\\AppData\\Local\\Temp\\opencode\\test-lot.sql",
    })).toThrow(/psql rate/);
    expect(appels[appels.length - 1]![1]).toContain("rm");
  });
});

describe("lignesSocket : interpolation + découpage lignes", () => {
  it("lie $N puis découpe (vide → [])", () => {
    const { fn } = fauxExec("abcdef12|struct-v1\n12345678|struct-v1.1\n");
    const lignes = lignesSocket("RACINE", { texte: "SELECT $1", params: ["x"] }, { executer: fn });
    expect(lignes).toEqual(["abcdef12|struct-v1", "12345678|struct-v1.1"]);
  });

  it("$N hors borne → throw avant tout exec", () => {
    const { appels, fn } = fauxExec();
    expect(() => lignesSocket("RACINE", { texte: "SELECT $2", params: ["x"] }, { executer: fn })).toThrow(/hors borne/);
    expect(appels).toHaveLength(0);
  });
});
