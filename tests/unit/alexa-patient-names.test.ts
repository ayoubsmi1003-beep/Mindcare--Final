import { describe, expect, it } from "vitest";
import { classifyPatientQuestion, patientSubject, renderPatientQuestion, type PatientSectionKey } from "@/shared/alexa/patient-question";
import { parsePatientMention } from "@/shared/alexa/patient-mention";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";
import { resolvePatient } from "@/server/alexa/patient-resolver";
import { canAnswerGeneralAlexa } from "@/server/alexa/model-gateway";

// Development wordings, written apart from C270 and H270. Names are invented.
const global = { contextPatient: false, followup: false };
const named = (text: string) => { const subject = patientSubject(text, global, "summary"); return subject?.kind === "named" ? subject.name : subject?.kind ?? null; };

describe("a full name among words the lists do not know", () => {
  it.each([
    ["Salim Ouared a été hospitalisé à quelle date ?", "Salim Ouared"],
    ["nadia kerrouche est revenue combien de fois cet été ?", "nadia kerrouche"],
    ["Cherche chez yanis bellil les séances où il parle d'insomnie", "yanis bellil"],
    ["Résultats sanguins récents pour Amel Sahraoui", "Amel Sahraoui"],
  ])("%s → %s", (text, name) => expect(named(text)).toBe(name));
  it("still refuses two names, or a second capitalised name", () => {
    expect(named("Compare Salim Ouared et Nadia Kerrouche")).toBeNull();
    expect(named("Salim Ouared et Karim, combien de séances ?")).toBeNull();
  });
});

describe("age is part of the profile", () => {
  it.each(["Quel âge a-t-il ?", "Il a quel âge, ce monsieur ?", "Son âge exact ?"])("%s", (text) => expect(classifyPatientQuestion(text)?.section).toBe("identity"));
});

describe("the general model never answers about someone", () => {
  it.each(["Quel âge a nadia kerrouche ?", "Quel âge a-t-elle ?", "Où habite yanis bellil ?", "Est-il allergique à quelque chose ?"])("refused: %s", (text) => expect(canAnswerGeneralAlexa(text)).toBe(false));
  it.each(["Quel âge a la Terre ?", "Qui a écrit Les Misérables ?", "Quel est le rôle du foie dans la digestion d'un oiseau ?"])("still answered: %s", (text) => expect(canAnswerGeneralAlexa(text)).toBe(true));
});

describe("a name with an everyday word glued to it", () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const people = [{ id: id(1), first_name: "Yanis", last_name: "Bellil", total_count: 1 }, { id: id(2), first_name: "Amel", last_name: "Bellil", total_count: 1 }];
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "get_patient") return { ok: true, data: people.filter((p) => p.id === args["p_id"]) };
    if (name === "search_patients" && args["p_spec"]) return { ok: true, data: [{ search_patients: { total: 0, rows: [], complete: true, offset: 0, revision: "a".repeat(32) } }] };
    if (name === "search_patients" && typeof args["p_query"] === "string") {
      const words = fold(args["p_query"]).split(" ");
      return { ok: true, data: people.filter((p) => words.every((w) => fold(`${p.first_name} ${p.last_name}`).split(" ").includes(w))) };
    }
    return { ok: true, data: [] };
  } };
  it("drops one edge word when the rest names one patient exactly", async () => {
    expect(await resolvePatient(db as never, { name: "yanis bellil juste" })).toMatchObject({ status: "resolved", patientId: id(1) });
    expect(await resolvePatient(db as never, { name: "voir yanis bellil" })).toMatchObject({ status: "resolved", patientId: id(1) });
  });
  it("drops the glued word when the search offered a list of close names", async () => {
    const listing = { rpc: async (name: string, args: Record<string, unknown>) => {
      // The search door returns approximate rows for the three words: a list, none of them carrying every word.
      if (name === "search_patients" && args["p_query"] === "yanis bellil cumule") return { ok: true, data: people.map((p) => ({ ...p, total_count: 2 })) };
      return db.rpc(name, args);
    } };
    expect(await resolvePatient(listing as never, { name: "yanis bellil cumule" })).toMatchObject({ status: "resolved", patientId: id(1) });
  });
  it("keeps the choice when someone carries every written word", async () => {
    const twins = [...people, { id: id(3), first_name: "Yanis Bellil", last_name: "Cumule", total_count: 1 }, { id: id(4), first_name: "Yanis", last_name: "Bellil Cumule", total_count: 1 }];
    const both = { rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "search_patients" && args["p_query"] === "yanis bellil cumule") return { ok: true, data: twins.slice(2).map((p) => ({ ...p, total_count: 2 })) };
      return db.rpc(name, args);
    } };
    expect((await resolvePatient(both as never, { name: "yanis bellil cumule" })).status).toBe("ambiguous");
  });
  it("never guesses when the trimmed name is not one patient", async () => {
    expect((await resolvePatient(db as never, { name: "bellil juste demain" })).status).not.toBe("resolved");
    expect((await resolvePatient(db as never, { name: "fasse entrer" })).status).toBe("absent");
  });
});

describe("the next appointment, said with any word of a visit", () => {
  it.each(["Elle repasse quand, la prochaine fois ?", "Son prochain passage, c'est pour quand ?", "Il est attendu quand la prochaine fois ?", "La prochaine visite de Salim Ouared ?"])("%s", (text) => expect(classifyPatientQuestion(text)?.section).toBe("nextappt"));
});

describe("every closed question names the patient in a form the name parser reads", () => {
  // "Affiche le profil de <nom>." was read as nobody: the turn fell back on the open record, then refused.
  const sections: PatientSectionKey[] = ["summary", "history", "treatments", "treatchanges", "bounds", "count", "lastnote", "prev", "nextappt", "documents", "scales", "diagnoses", "evolution", "identity"];
  it.each(sections.flatMap((section) => ["yanis bellil", "Nadia Kerrouche", "amel sara sahraoui"].map((name) => [section, name] as const)))("%s, %s", (section, name) => {
    const text = renderPatientQuestion({ section, n: 3 }, { kind: "named", name });
    expect(parsePatientMention(text)).toEqual({ status: "named", name });
    expect(frenchRequestAdmission(text, false).tools?.length).toBe(1);
  });
  it("also with the period of a count", () => {
    const text = renderPatientQuestion({ section: "count" }, { kind: "named", name: "yanis bellil" }, { from: "2025-01-01T00:00:00+01:00", to: "2026-01-01T00:00:00+01:00" });
    expect(parsePatientMention(text)).toEqual({ status: "named", name: "yanis bellil" });
  });
});
