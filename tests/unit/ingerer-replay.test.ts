/**
 * M09 slice 2 — Generateur SQL d'ingest (hors-ligne, sans base).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * Emission d'un SQL d'ingest borne pour un rapport VERT (BEGIN/COMMIT,
 * cabinet, run + cas), refus d'un cabinet malforme, refus d'un rapport
 * falsifie (verdict), usage exigeant --cabinet. Aucune connexion.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'application SQL (operateur superuser supervise), la RLS (eprouvee
 * contre la base locale : voir rapport M09 slice 2), la qualite live.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Racine du depot : deux niveaux au-dessus de tests/unit.
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const M09 = "m09-replay-v1";
const SHA = "a".repeat(64);

function rapportMinimal(verdict: string = "PASS"): Record<string, unknown> {
  return {
    mission: "M09",
    kind: "simulate",
    replay: true,
    live: false,
    gate_version: M09,
    verdict_rule: "r",
    git_revision: "abc1234-dirty",
    timestamp: "2026-09-16T00:00:00.000Z",
    duree_s: 7,
    verdict,
    suites: [
      {
        nom: "eval-test", statut: verdict === "FAIL" ? "FAIL" : "PASS",
        pass_count: verdict === "FAIL" ? 0 : 2, fail_count: verdict === "FAIL" ? 1 : 0, not_run_count: 0,
        cles_vertes: verdict === "FAIL" ? [] : ["k1", "k2"], cles_rouges: verdict === "FAIL" ? ["k1"] : [],
        not_run_reason: null, required_environment: null, latence_ms: 3, detail: null,
      },
    ],
    totaux: {
      suites: 1, PASS: verdict === "FAIL" ? 0 : 2, FAIL: verdict === "FAIL" ? 1 : 0,
      "NOT RUN": 0, cas: 1, cas_non_mappes: 0,
    },
    cas: [{ famille: "intentions", id: "M01-01", empreinte: SHA, verdict: "PASS" }],
    provenance: {
      goldens_hash: SHA, schema_version: "m08-schema-v1", prompts_hash: "p",
      prompts_versions: [], fichiers_goldens: [],
    },
    not_run_reasons: [],
    comparaison: null,
  };
}

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "m09-ingerer-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function generer(rapport: unknown, argsExtra: string[] = []): { code: number; out: string } {
  const f = join(dir, `rapport-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof rapport === "string" ? rapport : JSON.stringify(rapport));
  try {
    const out = execFileSync(process.execPath, [join(RACINE, "scripts/ingerer-replay.mjs"), f, ...argsExtra], {
      cwd: RACINE,
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: unknown; stderr?: unknown; stdout?: unknown };
    return { code: typeof err.status === "number" ? err.status : 1, out: String(err.stderr ?? err.stdout ?? "") };
  }
}

const CABINET = "00000000-0000-0000-0000-000000000001";

describe("ingerer-replay", () => {
  it("emet un SQL borne pour un rapport VERT", () => {
    const r = generer(rapportMinimal(), [`--cabinet=${CABINET}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("BEGIN;");
    expect(r.out).toContain("COMMIT;");
    expect(r.out).toContain(CABINET);
    expect(r.out).toContain("INSERT INTO app.ai_replay_runs");
    expect(r.out).toContain("INSERT INTO app.ai_replay_cases");
    expect(r.out).toContain("M01-01");
  });

  it("refuse un cabinet malforme", () => {
    expect(generer(rapportMinimal(), ["--cabinet=pas-un-uuid"]).code).toBe(1);
  });

  it("refuse sans --cabinet", () => {
    expect(generer(rapportMinimal(), []).code).toBe(2);
  });

  it("refuse un rapport falsifie (verdict incoherent)", () => {
    const doc = rapportMinimal();
    doc.verdict = "PEUT-ETRE";
    expect(generer(doc, [`--cabinet=${CABINET}`]).code).toBe(1);
  });

  it("refuse un rapport au schema invalide", () => {
    expect(generer({ mission: "M09" }, [`--cabinet=${CABINET}`]).code).toBe(1);
  });
});
