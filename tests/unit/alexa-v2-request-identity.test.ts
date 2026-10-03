import { describe, expect, it } from "vitest";
import { planRequest } from "@/shared/alexa/request-plan";
import { patientMention } from "@/server/alexa/patient-mention";
import { resolvePatient } from "@/server/alexa/patient-resolver";
import type { DbPort } from "@/services/db/port";

describe("Alexa French quantities are grammatical and bounded", () => {
  it.each([
    ["quatre-vingt", 80], ["quatre-vingts", 80], ["quatre-vingt-dix", 90], ["quatre-vingt-onze", 91],
    ["quatre vingt dix neuf", 99], ["soixante-dix", 70], ["soixante et onze", 71], ["vingt et un", 21],
    ["vingt-deux", 22], ["cinquante-trois", 53], ["dix-sept", 17], ["cent", 100], ["5", 5],
  ])("resolves %s as %i consultations", (quantity, count) => {
    expect(planRequest(`Résume les ${quantity} dernières consultations`, null)).toMatchObject({ intent: "history", count });
  });
  it.each(["cent un", "deux cents", "mille", "plusieurs", "quelques", "vingt patates", "0", "101", "vingt dix"]) (
    "clarifies an explicit unsupported quantity %s", quantity => {
      expect(planRequest(`Résume les ${quantity} dernières consultations`, null).intent).toBe("clarify");
    });
  it.each(["dernière consultation Nadia", "consultation du 21 mai 2026", "consultation de Cent Test", "dernière consultation du 5 septembre", "consultation Nadia 90 ans"]) (
    "does not turn a name/date into a count: %s", text => expect(planRequest(text, null)).toMatchObject({ intent: "history", count: 1 }),
  );
  it.each([["آخر خمس جلسات", 5], ["آخر ٢٠ جلسة", 20], ["les ٥ dernières consultations", 5]]) (
    "preserves existing Arabic and mixed quantity %s", (text, count) => expect(planRequest(text, null)).toMatchObject({ intent: "history", count }),
  );
});

describe("Alexa local explicit identity extraction", () => {
  it.each([
    ["résumé Nadia", "Nadia"], ["dernière consultation Nadia", "Nadia"], ["ملخص نادية", "نادية"],
    ["résumé Nadia Test", "Nadia Test"], ["Résume Nadia Ben Said", "Nadia Ben Said"],
    ["les cinq dernières consultations Nadia Test", "Nadia Test"], ["traitement Nadia Test", "Nadia Test"],
    ["résumé de Nadia Test", "Nadia Test"], ["dernière consultation pour Nadia Test", "Nadia Test"],
    ["ملخص للمريضة نادية", "نادية"], ["آخر جلسة نادية", "نادية"],
    ["résumé de la dernière consultation Nadia Test", "Nadia Test"], ["résumé Larbi Test", "Larbi Test"],
    ["résumé Leila Test", "Leila Test"], ["résumé Nadia Test avec le traitement", "Nadia Test"],
  ])("extracts an explicit local name from %s", (text, name) => expect(patientMention(text)).toBe(name));
  it.each([
    "résumé du cas", "résumé clinique", "résumé de la dernière consultation", "dernière consultation", "dernière consultation du 21 mai",
    "résumé des traitements", "traitement actuel", "résumé cette semaine", "résumé médical", "consultation de lundi", "consultation du mois de septembre", "ملخص الحالة", "آخر جلسة للمريض", "ملخص العلاج",
  ])("does not mistake clinical/date/context words for a patient: %s", text => expect(patientMention(text)).toBeUndefined());
  it("does not silently reuse the current patient when a directly named patient is unknown", async () => {
    const calls: string[] = [];
    const db = { rpc: async <T>(name: string) => { calls.push(name); return { ok: true as const, data: [] as readonly T[] }; } } satisfies Pick<DbPort, "rpc">;
    const name = patientMention("résumé Nadia Inconnue");
    expect(name).toBe("Nadia Inconnue");
    if (name === undefined) throw new Error("explicit name fixture was not resolved");
    expect(await resolvePatient(db, { patientId: "00000000-0000-4000-8000-000000000001", name })).toEqual({ status: "unavailable" });
    expect(calls).not.toContain("get_patient"); // Both name orders may be searched; a failed name never reads the old dossier.
  });
});
