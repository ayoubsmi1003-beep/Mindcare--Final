import { afterEach, describe, expect, it, vi } from "vitest";
import { executerTour, type DependancesBoucle } from "@/services/jarvis-boucle";
import { definirCible, effacerCible } from "@/services/jarvis-contexte";
import { ok } from "@/services/result";
import type { ContexteExecution, CapaciteEnregistree, ValeurSafe } from "@/services/jarvis-capacites";
const patientA = { id: "00000000-0000-4000-8000-000000000011", libelle: "SYNTHETIQUE A", numeroDossier: "", origine: "recherche" as const };
const patientB = { ...patientA, id: "00000000-0000-4000-8000-000000000012", libelle: "SYNTHETIQUE B" };
afterEach(() => effacerCible());
function dependencies(handlers: Record<string, (args: unknown, ctx: ContexteExecution) => Promise<ValeurSafe>>): DependancesBoucle {
  return { lecturesLocales: true, description: () => "", transport: vi.fn(async () => { throw Error("External transport must not run"); }),
    registre: (nom) => handlers[nom] ? { nom, description: "fixture", budgetOctets: 10000,
      champsAttendus: nom === "get_current_medications" ? "patientId" : "",
      lancer: async (args, ctx) => ok(await handlers[nom]!(args, ctx)) } as CapaciteEnregistree : null };
}
const tour = (message: string, deps: DependancesBoucle) => executerTour({ message, conversationId: "synthetic-conversation" }, {}, new AbortController().signal, deps);
describe("existing tool loop local route, no external patient inference", () => {
  it("next patient then treatment uses the patient returned by the authorized agenda door", async () => {
    const patients: string[] = [];
    definirCible(patientA);
    const deps = dependencies({
      get_next_patient: async (_, ctx) => ({ creneaux: [{ ref: ctx.carte.rendezVous("00000000-0000-4000-8000-000000000021", "14:00"),
        patient: ctx.carte.patient(patientB.id, patientB.libelle), debut: "14:00", fin: "14:30", dureeMinutes: 30, statut: "scheduled", type: null, arriveA: null }], provenance: [] }),
      get_current_medications: async (args, ctx) => {
        patients.push((args as { patientId: string }).patientId);
        return { patient: ctx.carte.patient(patientB.id, patientB.libelle), enCours: { actifs: [], enPause: [] }, historique: null, provenance: [] };
      },
    });
    const result = await tour("Qui vient après ? et montre son traitement", deps);
    expect(result).toMatchObject({ ok: true, data: { ancreCandidate: { id: patientB.id }, appels: [{ capacite: "get_next_patient", ok: true }, { capacite: "get_current_medications", ok: true }] } });
    expect(patients).toEqual([patientB.id]); expect(deps.transport).not.toHaveBeenCalled();
  });
  it("switch A→B during an outstanding read discards all old clinical output", async () => {
    definirCible(patientA);
    const deps = dependencies({ get_current_medications: async (_, ctx) => {
      const patient = ctx.carte.patient(patientA.id, patientA.libelle); definirCible(patientB);
      return { patient, enCours: { actifs: [], enPause: [] }, historique: null, provenance: [] };
    } });
    expect(await tour("Son traitement actuel", deps)).toMatchObject({ ok: false, error: { code: "conflit" } });
    expect(deps.transport).not.toHaveBeenCalled();
  });
  it("no patient context asks for a patient without invoking a tool", async () => {
    const handler = vi.fn(); const deps = dependencies({ get_current_medications: handler });
    expect(await tour("Son traitement actuel", deps)).toMatchObject({ ok: true, data: { appels: [], ancreCandidate: null } });
    expect(handler).not.toHaveBeenCalled(); expect(deps.transport).not.toHaveBeenCalled();
  });
  it("an empty next-patient result never reads the previous patient's treatment", async () => {
    definirCible(patientA);
    const treatment = vi.fn(async () => ({ enCours: { actifs: [], enPause: [] }, historique: null, provenance: [] }));
    const deps = dependencies({ get_next_patient: async () => ({ creneaux: [], provenance: [] }), get_current_medications: treatment });
    await tour("Qui vient après ? et montre son traitement", deps);
    expect(treatment).not.toHaveBeenCalled();
    expect(deps.transport).not.toHaveBeenCalled();
  });
  it.each(["et avant ça", "و قبل هذا", "et قبل هذا"])("authorized same-conversation follow-up stays local: %s", async (message) => {
    definirCible(patientA);
    const notes = vi.fn(async () => ({ seances: [
      { le: "2026-09-30", note: null }, { le: "2026-09-29", note: null },
    ], provenance: [] }));
    const deps = dependencies({ get_consultation_history: notes });
    const result = await executerTour({ message, conversationId: "synthetic-conversation", travail: {
      conversationId: "synthetic-conversation", patientId: patientA.id, intentionPrecedente: "GET_CONSULTATION_HISTORY", rangSeance: 0,
    } }, {}, new AbortController().signal, deps);
    expect(result).toMatchObject({ ok: true, data: { texte: expect.stringContaining("2026-09-29"), resolution: { rangSeance: 1 } } });
    expect(notes).toHaveBeenCalledOnce(); expect(deps.transport).not.toHaveBeenCalled();
  });
});
