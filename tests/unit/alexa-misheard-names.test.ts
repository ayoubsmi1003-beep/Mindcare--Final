import { describe, expect, it } from "vitest";
import { resolveListedReference } from "@/server/alexa/conversation-state";
import { closeNames, namesAnotherPatient, phoneticKey, resolvePatient } from "@/server/alexa/patient-resolver";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const row = (n: number, first: string, last: string) => ({ id: id(n), first_name: first, last_name: last, total_count: 1 });

describe("a misheard name", () => {
  it.each([["Karime Ben Ali", "Karim Benali"], ["Carim Benaly", "Karim Benali"], ["Amina Bouzid", "Amina Bouzide"], ["Yasmine", "Iasmine"]])("%s sounds like %s", (heard, stored) => {
    expect(phoneticKey(heard)).toBe(phoneticKey(stored));
  });

  it("offers at most three close names, best first, and nothing far away", () => {
    const rows = [row(1, "Karim", "Benali"), row(2, "Karima", "Benali"), row(3, "Salim", "Haddad"), row(4, "Karim", "Bensalem")];
    expect(closeNames(rows, "Karime Ben Ali").map(item => item.label)).toEqual(["Karim Benali", "Karima Benali"]);
    expect(closeNames(rows, "Mohamed Larbi")).toEqual([]);
  });

  it("asks for confirmation instead of resolving when the search door returns only approximate rows", async () => {
    const db = { rpc: async (name: string) => name === "search_patients" ? { ok: true, data: [row(1, "Karim", "Benali")] } : { ok: true, data: [] } };
    const result = await resolvePatient(db as never, { name: "Karime Benaly" });
    expect(result).toMatchObject({ status: "ambiguous", suggested: true, candidates: [{ patientId: id(1), label: "Karim Benali" }] });
  });

  it("looks by sound when nothing matches as written, and reads nothing", async () => {
    const calls: string[] = [];
    const db = { rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "search_patients" && args["p_spec"]) return { ok: true, data: [{ search_patients: { total: 0, rows: [], complete: true, offset: 0, revision: "a".repeat(32) } }] };
      if (name === "search_patients" && args["p_query"] === "kar") return { ok: true, data: [row(1, "Karim", "Benali")] };
      return { ok: true, data: [] };
    } };
    const result = await resolvePatient(db as never, { name: "Karime Ben Ali" });
    expect(result).toMatchObject({ status: "ambiguous", suggested: true });
    expect(calls).not.toContain("get_patient");
  });

  it("confirms a single suggestion with a plain yes, and never with several", () => {
    const one = [{ patientId: id(1), label: "Karim Benali" }], two = [...one, { patientId: id(2), label: "Karima Benali" }];
    expect(resolveListedReference("Oui", one, { yesConfirms: true })).toBe(id(1));
    expect(resolveListedReference("Oui", one)).toBeNull();
    expect(resolveListedReference("oui", two, { yesConfirms: true })).toBeNull();
    expect(resolveListedReference("2", two)).toBe(id(2));
  });
});

describe("homonyms in suggestions", () => {
  it("shows the birth date when two suggested people share a name", () => {
    const rows = [{ ...row(1, "Karim", "Benali"), birth_date: "1980-01-02" }, { ...row(2, "Karim", "Benali"), birth_date: "1991-03-04" }];
    expect(closeNames(rows, "Karime Benaly").map(item => item.label)).toEqual(["Karim Benali (né·e le 1980-01-02)", "Karim Benali (né·e le 1991-03-04)"]);
  });
});

describe("the name check counts names, not approximate rows", () => {
  it("ignores fuzzy rows whose names don't start with the words", async () => {
    const db = (rows: unknown[]) => { const port: unknown = { rpc: async () => ({ ok: true, data: rows }) }; return port as never; };
    expect(await namesAnotherPatient(db([row(2, "Sitou", "Ation")]), ["situation"], id(1))).toBe(false);
    expect(await namesAnotherPatient(db([row(2, "Karim", "Haddad")]), ["karim"], id(1))).toBe(true);
    expect(await namesAnotherPatient(db([row(1, "Karim", "Benali")]), ["karim"], id(1))).toBe(false);
  });
});
