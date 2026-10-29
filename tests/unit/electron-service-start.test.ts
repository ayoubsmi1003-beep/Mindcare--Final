import { describe, expect, it } from "vitest";

import { serviceDejaDemarre } from "../../electron/main/pg-cluster";

describe("démarrage du service PostgreSQL au reboot", () => {
  it("reconnaît le service déjà démarré (message français)", () => {
    expect(serviceDejaDemarre("net a échoué (code 2) : Le service demandé a déjà été démarré.")).toBe(true);
  });

  it("reconnaît le message anglais et le code 1056", () => {
    expect(serviceDejaDemarre("The requested service has already been started.")).toBe(true);
    expect(serviceDejaDemarre("net a échoué (code 1056)")).toBe(true);
  });

  it("ne masque pas une vraie panne", () => {
    expect(serviceDejaDemarre("net a échoué (code 5) : Accès refusé.")).toBe(false);
    expect(serviceDejaDemarre("Le service n'existe pas")).toBe(false);
  });
});
