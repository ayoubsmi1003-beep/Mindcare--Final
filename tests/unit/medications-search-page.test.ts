import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  rpc: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/services/db", () => ({ db: () => ({ rpc: mocked.rpc }) }));
vi.mock("@/services/log", () => ({
  log: { error: mocked.error, info: mocked.info, warn: vi.fn() },
}));

import { searchMedicationsPage } from "@/services/medications";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  raw_name: "Doliprane 500 mg",
  inn: "Paracétamol",
  brand_name: "Doliprane",
  form: "comprimé",
  strength: "500 mg",
  normalized_name: "doliprane 500 mg",
  source: "règle exacte",
  rank: 0.99,
  total_count: 33,
};

describe("paged medication catalogue search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not call the catalogue for a blank query and clamps paging values", async () => {
    await expect(searchMedicationsPage("  ", 0, -4)).resolves.toEqual({
      ok: true,
      data: { rows: [], total: 0, offset: 0, limit: 1 },
    });
    expect(mocked.rpc).not.toHaveBeenCalled();
  });

  it("trims the query, bounds the page size, and maps the database total and row", async () => {
    mocked.rpc.mockResolvedValueOnce({ ok: true, data: [row] });

    await expect(searchMedicationsPage("  doli  ", 250, 12)).resolves.toEqual({
      ok: true,
      data: {
        rows: [
          {
            id: row.id,
            rawName: row.raw_name,
            inn: row.inn,
            brandName: row.brand_name,
            form: row.form,
            strength: row.strength,
            normalizedName: row.normalized_name,
            source: row.source,
            rank: row.rank,
          },
        ],
        total: 33,
        offset: 12,
        limit: 100,
      },
    });
    expect(mocked.rpc).toHaveBeenCalledWith("search_medications_page", {
      p_query: "doli",
      p_limit: 100,
      p_offset: 12,
    });
  });

  it("rejects malformed catalogue rows instead of presenting them as valid results", async () => {
    mocked.rpc.mockResolvedValueOnce({
      ok: true,
      data: [{ ...row, total_count: "not-a-count" }],
    });

    await expect(searchMedicationsPage("doli")).resolves.toMatchObject({
      ok: false,
      error: {
        code: "regle-metier",
        technical: "schema",
        context: "rpc:search_medications_page",
      },
    });
    expect(mocked.error).toHaveBeenCalledWith(
      "medications.recherche",
      expect.objectContaining({ code: "regle-metier" }),
    );
  });

  it("propagates catalogue-gate failures without changing their classification", async () => {
    const error = {
      code: "indisponible",
      message: "Catalogue indisponible.",
      technical: "42883",
      context: "rpc:search_medications_page",
    } as const;
    mocked.rpc.mockResolvedValueOnce({ ok: false, error });

    await expect(searchMedicationsPage("doli")).resolves.toEqual({ ok: false, error });
    expect(mocked.error).toHaveBeenCalledWith(
      "medications.recherche",
      expect.objectContaining({ code: "indisponible" }),
    );
  });
});
