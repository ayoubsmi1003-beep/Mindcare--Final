import { describe, expect, it } from "vitest";
import type { CreneauDuJour } from "@/services/dashboard";
import {
  dureeCourte,
  resteJournee,
  retardsJournee,
  trousJournee,
} from "@/components/tableauDeBord/lecture-journee";

function creneau(partiel: Partial<CreneauDuJour> & { id: string }): CreneauDuJour {
  return {
    startsAt: "2026-09-17T09:00:00+01:00",
    endsAt: "2026-09-17T09:30:00+01:00",
    status: "confirmed",
    kind: null,
    arrivedAt: null,
    patientId: null,
    recordNumber: null,
    firstName: null,
    lastName: null,
    ...partiel,
  };
}

describe("lecture-journee", () => {
  it("trous : ignore annulés/no_show, mesure l'intervalle réel", () => {
    const trous = trousJournee([
      creneau({ id: "a", startsAt: "2026-09-17T09:00:00+01:00", endsAt: "2026-09-17T09:30:00+01:00" }),
      creneau({ id: "b", startsAt: "2026-09-17T09:30:00+01:00", endsAt: "2026-09-17T10:00:00+01:00", status: "cancelled" }),
      creneau({ id: "c", startsAt: "2026-09-17T10:15:00+01:00", endsAt: "2026-09-17T10:45:00+01:00" }),
    ]);
    expect(trous).toEqual([{ debut: "2026-09-17T09:30:00+01:00", fin: "2026-09-17T10:15:00+01:00", minutes: 45 }]);
  });

  it("retards : arrivedAt après startsAt, minutes plancher, nom ou dossier", () => {
    const retards = retardsJournee([
      creneau({ id: "a", startsAt: "2026-09-17T09:00:00+01:00", arrivedAt: "2026-09-17T09:12:30+01:00", firstName: "Smail", lastName: "KARIM" }),
      creneau({ id: "b", startsAt: "2026-09-17T10:00:00+01:00", arrivedAt: "2026-09-17T09:55:00+01:00" }),
      creneau({ id: "c", startsAt: "2026-09-17T11:00:00+01:00", arrivedAt: null }),
    ]);
    expect(retards).toEqual([{ nom: "Smail KARIM", minutes: 12 }]);
  });

  it("reste : non terminés dont la fin dépasse maintenant", () => {
    const reste = resteJournee(
      [
        creneau({ id: "a", startsAt: "2026-09-17T09:00:00+01:00", endsAt: "2026-09-17T09:30:00+01:00", status: "completed" }),
        creneau({ id: "b", startsAt: "2026-09-17T10:00:00+01:00", endsAt: "2026-09-17T10:30:00+01:00" }),
        creneau({ id: "c", startsAt: "2026-09-17T11:00:00+01:00", endsAt: "2026-09-17T11:30:00+01:00" }),
      ],
      new Date("2026-09-17T09:45:00+01:00"),
    );
    expect(reste.restants).toBe(2);
    expect(reste.prochain?.id).toBe("b");
  });

  it("dureeCourte parle comme dureeDepuis", () => {
    expect(dureeCourte(45)).toBe("45 min");
    expect(dureeCourte(60)).toBe("1 h");
    expect(dureeCourte(72)).toBe("1 h 12");
  });
});
