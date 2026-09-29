/**
 * Décideur booking — pur, sans base. L'Agenda tranche à l'exécution.
 */
import { describe, expect, it } from "vitest";

import { analyserDemandeRdv } from "../../src/services/communication/analyse";
import { deciderActionRdv, type RdvProche } from "../../src/services/communication/reservation";

const LUNDI = new Date("2026-09-28T09:00:00Z");

function rdv(id: string, startsAt: string): RdvProche {
  return { id, startsAt, status: "requested", patientId: "p1", practitionerId: "dr", durationMinutes: 30 };
}

describe("deciderActionRdv", () => {
  it("confirme l'unique demande", () => {
    const a = analyserDemandeRdv("Oui je confirme", LUNDI);
    expect(deciderActionRdv(a, [rdv("r1", "2026-10-05T10:00:00+01:00")])).toEqual({
      action: "confirmer",
      appointmentId: "r1",
    });
  });

  it("signale l'absence de demande plutôt qu'inventer", () => {
    const a = analyserDemandeRdv("Oui je confirme", LUNDI);
    expect(deciderActionRdv(a, [])).toEqual({ action: "aucun_rdv" });
  });

  it("désambiguïse par le jour exprimé", () => {
    const a = analyserDemandeRdv("J'annule celui de mercredi", LUNDI);
    const action = deciderActionRdv(a, [
      rdv("r1", "2026-09-30T10:00:00+01:00"),
      rdv("r2", "2026-10-01T10:00:00+01:00"),
    ]);
    expect(action).toEqual({ action: "annuler", appointmentId: "r1", proposeReprogrammation: true });
  });

  it("lève l'ambiguïté à l'humaine quand rien ne tranche", () => {
    const a = analyserDemandeRdv("J'annule tout", LUNDI);
    expect(
      deciderActionRdv(a, [rdv("r1", "2026-09-30T10:00:00+01:00"), rdv("r2", "2026-10-01T10:00:00+01:00")]),
    ).toEqual({ action: "ambiguite", candidats: ["r1", "r2"] });
  });

  it("rend la reprogrammation avec sa cible", () => {
    const a = analyserDemandeRdv("Reportez à jeudi", LUNDI);
    expect(deciderActionRdv(a, [rdv("r1", "2026-09-30T10:00:00+01:00")])).toMatchObject({
      action: "reprogrammer",
      appointmentId: "r1",
      jour: "2026-10-01",
    });
  });

  it("ne crée jamais : nouveau RDV reste humain", () => {
    const a = analyserDemandeRdv("Je veux un RDV lundi", LUNDI);
    expect(deciderActionRdv(a, []).action).toBe("nouveau_rdv");
  });
});
