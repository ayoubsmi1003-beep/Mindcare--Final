/**
 * Registre d'outils Communication + garde egress Composio.
 * Sans réseau : fetch global substitué, base absente (journal best-effort).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reinitialiserEnv } from "../../src/server/env";
import { appelComposio } from "../../src/server/egress/external-call";
import {
  capaciteConnue,
  exigeApprobation,
  OUTILS_COMMUNICATION,
} from "../../src/server/communication/registre-outils";

describe("registre fermé", () => {
  it("ne contient que du composio, aucun instagram", () => {
    expect(OUTILS_COMMUNICATION.length).toBeGreaterThan(0);
    for (const o of OUTILS_COMMUNICATION) {
      expect(o.provider).toBe("composio");
      expect(o.canal).not.toBe("instagram");
    }
  });

  it("refuse les slugs inconnus et exige l'approbation pour publier", () => {
    expect(capaciteConnue("outil.inexistant")).toBe(false);
    expect(capaciteConnue("whatsapp.envoyer_texte")).toBe(true);
    expect(exigeApprobation("facebook.publier")).toBe(true);
    expect(exigeApprobation("whatsapp.envoyer_texte")).toBe(false);
  });
});

describe("garde egress composio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.MINDCARE_DATABASE_URL;
    reinitialiserEnv();
  });

  it("bloque une charge à signal patient SANS appel réseau", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    const appels: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      appels.push(args);
      return { ok: true, json: async () => ({ id: "wamid.x" }) } as Response;
    });
    const resultat = await appelComposio({
      outil: "whatsapp.envoyer_texte",
      charge: { texte: "Bonjour Karim, rappel 0612345678" },
      cleIdempotence: "comm:c:1",
      sessionToken: "00000000-0000-4000-8000-000000000000",
    });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("frontiere");
    expect(appels).toHaveLength(0);
  });

  it("laisse passer une charge générique (fetch moqué)", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    vi.stubGlobal("fetch", async () => {
      return { ok: true, json: async () => ({ id: "wamid.x" }) } as Response;
    });
    const resultat = await appelComposio({
      outil: "whatsapp.envoyer_texte",
      charge: { texte: "Le cabinet sera ouvert samedi matin." },
      cleIdempotence: "comm:c:2",
      sessionToken: "00000000-0000-4000-8000-000000000001",
    });
    expect(resultat.ok).toBe(true);
  });
});
