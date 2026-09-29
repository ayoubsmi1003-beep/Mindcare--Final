/**
 * Découverte Composio — résout les slugs réels au runtime.
 *
 * On ne devine JAMAIS un slug provider en dur : le registre MindCare ne
 * porte que des MOTIFS, et cette fonction liste les outils réellement
 * exposés par le compte connecté puis matche. Capacité absente → indisponible
 * honnête, jamais un appel vers un slug inventé.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reinitialiserEnv } from "../../src/server/env";
import { listerOutilsComposio } from "../../src/server/egress/external-call";
import {
  capaciteConnue,
  resoudreSlug,
} from "../../src/server/communication/registre-outils";

function uuid(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

describe("découverte composio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.MINDCARE_DATABASE_URL;
    reinitialiserEnv();
  });

  it("extrait les slugs quelle que soit l'enveloppe", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ data: [{ slug: "INSTAGRAM_SEND_MESSAGE" }, { name: "IG_REPLY" }] }), {
          status: 200,
        }),
    );
    const resultat = await listerOutilsComposio("instagram", uuid(1));
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data).toContain("INSTAGRAM_SEND_MESSAGE");
      expect(resultat.data).toContain("IG_REPLY");
    }
  });

  it("rend indisponible sur forme illisible (jamais de devinette)", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    vi.stubGlobal("fetch", async () => new Response("pas du json", { status: 200 }));
    const resultat = await listerOutilsComposio("instagram", uuid(2));
    expect(resultat.ok).toBe(false);
  });

  it("n'envoie jamais sans clé", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    reinitialiserEnv();
    const appels: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      appels.push(args);
      return new Response("[]", { status: 200 });
    });
    const resultat = await listerOutilsComposio("instagram", uuid(3));
    expect(resultat.ok).toBe(false);
    expect(appels).toHaveLength(0);
  });
});

describe("résolution par motifs", () => {
  it("matche insensible à la casse, premier motif gagnant", () => {
    expect(resoudreSlug(["instagram_send", "ig_send"], ["WHATSAPP_SEND", "INSTAGRAM_SEND_MESSAGE"])).toBe(
      "INSTAGRAM_SEND_MESSAGE",
    );
  });

  it("rend null sans match (capacité indisponible, pas d'invention)", () => {
    expect(resoudreSlug(["instagram_publish"], ["INSTAGRAM_SEND_MESSAGE"])).toBeNull();
    expect(resoudreSlug([], ["X"])).toBeNull();
  });

  it("le registre connaît instagram, sans instagram illimité", async () => {
    expect(capaciteConnue("instagram.envoyer_reponse")).toBe(true);
    expect(capaciteConnue("instagram.publier")).toBe(true);
  });
});
