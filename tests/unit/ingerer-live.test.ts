/**
 * M09 reliquat LOT3 — validateur + generateur SQL d'ingest live (hors-ligne, sans base).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * Emission d'un SQL d'ingest borne pour un export VERT m09-live-v2
 * (BEGIN/COMMIT, cabinet, runs + calls + proofs, colonne issue, SHA-256
 * derives deterministes), refus d'un cabinet malforme, refus sans
 * --cabinet, refus d'un export falsifie (contrat, cles, issue, UUID brut,
 * incoherence comptes/tableaux), refus d'un export v1 (autre contrat).
 * Aucune connexion.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'application SQL (operateur superuser supervise), la RLS (eprouvee
 * contre la base locale : voir checkpoint-m09-097.sql), la qualite live.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Racine du depot : deux niveaux au-dessus de tests/unit.
const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const V1 = "m09-live-v1";
const V2 = "m09-live-v2";

function tourMinimal(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: V1,
    empreinteRun: "a1b2c3d4",
    horodatage: 1700000000000,
    chemin: "patient",
    interrompu: false,
    persiste: true,
    dureeMs: 100,
    appels: [{ capacite: "agenda", ms: 5, ok: true, deduplique: false }],
    nbAppels: 1,
    preuves: [{ titre: "Guide", section: null, version: "v1" }],
    nbPreuves: 1,
    nbSnapshots: 0,
    propositionInconnue: null,
    resolution: null,
    empreinte: "e5f60718",
    ...surcharge,
  };
}

function exportMinimal(): Record<string, unknown> {
  return {
    mission: "M09",
    kind: "live",
    contrat: V2,
    horodatage: 1700000000000,
    records: [
      {
        v1: tourMinimal(),
        approbation: null,
        outilsFp: [null],
      },
      {
        v1: tourMinimal({
          empreinteRun: "f00ba407",
          empreinte: "deadbeef",
          chemin: "inconnu",
          appels: [],
          nbAppels: 0,
          preuves: [],
          nbPreuves: 0,
          dureeMs: 40,
        }),
        approbation: {
          actionFp: "c001d00d",
          issue: "ok",
          executionFp: "e0ec07ed",
          runFp: "a1b2c3d4",
        },
        outilsFp: [],
      },
    ],
  };
}

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "m09-ingerer-live-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function generer(exportDoc: unknown, argsExtra: string[] = []): { code: number; out: string } {
  const f = join(dir, `export-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof exportDoc === "string" ? exportDoc : JSON.stringify(exportDoc));
  try {
    const out = execFileSync(process.execPath, [join(RACINE, "scripts/ingerer-live.mjs"), f, ...argsExtra], {
      cwd: RACINE,
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: unknown; stderr?: unknown; stdout?: unknown };
    return { code: typeof err.status === "number" ? err.status : 1, out: String(err.stderr ?? err.stdout ?? "") };
  }
}

function valider(exportDoc: unknown): { code: number; out: string } {
  const f = join(dir, `valider-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof exportDoc === "string" ? exportDoc : JSON.stringify(exportDoc));
  try {
    const out = execFileSync(process.execPath, [join(RACINE, "scripts/valider-live.mjs"), f], {
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

describe("valider-live", () => {
  it("VERT sur un export v2 propre", () => {
    const r = valider(exportMinimal());
    expect(r.code).toBe(0);
  });

  it("refuse un export v1 (autre contrat, autre porte)", () => {
    const doc = exportMinimal();
    doc.contrat = V1;
    expect(valider(doc).code).toBe(1);
  });

  it("refuse une cle inconnue (schema ferme anti-derive)", () => {
    const doc = exportMinimal() as { records: Array<Record<string, unknown>> };
    doc.records[0]!["texte"] = "bonjour";
    expect(valider(doc).code).toBe(1);
  });

  it("refuse un UUID brut (defense en profondeur : que des empreintes)", () => {
    const doc = exportMinimal() as { records: Array<{ v1: Record<string, unknown> }> };
    doc.records[0]!.v1["empreinteRun"] = "123e4567-e89b-12d3-a456-426614174000";
    expect(valider(doc).code).toBe(1);
  });

  it("refuse une issue hors enum", () => {
    const doc = exportMinimal() as { records: Array<{ approbation: Record<string, unknown> }> };
    doc.records[1]!.approbation["issue"] = "peut-etre";
    expect(valider(doc).code).toBe(1);
  });

  it("refuse l'incoherence comptes/tableaux (nbAppels <> appels)", () => {
    const doc = exportMinimal() as { records: Array<{ v1: Record<string, unknown> }> };
    doc.records[0]!.v1["nbAppels"] = 7;
    expect(valider(doc).code).toBe(1);
  });

  it("refuse outilsFp de longueur differente des appels", () => {
    const doc = exportMinimal() as { records: Array<Record<string, unknown>> };
    doc.records[0]!["outilsFp"] = [];
    expect(valider(doc).code).toBe(1);
  });
});

describe("ingerer-live", () => {
  it("emet un SQL borne pour un export VERT", () => {
    const r = generer(exportMinimal(), [`--cabinet=${CABINET}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("BEGIN;");
    expect(r.out).toContain("COMMIT;");
    expect(r.out).toContain(CABINET);
    expect(r.out).toContain("INSERT INTO app.ai_live_runs");
    expect(r.out).toContain("INSERT INTO app.ai_live_calls");
    expect(r.out).toContain("INSERT INTO app.ai_live_proofs");
    expect(r.out).toContain("Guide");
    expect(r.out).toContain("'ok'");
  });

  it("refuse un cabinet malforme", () => {
    expect(generer(exportMinimal(), ["--cabinet=pas-un-uuid"]).code).toBe(1);
  });

  it("refuse sans --cabinet", () => {
    expect(generer(exportMinimal(), []).code).toBe(2);
  });

  it("refuse un export non VERT (contrat falsifie)", () => {
    const doc = exportMinimal();
    doc.contrat = "m09-live-FAUX";
    expect(generer(doc, [`--cabinet=${CABINET}`]).code).toBe(1);
  });

  it("refuse un export au schema invalide", () => {
    expect(generer({ mission: "M09" }, [`--cabinet=${CABINET}`]).code).toBe(1);
  });

  it("deterministe : deux emissions, memes empreintes SHA-256", () => {
    const doc = exportMinimal();
    const a = generer(doc, [`--cabinet=${CABINET}`]);
    const b = generer(doc, [`--cabinet=${CABINET}`]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const sha = (s: string): string[] => (s.match(/[0-9a-f]{64}/g) ?? []).sort();
    // Meme export → memes hashes (hors ids aleatoires : compares en ensemble
    // apres retrait des uuid de runs, qui sont volontairement frais).
    const sansUuid = (s: string): string =>
      s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID");
    expect(sha(sansUuid(a.out))).toEqual(sha(sansUuid(b.out)));
  });
});
