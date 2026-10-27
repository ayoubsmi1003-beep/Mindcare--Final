import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faux = vi.hoisted(() => ({
  niveau: 0,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/services/micro-partage", () => ({
  sourcePartagee: () => ({
    context: {
      createAnalyser: () => ({
        fftSize: 0,
        smoothingTimeConstant: 0,
        disconnect: faux.disconnect,
        getFloatTimeDomainData: (tampon: Float32Array) => tampon.fill(faux.niveau),
      }),
    },
    connect: faux.connect,
  }),
}));

import { creerEndpointeurEnergie } from "@/services/endpointage-voix";

beforeEach(() => {
  vi.useFakeTimers();
  faux.niveau = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("endpointage des options de patience", () => {
  it("keeps the 3 s no-speech patience by default", () => {
    const endpointeur = creerEndpointeurEnergie();
    const fin = vi.fn();
    expect(endpointeur.demarrer(fin).ok).toBe(true);

    vi.advanceTimersByTime(2_999);
    expect(fin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fin).toHaveBeenCalledWith("faux-reveil");

    endpointeur.arreter();
  });

  it("honours patienceMs for the wake follow-up window", () => {
    const endpointeur = creerEndpointeurEnergie();
    const fin = vi.fn();
    expect(endpointeur.demarrer(fin, { patienceMs: 8_000 }).ok).toBe(true);

    vi.advanceTimersByTime(7_999);
    expect(fin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fin).toHaveBeenCalledWith("faux-reveil");

    endpointeur.arreter();
  });

  it("keeps the hard plafondMs independent of the speech detection", () => {
    faux.niveau = 0.1; // continuous speech: silence never concludes
    const endpointeur = creerEndpointeurEnergie();
    const fin = vi.fn();
    expect(endpointeur.demarrer(fin, { patienceMs: 8_000, plafondMs: 1_500 }).ok).toBe(true);

    vi.advanceTimersByTime(1_499);
    expect(fin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fin).toHaveBeenCalledWith("plafond");

    endpointeur.arreter();
  });

  it("still closes on the 1.2 s silence after speech", () => {
    faux.niveau = 0.1;
    const endpointeur = creerEndpointeurEnergie();
    const fin = vi.fn();
    expect(endpointeur.demarrer(fin, { patienceMs: 8_000 }).ok).toBe(true);

    vi.advanceTimersByTime(500);
    expect(fin).not.toHaveBeenCalled();

    faux.niveau = 0;
    vi.advanceTimersByTime(1_199);
    expect(fin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fin).toHaveBeenCalledWith("silence");

    endpointeur.arreter();
  });
});
