import { describe, expect, it } from "vitest";
import { resolvePatient } from "@/server/alexa/patient-resolver";
import type { DbPort, RpcArgs } from "@/services/db/port";

const id = "a1000000-0000-4000-8000-000000001012";
const row = { id, first_name: "Mohamed", last_name: "Belkacem", total_count: "1" };
function door(searches: Record<string, readonly typeof row[]>, verified: typeof row = row) {
  const queries: string[] = [];
  const db = { rpc: async <T>(name: string, args: RpcArgs) => {
    if (name === "search_patients") { queries.push(String(args.p_query)); return { ok: true as const, data: (searches[String(args.p_query)] ?? []) as unknown as readonly T[] }; }
    return { ok: true as const, data: [verified] as unknown as readonly T[] };
  } } satisfies Pick<DbPort, "rpc">;
  return { db, queries };
}
describe("audited reversed full patient names", () => {
  it("resolves surname-first text through the existing first-name-first search door", async () => {
    const { db, queries } = door({ "mohamed belkacem": [row] });
    expect(await resolvePatient(db, { name: "belkacem mohamed" })).toMatchObject({ status: "resolved", patientId: id });
    expect(queries).toEqual(["belkacem mohamed", "mohamed belkacem"]);
  });
  it("keeps normal ordering to one search", async () => {
    const { db, queries } = door({ "Mohamed Belkacem": [row] });
    expect(await resolvePatient(db, { name: "Mohamed Belkacem" })).toMatchObject({ status: "resolved", patientId: id });
    expect(queries).toEqual(["Mohamed Belkacem"]);
  });
  it("does not retry a partial matching page to escape ambiguity", async () => {
    const { db, queries } = door({ "Belkacem Mohamed": [{ ...row, total_count: "20" }] });
    expect((await resolvePatient(db, { name: "Belkacem Mohamed" })).status).toBe("ambiguous");
    expect(queries).toEqual(["Belkacem Mohamed"]);
  });
  it("revalidates the originally requested identity after reversed search", async () => {
    const { db } = door({ "Mohamed Belkacem": [row] }, { ...row, first_name: "Karim" });
    expect((await resolvePatient(db, { name: "Belkacem Mohamed" })).status).toBe("unavailable");
  });
  it("does not reverse a single incomplete name or reuse an older patient", async () => {
    const { db, queries } = door({});
    expect((await resolvePatient(db, { name: "Belkacem", patientId: id })).status).toBe("unavailable");
    expect(queries).toEqual(["Belkacem"]);
  });
});
