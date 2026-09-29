/**
 * Test de connexion — lecture seule, aucun effet provider.
 * Dit QUELLES capacités MindCare sont réellement disponibles sur le compte
 * connecté (résolution live), sans jamais écrire, envoyer ni publier.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reinitialiserEnv } from "../../src/server/env";
import { testerConnexion } from "../../src/server/communication/connexions-test";

describe("testerConnexion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.MINDCARE_DATABASE_URL;
    reinitialiserEnv();
  });

  it("liste les capacités disponibles du toolkit", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ data: [{ slug: "FACEBOOK_SEND_PAGE_MESSAGE" }, { slug: "AUTRE_OUTIL" }] }),
          { status: 200 },
        ),
    );
    const bilan = await testerConnexion("facebook");
    expect(bilan.connecte).toBe(true);
    const envoi = bilan.capacites.find((c) => c.nom === "facebook.envoyer_message_page");
    expect(envoi?.disponible).toBe(true);
    const publi = bilan.capacites.find((c) => c.nom === "facebook.publier");
    expect(publi?.disponible).toBe(false);
  });

  it("rend non connecté quand la découverte échoue", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    vi.stubGlobal("fetch", async () => new Response("panne", { status: 500 }));
    const bilan = await testerConnexion("facebook");
    expect(bilan.connecte).toBe(false);
    expect(bilan.capacites).toHaveLength(0);
  });
});
