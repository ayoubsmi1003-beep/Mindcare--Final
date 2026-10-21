/**
 * Migration legacy Syglab — réconciliation contre une VRAIE base (126 appliquée).
 *
 * Sans `MINDCARE_TEST_DATABASE_URL`, ces tests s'IGNORENT en le disant
 * (convention du dépôt : un skip silencieux = FAIL déguisé).
 *
 * Chaque test ouvre son propre lot dans une transaction ANNULÉE : rien ne
 * subsiste, compteurs rendus. Les portes restent le seul chemin d'écriture.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import pg from "pg";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

const PRATICIEN = "00000000-0000-0000-0000-0000000000a2";
const ASSISTANTE = "00000000-0000-0000-0000-0000000000a3";

let client: pg.Client;

async function inw(
  sql: string,
  params: unknown[] = [],
  identite: string = PRATICIEN,
): Promise<Record<string, unknown>[]> {
  await client.query("SAVEPOINT t");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      identite,
    ]);
    const r = await client.query<Record<string, unknown>>(sql, params);
    await client.query("RELEASE SAVEPOINT t");
    return r.rows;
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT t");
    throw e;
  }
}

async function porte(nom: string, params: unknown[], identite = PRATICIEN) {
  const noms = params.map((_, i) => `$${i + 1}`).join(", ");
  const lignes = await inw(`SELECT app.${nom}(${noms}) AS v`, params, identite);
  const value = lignes[0]?.["v"];
  if (nom === "legacy_get_report") return value as Record<string, unknown>;
  return value;
}

beforeAll(async () => {
  if (!ACTIF) return;
  client = new pg.Client({ connectionString: URL_TEST });
  await client.connect();
  await client.query("BEGIN");
});

afterAll(async () => {
  if (!ACTIF) return;
  await client.query("ROLLBACK");
  await client.end();
});

describe.skipIf(!ACTIF)("migration legacy — portes 126", () => {
  it("réconcilie les comptes sources depuis l'exécution", async () => {
    const lot = await porte("legacy_start_batch", ["test-integration", "{}"]);
    const pid = await porte("legacy_import_patient", [
      lot, "IT-1", "Integ", "Testun", "0555000101", null, PRATICIEN, "sha:it1",
    ]);
    expect(typeof pid).toBe("string");
    const note = "note témoin";
    await porte("legacy_import_history", [
      lot, pid, "patient.IDPatient=IT-1", "baseline_note", note, false,
      createHash("sha256").update(note, "utf8").digest("hex"),
    ]);
    const rapport = await porte("legacy_get_report", [lot]);
    expect((rapport as Record<string, unknown>)["patients_imported"]).toBe(1);
    expect((rapport as Record<string, unknown>)["histories_imported"]).toBe(1);
    expect((rapport as Record<string, unknown>)["rtf_integrity_ok"]).toBe(true);
  });

  it("rejoue sans dupliquer (même id, zéro ligne ajoutée)", async () => {
    const lot = await porte("legacy_start_batch", ["test-rejeu", "{}"]);
    const un = await porte("legacy_import_patient", [
      lot, "IT-2", "Integ", "Testdeux", null, null, PRATICIEN, "sha:it2",
    ]);
    const deux = await porte("legacy_import_patient", [
      lot, "IT-2", "Integ", "Testdeux", null, null, PRATICIEN, "sha:it2",
    ]);
    expect(deux).toBe(un);
    // Lecture directe interdite sur patients (ADR-019) : on compte via la porte.
    const recherche = await inw(
      "SELECT * FROM app.search_patients($1, 25, 0)",
      ["Testdeux"],
    );
    expect(Number(recherche[0]?.["total_count"])).toBe(1);
  });

  it("garde les doublons possibles séparés (aucune fusion automatique)", async () => {
    const lot = await porte("legacy_start_batch", ["test-doublons", "{}"]);
    const a = await porte("legacy_import_patient", [
      lot, "IT-A", "Sonde", "Doublon", "0555000102", "CDI-X1", PRATICIEN, "sha:a",
    ]);
    const b = await porte("legacy_import_patient", [
      lot, "IT-A", "Sonde", "Doublon", "0555000102", "CDI-X1", PRATICIEN, "sha:a",
    ]);
    // Même source → même dossier (idempotence), mais deux sources distinctes
    // au même téléphone restent deux dossiers jamais fusionnés.
    expect(b).toBe(a);
    const c = await porte("legacy_import_patient", [
      lot, "IT-B", "Sonde", "Doublon", "0555000102", "CDI-X1", PRATICIEN, "sha:b",
    ]);
    expect(c).not.toBe(a);
    await porte("legacy_open_review", [
      lot, "duplicate_group", "IT-A|IT-B", "possible_duplicate",
      '{"motif":"telephone"}', "KEEP_SEPARATE",
    ]);
    const revue = await porte("legacy_get_report", [lot]);
    expect((revue as Record<string, unknown>)["duplicates_pending"]).toBe(1);
  });

  it("met les orphelines en quarantaine sans patient", async () => {
    const lot = await porte("legacy_start_batch", ["test-orphelines", "{}"]);
    const id = await porte("legacy_quarantine_orphan", [
      lot, "424242", "ORD-IT-1", "2024-06-01", "ORD-1", "orpheline témoin",
      JSON.stringify([{ legacy_line_id: "L1", display: "X 5 mg" }]),
      "sha:orph-it1",
    ]);
    expect(typeof id).toBe("string");
    const lignes = await inw(
      "SELECT source_patient_id FROM app.legacy_orphan_prescriptions WHERE id = $1",
      [id],
    );
    expect(lignes[0]?.["source_patient_id"]).toBe("424242");
  });

  it("refuse les dates inconnues au lieu d'estampiller aujourd'hui", async () => {
    const lot = await porte("legacy_start_batch", ["test-dates", "{}"]);
    const pid = await porte("legacy_import_patient", [
      lot, "IT-D", "Sonde", "Date", null, null, PRATICIEN, "sha:d",
    ]);
    await expect(
      porte("legacy_import_prescription", [
        lot, pid, "ORD-SANS-DATE", null, "ORD-0", "", "[]",
      ]),
    ).rejects.toThrow();
  });

  it("laisse l'assistante hors du clinique legacy", async () => {
    await expect(
      porte("legacy_start_batch", ["test-assistante", "{}"], ASSISTANTE),
    ).rejects.toThrow();
  });
});
