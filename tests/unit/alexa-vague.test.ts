/**
 * VagueAlexa — la vague d'écoute ne s'affiche que si elle peut être réelle :
 * WebGL présent et pas de reduced-motion. Sinon l'Avatar prend le relais.
 */
import { describe, expect, it } from "vitest";

import { vagueDisponible } from "@/components/ui/vague-alexa";

describe("vagueDisponible", () => {
  it("refuse sans WebGL", () => {
    expect(vagueDisponible({ webgl: false, reducedMotion: false })).toBe(false);
  });
  it("refuse en reduced-motion", () => {
    expect(vagueDisponible({ webgl: true, reducedMotion: true })).toBe(false);
  });
  it("accepte sinon", () => {
    expect(vagueDisponible({ webgl: true, reducedMotion: false })).toBe(true);
  });
});
